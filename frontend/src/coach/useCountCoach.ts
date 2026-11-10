import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { AnchorResult } from '../beats/anchor.ts'
import { planCount } from '../beats/countPlan.ts'
import type { CountInfo } from '../beats/countInfo.ts'
import { DEFAULT_COUNT_PREFS, DEFAULT_COUNT_SETTINGS, NATIVE_AUDIO_GAIN, normalizeCountPrefs, normalizeCountSettings, type CountPrefs, type CountSettings } from '../beats/countSettings.ts'
import { nudgeAdjust, planCountEvents, setAdjustToTime, type BeatGrid } from '../beats/grid.ts'
import type { TimedEvent } from '../beats/onset.ts'
import { safeStorage } from '../practice/safeStorage.ts'
import { danceId, patchDance } from '../practice/danceStore.ts'
import { usePoseAccents } from '../pose/usePoseAccents.ts'
import { CountScheduler } from './countScheduler.ts'
import { loadCountVoice, onsetTable, type VoiceSet } from './countVoice.ts'
import { renderCountTrack, wavBlob } from './wav.ts'

const PREFS_KEY = 'adl-count-prefs'
const settingsKey = (videoKey: string) => `adl-count:${videoKey}`

function readJson(key: string) { try { return JSON.parse(safeStorage.getItem(key) ?? 'null') } catch { return null } }

export interface CoachInput {
  videoRef: RefObject<HTMLVideoElement | null>
  videoKey: string
  videoUrl: string | null
  duration: number
  /** null while the tempo is unknown / being detected. */
  bpm: number | null
  musicStart: number | null
  danceStart: number | null
  audioOnsets: TimedEvent[]
  /** Other tempos the audio detector found (used when choosing the number-beat level). */
  audioCandidates?: number[]
}

export function useCountCoach(input: CoachInput) {
  const { videoRef, videoKey, videoUrl, duration, bpm, musicStart, danceStart, audioOnsets, audioCandidates } = input
  const [prefs, setPrefsState] = useState<CountPrefs>(() => normalizeCountPrefs(readJson(PREFS_KEY)))
  const [settings, setSettingsState] = useState<CountSettings>(DEFAULT_COUNT_SETTINGS)
  const [poseWanted, setPoseWanted] = useState(false)
  const [voiceState, setVoiceState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const voiceRef = useRef<VoiceSet | null>(null)
  const schedulerRef = useRef<CountScheduler | null>(null)
  const gridRef = useRef<BeatGrid | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  // Per-video settings (adjustments, first-beat choice) live next to the video's other practice state.
  const loadedKey = useRef('')
  const skipSave = useRef(false)
  useEffect(() => {
    loadedKey.current = ''
    if (!videoKey) { setSettingsState(DEFAULT_COUNT_SETTINGS); return }
    setSettingsState(normalizeCountSettings(readJson(settingsKey(videoKey))))
    loadedKey.current = videoKey
    skipSave.current = true // the save effect of this same commit still holds the previous video's settings
    setPoseWanted(false)
  }, [videoKey])
  useEffect(() => {
    if (!videoKey || loadedKey.current !== videoKey) return
    if (skipSave.current) { skipSave.current = false; return }
    const json = JSON.stringify(settings)
    safeStorage.setItem(settingsKey(videoKey), json)
    const [name, size] = (() => { const id = danceId(videoKey); const cut = id.lastIndexOf(':'); return [id.slice(0, cut), Number(id.slice(cut + 1)) || 0] as const })()
    void patchDance(danceId(videoKey), { count: json }, { name, size })
  }, [settings, videoKey])
  useEffect(() => { safeStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) }, [prefs])

  const setPrefs = useCallback((patch: Partial<CountPrefs>) => setPrefsState(current => normalizeCountPrefs({ ...current, ...patch })), [])
  const updateSettings = useCallback((patch: Partial<CountSettings>) => setSettingsState(current => ({ ...current, ...patch })), [])

  const needPose = prefs.enabled || prefs.overlay || poseWanted
  const { pose, cancelPose, retryPose } = usePoseAccents(videoKey, videoUrl, needPose && settings.alignBasis !== 'audio' && bpm !== null)

  const motion = settings.follow && pose.status === 'ready' ? pose.motion : null
  const plan = useMemo(() => bpm === null ? null : planCount({ bpm, settings, motion, poseAccents: pose.accents, audioOnsets, musicStart, danceStart, duration, audioCandidates }), [audioCandidates, audioOnsets, bpm, danceStart, duration, motion, musicStart, pose.accents, settings])
  const numberBpm = plan?.numberBpm ?? null
  const anchorInfo: AnchorResult | null = plan?.anchorInfo ?? null
  const grid: BeatGrid | null = plan?.grid ?? null
  const countInfo: CountInfo | null = plan?.info ?? null
  gridRef.current = grid

  // Fine-tunes belong to one number-beat tempo: a different level is a different grid.
  useEffect(() => {
    if (numberBpm === null) return
    setSettingsState(current => {
      if (current.adjustBpm === null && !Object.keys(current.adjust).length) return current.adjustBpm === numberBpm ? current : { ...current, adjustBpm: numberBpm }
      if (current.adjustBpm !== null && Math.abs(current.adjustBpm - numberBpm) < 0.05) return current
      return { ...current, adjust: {}, adjustBpm: numberBpm }
    })
  }, [numberBpm])

  /** Gain for the video's own sound while the count is on (mute by default, 压低, or keep). */
  // Mute/duck only once count voice is ready so music still plays while samples load. App silences via GainNode (never video.muted on iOS).
  const nativeGain = prefs.enabled && voiceState === 'ready' ? NATIVE_AUDIO_GAIN[prefs.nativeAudio] : 1

  // Audio side: one AudioContext, created from the user's gesture that switches the count on.
  useEffect(() => {
    const video = videoRef.current
    if (!prefs.enabled || !video || !videoUrl) { schedulerRef.current?.stop(); return }
    let cancelled = false
    let scheduler = schedulerRef.current
    if (!scheduler) {
      const context = new AudioContext({ latencyHint: 'interactive' })
      scheduler = new CountScheduler(context, { video, getGrid: () => gridRef.current, getPrefs: () => prefsRef.current })
      schedulerRef.current = scheduler
    }
    const active = scheduler
    void active.context.resume().catch(() => undefined)
    setVoiceState('loading')
    loadCountVoice(active.context, prefs.voice).then(voice => { if (cancelled) return; voiceRef.current = voice; active.setVoice(voice); setVoiceState('ready'); active.start() }).catch(() => { if (!cancelled) setVoiceState('failed') })
    return () => { cancelled = true; active.stop() }
  }, [prefs.enabled, prefs.voice, videoRef, videoUrl])
  useEffect(() => () => { const scheduler = schedulerRef.current; schedulerRef.current = null; if (scheduler) { scheduler.stop(); void scheduler.context.close().catch(() => undefined) } }, [])
  // Screen off / app in the background: the browser may suspend audio. On return only resume it and re-queue; nothing is recomputed.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const scheduler = schedulerRef.current
      if (scheduler && prefsRef.current.enabled) { void scheduler.context.resume().catch(() => undefined); scheduler.stopAll() }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  // Any edit of the grid invalidates what is already queued.
  useEffect(() => { schedulerRef.current?.stopAll() }, [grid, prefs.andWords])

  const adjustAnd = useCallback((index: number, deltaSeconds: number) => {
    setSettingsState(current => ({ ...current, adjust: nudgeAdjust({ bpm: numberBpm ?? 100, anchor: 0, adjust: current.adjust }, index, deltaSeconds), adjustBpm: numberBpm }))
  }, [numberBpm])
  const moveAndTo = useCallback((index: number, time: number) => {
    const current = gridRef.current
    if (!current) return
    setSettingsState(settingsNow => ({ ...settingsNow, adjust: setAdjustToTime({ ...current, adjust: settingsNow.adjust }, index, time), adjustBpm: current.bpm }))
  }, [])
  const shiftLevel = useCallback((delta: number) => setSettingsState(current => ({ ...current, levelShift: Math.min(2, Math.max(-2, current.levelShift + delta)) })), [])
  const resetAdjust = useCallback(() => setSettingsState(current => ({ ...current, adjust: {} })), [])

  /** Counts for the whole video at 1×, rendered offline with the same samples; also usable for the demo mix. */
  const exportWav = useCallback(async () => {
    const current = gridRef.current
    if (!current) return null
    const voice = voiceRef.current ?? await loadCountVoice(new OfflineAudioContext(1, 1, 44100), prefsRef.current.voice)
    const onset = onsetTable(voice)
    const events = planCountEvents(current, 0, duration, prefsRef.current.andWords).map(event => ({ start: event.mediaTime - onset[event.word], word: event.word }))
    return wavBlob(await renderCountTrack(events, voice, duration, prefsRef.current.volume))
  }, [duration])

  const toggleQuick = useCallback(() => {
    setPrefsState(current => { const on = !(current.enabled || current.overlay); return normalizeCountPrefs({ ...current, enabled: on, overlay: on }) })
  }, [])

  return { prefs: prefs ?? DEFAULT_COUNT_PREFS, setPrefs, settings, updateSettings, grid, anchorInfo, countInfo, nativeGain, pose, cancelPose, retryPose, requestPose: () => setPoseWanted(true), voiceState, adjustAnd, shiftLevel, moveAndTo, resetAdjust, exportWav, toggleQuick }
}
