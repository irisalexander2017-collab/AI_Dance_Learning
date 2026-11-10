import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { PracticeDock } from './practice/PracticeDock'
import { CoverStage } from './cover/CoverStage'
import { TeacherGesture } from './practice/teacherGesture'
import { analyzeVideoAudioCached } from './practice/danceStore'
import { clearDances, countKeyOf, danceId, deleteDance, hydrateFromDance, listDances, patchDance, type DanceRecord } from './practice/danceStore'
import { BpmChip, BpmEditor, analyzingPhaseLabel, type TempoPhase, type TempoStatus } from './beats/BpmPanel.tsx'
import { lookupMatchedTempo } from './beats/matchedTempo.ts'
import { blobSource, readEmbeddedTempo } from './beats/metadata.ts'
import type { TimedEvent } from './beats/onset.ts'
import { BeatOverlay } from './coach/BeatOverlay.tsx'
import { SavedDances } from './practice/SavedDances'
import { CountSettingsPanel } from './coach/CountSettingsPanel.tsx'
import { useCountCoach } from './coach/useCountCoach.ts'
import { CustomCutsEditor } from './practice/CustomCuts.tsx'
import { addCut, buildCustomSegments, evenCutsFromFirst, moveCut, removeCut, segmentIndexAt, type SegmentMode } from './practice/customSegments.ts'
import { normalizePracticeState, type SavedPracticeState, type TempoSource } from './practice/savedPractice'
import { safeStorage } from './practice/safeStorage'
import { ExternalAudioPanel, type AlignStatus } from './practice/ExternalAudioPanel.tsx'
import {
  EXTERNAL_AUDIO_ACCEPT,
  externalTimeAt,
  guessOffsetBetweenFiles,
  isExternalAudioFile,
} from './practice/externalAudio.ts'
import {
  applyBoundaryOffsets,
  buildLearningSegments,
  getPracticeRange,
  nearestBeatPoint,
  PracticeRangeMode,
  videoStorageKey,
} from './practice/beatTimeline'

const ALLOWED_EXTENSIONS = ['mp4', 'mov', 'webm']
// Slow motion only: nothing above 1×. 0.25/0.35 were added for hard sections.
const SPEEDS = [0.25, 0.35, 0.5, 0.65, 0.8, 1] as const
type VideoOrientation = 'landscape' | 'portrait' | 'square'
type DisplayMode = 'contain' | 'cover'
type PlaybackMode = 'loop' | 'continuous'
type TeacherFraming = { zoom: number; panX: number; panY: number }
type UiLanguage = 'zh' | 'en'
type RecordingStatus = 'idle' | 'countdown' | 'recording' | 'processing' | 'ready' | 'error'

const DEFAULT_TEACHER_FRAMING: TeacherFraming = { zoom: 1, panX: 0, panY: 0 }
const MIN_TEACHER_ZOOM = 1
const MAX_TEACHER_ZOOM = 3
const RECORDING_WIDTH = 1280
const RECORDING_HEIGHT = 720
const RECORDING_FPS = 30

function readStoredNumber(key: string, fallback: number) {
  const stored = safeStorage.getItem(key)
  const value = stored === null ? NaN : Number(stored)
  return Number.isFinite(value) ? value : fallback
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function readPracticeState(key: string): SavedPracticeState {
  try { return normalizePracticeState(JSON.parse(safeStorage.getItem(key) ?? 'null')) }
  catch { return normalizePracticeState(null) }
}

function LandingPage({ onStart, language, setLanguage }: { onStart: () => void; language: UiLanguage; setLanguage: (language: UiLanguage) => void }) {
  const [guideOpen, setGuideOpen] = useState(false)
  const text = (zh: string, en: string) => language === 'zh' ? zh : en

  useEffect(() => {
    if (!guideOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGuideOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [guideOpen])

  const guideSteps = language === 'zh' ? [
    ['选择视频', '打开本地 MP4、MOV 或 WebM。视频、摄像头和节拍分析均留在本机。'],
    ['设置两个起点', '底栏点「音乐」→ 在进度条上点一下确认；再点「动作」→ 拖到动作开始处确认。点「自定义」可按第一小节长度均分。'],
    ['用底栏练习', '点速度展开档位。单段选3只练第3段；累加选3练第1–3段。段号独立于进度条，点箭头可收起或展开，放大视频不会藏住控制条。'],
    ['调整画面或分段', '双指缩放，放大后拖动；轻点画面播放或暂停。复杂分段与数拍选项在 ⋯。自动分析只估算稳定节拍，不识别舞蹈动作。'],
    ['数拍与 BPM', '上传视频后点底栏「数拍」即可：自动识别 BPM、对齐老师动作和第 1 拍，并把原声静音，老师念 1 and 2 and … 8 and；速度放慢时间隔变长、声音不变调。只有 BPM 识别失败时才会提示，此时点按 BPM 数字手动输入。音色、层级、and 方式、原声模式等都在 ⋯ → 数拍与分段里。速度只提供慢放（0.25×–1×）。拖完进度条会自动播放。'],
    ['摄像头与录像', '摄像头按钮开关对比，自己的画面默认镜像。录像设置保留3、5、10秒倒计时。录像包含浏览器支持的老师音轨，不录麦克风，不上传；可回看、变速、下载WebM、删除或再录。刷新前请下载要保留的录像。'],
  ] : [
    ['Choose a video', 'Open a local MP4, MOV or WebM. Video, camera and beat analysis stay on this device.'],
    ['Mark two starts', 'On the dock tap ① Music, then tap the timeline to confirm; tap ② Dance and drag to where the moves begin, then confirm. Custom splits evenly by the length of your first section.'],
    ['Practice with the dock', 'Tap Speed for presets. Single + 3 practices section 3; Build-up + 3 practices 1–3. Section numbers are separate from the timeline. Use the arrow to fold them. Zoom never hides the dock.'],
    ['Adjust the view or sections', 'Pinch to zoom; drag after zooming. Tap the video to play or pause. Detailed section and count options live under ⋯. Beat analysis estimates steady tempo, not choreography.'],
    ['Counts and BPM', 'Tap the BPM read-out to correct it (Enter confirms); Count ÷2 / ×2 there change the number-beat level. Tap Count for the teacher count; voice options live under ⋯ → Count & sections. Slow motion stretches the gaps but never the voice. Speeds are slow-motion only (0.25×–1×); releasing the timeline resumes playback.'],
    ['Camera and recording', 'Camera toggles comparison; self-view is mirrored by default. Recording settings retain 3, 5 and 10 second countdowns. Record supported teacher audio, never the microphone. Review, change review speed, download WebM, delete or record again. Download before refreshing; nothing is uploaded.'],
  ]

  return (
    <main className="landing-shell">
      <section className="cover-hero">
        <CoverStage label={text('帧琢 FrameTune 封面：街舞舞者随节拍甩出金色残影', 'FrameTune cover: a street dancer throwing gold afterimages on the beat')} />
        <div className="cover-controls">
          <span className="cover-beta">{text('测试版', 'Beta')}</span>
          <div className="language-switch seg-pill" role="group" aria-label="Language">
            <button type="button" className={language === 'zh' ? 'active' : ''} aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
            <button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
          </div>
        </div>
        <h1 className="cover-title" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}image/branding/cover/cover-title.webp")` }}><span>{text('帧琢 FrameTune · 一帧一磨，雕琢姿态', 'FrameTune · Frame by frame, refine every move')}</span></h1>
        <div className="cover-cta">
          <button type="button" className="cover-start-button btn-primary" onClick={onStart}>{language === 'zh' ? '开始练习' : 'Start practicing'}<span className="arrow" aria-hidden="true">→</span></button>
          <button type="button" className="guide-button btn-quiet" onClick={() => setGuideOpen(true)}>{language === 'zh' ? '使用说明' : 'How it works'}</button>
        </div>
      </section>

      {guideOpen && <div className="guide-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGuideOpen(false) }}>
        <section className="usage-guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
          <header><div><p>FRAMETUNE GUIDE</p><h2 id="guide-title">{language === 'zh' ? '如何使用帧琢' : 'How to use FrameTune'}</h2></div><button type="button" className="guide-close" aria-label={language === 'zh' ? '关闭' : 'Close'} onClick={() => setGuideOpen(false)}>×<span>{language === 'zh' ? '关闭' : 'Close'}</span></button></header>
          <ol>{guideSteps.map(([title, description], index) => <li key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol>
        </section>
      </div>}
    </main>
  )
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraVideoRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const cameraRequestRef = useRef(0)
  const recordingCanvasRef = useRef<HTMLCanvasElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const teacherCaptureStreamRef = useRef<MediaStream | null>(null)
  const recordingAudioContextRef = useRef<AudioContext | null>(null)
  const recordingAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const recordingAudioGainRef = useRef<GainNode | null>(null)
  const recordingAudioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  /** Teacher soundtrack via Web Audio (not video.muted) so iOS keeps the page audio session alive for count TTS. */
  const playbackAudioContextRef = useRef<AudioContext | null>(null)
  const playbackSourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const playbackGainRef = useRef<GainNode | null>(null)
  const playbackWiredVideoRef = useRef<HTMLVideoElement | null>(null)
  const recordingFrameRef = useRef<number | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingSessionRef = useRef(0)
  const recordingStartedAtRef = useRef(0)
  const recordingUrlRef = useRef<string | null>(null)
  const recordingStatusRef = useRef<RecordingStatus>('idle')
  const pendingCameraStopRef = useRef(false)
  const countdownRestoreRef = useRef<{ time: number; wasPlaying: boolean } | null>(null)
  const videoStageRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const settingsDrawerRef = useRef<HTMLElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const gestureRef = useRef(new TeacherGesture())
  const analysisRef = useRef<AbortController | null>(null)
  const fileRef = useRef<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const externalAudioElRef = useRef<HTMLAudioElement | null>(null)
  const externalAudioUrlRef = useRef<string | null>(null)
  const externalFileRef = useRef<File | null>(null)
  const audioOffsetRef = useRef(0)
  const practiceKeyRef = useRef('')
  const [pickHint, setPickHint] = useState<DanceRecord | null>(null)
  const [notice, setNotice] = useState('')
  const [externalAudioName, setExternalAudioName] = useState<string | null>(null)
  const [externalAudioUrl, setExternalAudioUrl] = useState<string | null>(null)
  const [audioOffset, setAudioOffset] = useState(0)
  const [alignStatus, setAlignStatus] = useState<AlignStatus>('idle')
  const [alignScore, setAlignScore] = useState<number | null>(null)
  /** Bottom-bar two-step (or custom first-section) mark mode: click Music/Dance/自定义 → highlight bar → confirm on pointerup. */
  const [markKind, setMarkKind] = useState<null | 'music' | 'dance' | 'customFirst'>(null)
  const [dockExpanded, setDockExpanded] = useState(true)
  const [dockHint, setDockHint] = useState(() => safeStorage.getItem('adl-dock-hint') !== 'dismissed')
  const [menuPage, setMenuPage] = useState<'practice' | 'recording' | 'help' | 'saved' | 'audio'>('practice')
  const [sideRailOpen, setSideRailOpen] = useState(false)
  const [tempoStatus, setTempoStatus] = useState<TempoStatus>('manual')
  const [tempoSource, setTempoSource] = useState<TempoSource>('unset')
  const [tempoPhase, setTempoPhase] = useState<TempoPhase>('')
  const [tempoAlternatives, setTempoAlternatives] = useState<number[]>([])
  const [bpmEditorOpen, setBpmEditorOpen] = useState(false)
  const [audioOnsets, setAudioOnsets] = useState<TimedEvent[]>([])
  const [segmentMode, setSegmentMode] = useState<SegmentMode>('beats')
  const [customCuts, setCustomCuts] = useState<number[]>([])
  const [exportingCount, setExportingCount] = useState(false)
  const timelineRef = useRef<HTMLInputElement>(null)
  const scrubResumeRef = useRef<() => void>(() => {})
  const onsetRequestedRef = useRef('')
  const [tempoFailure, setTempoFailure] = useState('')
  const [confirmedTempoMode, setConfirmedTempoMode] = useState<SavedPracticeState['tempoMode']>('unset')
  const loopTimerRef = useRef<number | null>(null)
  const loopPendingRef = useRef(false)
  const [showLanding, setShowLanding] = useState(true)
  const [language, setLanguage] = useState<UiLanguage>(() => safeStorage.getItem('frametune-language') === 'en' ? 'en' : 'zh')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [practiceStorageKey, setPracticeStorageKey] = useState('')
  practiceKeyRef.current = practiceStorageKey
  audioOffsetRef.current = audioOffset
  externalAudioUrlRef.current = externalAudioUrl
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState('')
  const [speed, setSpeed] = useState(() => {
    const stored = readStoredNumber('adl-playback-speed', 1)
    return SPEEDS.includes(stored as (typeof SPEEDS)[number]) ? stored : 1
  })
  const [isMirrored, setIsMirrored] = useState(() => safeStorage.getItem('adl-mirrored') === 'true')
  const [volume, setVolume] = useState(() => Math.min(1, Math.max(0, readStoredNumber('adl-volume', 1))))
  const [isMuted, setIsMuted] = useState(false)
  const [orientation, setOrientation] = useState<VideoOrientation>('landscape')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('contain')
  const [singleTeacherFraming, setSingleTeacherFraming] = useState<TeacherFraming>(DEFAULT_TEACHER_FRAMING)
  const [splitTeacherFraming, setSplitTeacherFraming] = useState<TeacherFraming>(DEFAULT_TEACHER_FRAMING)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
  const [bpmInput, setBpmInput] = useState('100')
  const [bpm, setBpm] = useState(100)
  const [bpmError, setBpmError] = useState('')
  const [firstBeatTime, setFirstBeatTime] = useState<number | null>(null)
  const [firstBeatConfirmed, setFirstBeatConfirmed] = useState(false)
  const [rawFormalStartTime, setRawFormalStartTime] = useState<number | null>(null)
  const [formalStartTime, setFormalStartTime] = useState<number | null>(null)
  const [formalStartLabel, setFormalStartLabel] = useState('')
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0)
  const [rangeMode, setRangeMode] = useState<PracticeRangeMode>('current')
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('continuous')
  const [boundaryOffsets, setBoundaryOffsets] = useState<number[]>([])
  const [selectedBoundaryIndex, setSelectedBoundaryIndex] = useState(0)
  const [isLoopWaiting, setIsLoopWaiting] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'loading' | 'active' | 'error'>('idle')
  const [cameraMessage, setCameraMessage] = useState('')
  const [mirrorSelfView, setMirrorSelfView] = useState(true)
  const [countdownSeconds, setCountdownSeconds] = useState<3 | 5 | 10>(5)
  const [countdownValue, setCountdownValue] = useState<number | null>(null)
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle')
  const [recordingElapsed, setRecordingElapsed] = useState(0)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [recordingMimeType, setRecordingMimeType] = useState('')
  const [recordingError, setRecordingError] = useState('')
  const [recordingAudioNotice, setRecordingAudioNotice] = useState('')
  const [recordingHasTeacherAudio, setRecordingHasTeacherAudio] = useState(false)
  const [reviewSpeed, setReviewSpeed] = useState(1)
  const [, setTeacherViewportRevision] = useState(0)
  const text = (zh: string, en: string) => language === 'zh' ? zh : en

  const renderDisplayMode: DisplayMode = compareMode || (isFullscreen && orientation === 'portrait') ? 'contain' : displayMode
  const teacherFraming = compareMode ? splitTeacherFraming : singleTeacherFraming
  const canPanTeacher = teacherFraming.zoom > MIN_TEACHER_ZOOM || (!compareMode && renderDisplayMode === 'cover')
  // Eight-beat sections need music+dance markers only. While tempoStatus is still analyzing/unavailable,
  // use the current bpm state (default 100, last value, or in-editor value) as a temporary song tempo;
  // real auto/manual confirmation rebuilds via the same bpm dependency.
  const segmentBpm = bpm > 0 ? bpm : 100
  const naturalLearningSegments = useMemo(() => (
    firstBeatTime === null || !firstBeatConfirmed || formalStartTime === null || !duration
      ? [] : buildLearningSegments(duration, formalStartTime, firstBeatTime, segmentBpm)
  ), [duration, firstBeatConfirmed, firstBeatTime, formalStartTime, segmentBpm])
  const beatSegments = useMemo(() => (
    firstBeatTime === null ? naturalLearningSegments : applyBoundaryOffsets(naturalLearningSegments, boundaryOffsets, firstBeatTime, segmentBpm)
  ), [boundaryOffsets, firstBeatTime, naturalLearningSegments, segmentBpm])
  // The two segmentations are stored independently; BPM changes only ever touch the beat-based one.
  const customSegments = useMemo(() => buildCustomSegments(customCuts, duration), [customCuts, duration])
  const learningSegments = segmentMode === 'custom' ? customSegments : beatSegments
  const safeSegmentIndex = Math.min(currentSegmentIndex, Math.max(0, learningSegments.length - 1))
  const practiceRange = useMemo(() => getPracticeRange(rangeMode, learningSegments, safeSegmentIndex, duration, segmentBpm, segmentMode === 'beats'), [duration, learningSegments, rangeMode, safeSegmentIndex, segmentBpm, segmentMode])

  const coach = useCountCoach({
    videoRef, videoKey: practiceStorageKey, videoUrl, duration,
    bpm: tempoStatus === 'auto' || tempoStatus === 'manual' ? bpm : null,
    musicStart: firstBeatConfirmed ? firstBeatTime : null, danceStart: formalStartTime, audioOnsets, audioCandidates: tempoAlternatives,
  })
  // While the count is audible the video's own sound is muted / ducked (setting 数拍时原声) via GainNode — never video.muted (iOS muted kills the whole page audio session, including count TTS).
  const nativeGainRef = useRef(1)
  nativeGainRef.current = coach.nativeGain
  const teacherEffectiveGain = useCallback(() => (externalAudioUrlRef.current || isMuted ? 0 : volume * nativeGainRef.current), [externalAudioUrl, isMuted, volume])
  const applyTeacherGain = useCallback(() => {
    const effective = teacherEffectiveGain()
    if (playbackGainRef.current) playbackGainRef.current.gain.value = effective
    if (recordingAudioGainRef.current) recordingAudioGainRef.current.gain.value = effective
    const video = videoRef.current
    if (video) {
      // Keep element unmuted so Safari's audio session stays open for Web Audio count voice.
      video.volume = 1
      video.muted = false
    }
    ;(window as unknown as { __adlTeacherGain?: number }).__adlTeacherGain = effective
  }, [teacherEffectiveGain])
  // Wire MediaElementSource once per video element (key={videoUrl}). StrictMode-safe: reuse if already wired to this element; do not tear down on effect re-run.
  useEffect(() => {
    if (!videoUrl) {
      const ctx = playbackAudioContextRef.current
      try { playbackSourceRef.current?.disconnect() } catch { /* ignore */ }
      try { playbackGainRef.current?.disconnect() } catch { /* ignore */ }
      playbackSourceRef.current = null
      playbackGainRef.current = null
      playbackWiredVideoRef.current = null
      playbackAudioContextRef.current = null
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined)
      return
    }
    const video = videoRef.current
    if (!video) return
    if (playbackWiredVideoRef.current === video && playbackGainRef.current && playbackAudioContextRef.current?.state !== 'closed') {
      applyTeacherGain()
      void playbackAudioContextRef.current?.resume().catch(() => undefined)
      return
    }
    const prevCtx = playbackAudioContextRef.current
    if (prevCtx && prevCtx.state !== 'closed') {
      try { playbackSourceRef.current?.disconnect() } catch { /* ignore */ }
      try { playbackGainRef.current?.disconnect() } catch { /* ignore */ }
      playbackSourceRef.current = null
      playbackGainRef.current = null
      playbackWiredVideoRef.current = null
      playbackAudioContextRef.current = null
      void prevCtx.close().catch(() => undefined)
    }
    if (typeof AudioContext === 'undefined') return
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    let source: MediaElementAudioSourceNode
    try {
      source = ctx.createMediaElementSource(video)
    } catch {
      // Element already had a MediaElementSource (e.g. HMR). Fall back to element volume path.
      void ctx.close().catch(() => undefined)
      video.volume = teacherEffectiveGain()
      video.muted = false
      ;(window as unknown as { __adlTeacherGain?: number }).__adlTeacherGain = teacherEffectiveGain()
      return
    }
    const gainNode = ctx.createGain()
    gainNode.gain.value = teacherEffectiveGain()
    source.connect(gainNode)
    gainNode.connect(ctx.destination)
    playbackAudioContextRef.current = ctx
    playbackSourceRef.current = source
    playbackGainRef.current = gainNode
    playbackWiredVideoRef.current = video
    video.volume = 1
    video.muted = false
    ;(window as unknown as { __adlTeacherGain?: number }).__adlTeacherGain = gainNode.gain.value
    const resume = () => { void ctx.resume().catch(() => undefined) }
    resume()
    video.addEventListener('play', resume)
    return () => {
      video.removeEventListener('play', resume)
      // Keep graph alive across StrictMode re-run; real teardown happens when videoUrl changes (above) or unmount (below).
    }
  }, [videoUrl, applyTeacherGain, teacherEffectiveGain])
  useEffect(() => () => {
    const ctx = playbackAudioContextRef.current
    try { playbackSourceRef.current?.disconnect() } catch { /* ignore */ }
    try { playbackGainRef.current?.disconnect() } catch { /* ignore */ }
    playbackSourceRef.current = null
    playbackGainRef.current = null
    playbackWiredVideoRef.current = null
    playbackAudioContextRef.current = null
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined)
    try { externalAudioElRef.current?.pause() } catch { /* ignore */ }
    if (externalAudioUrlRef.current) URL.revokeObjectURL(externalAudioUrlRef.current)
    externalAudioUrlRef.current = null
    externalAudioElRef.current = null
  }, [])
  useEffect(() => { applyTeacherGain() }, [coach.nativeGain, volume, isMuted, videoUrl, applyTeacherGain, externalAudioUrl])

  // Music onsets lock the count's phase to the track. They are analysed lazily the first time the count is used.
  useEffect(() => {
    const file = fileRef.current
    if (!file || !videoUrl || !(coach.prefs.enabled || coach.prefs.overlay) || audioOnsets.length || tempoStatus === 'analyzing' || onsetRequestedRef.current === practiceStorageKey) return
    onsetRequestedRef.current = practiceStorageKey
    const requestedFor = practiceStorageKey
    void analyzeVideoAudioCached(file, new AbortController().signal).then(result => { if (practiceKeyRef.current === requestedFor) setAudioOnsets(result.onsets) }).catch(() => undefined) // a late result of the previous video must not land on the new one
  }, [audioOnsets.length, coach.prefs.enabled, coach.prefs.overlay, practiceStorageKey, tempoStatus, videoUrl])

  const cancelPendingLoop = useCallback(() => {
    if (loopTimerRef.current !== null) window.clearTimeout(loopTimerRef.current)
    loopTimerRef.current = null
    loopPendingRef.current = false
    setIsLoopWaiting(false)
  }, [])

  const updateRecordingStatus = useCallback((status: RecordingStatus) => {
    recordingStatusRef.current = status
    setRecordingStatus(status)
  }, [])

  const resetToPracticeIdle = useCallback(() => {
    cancelPendingLoop()
    countdownRestoreRef.current = null
    const video = videoRef.current
    if (video) {
      video.pause()
      video.currentTime = practiceRange.startTime
    }
    setCurrentTime(practiceRange.startTime)
    setIsPlaying(false)
    setIsLoopWaiting(false)
    setCountdownValue(null)
    setRecordingElapsed(0)
  }, [cancelPendingLoop, practiceRange.startTime])

  const closeReviewToPractice = useCallback(() => {
    setReviewOpen(false)
    resetToPracticeIdle()
    updateRecordingStatus('idle')
  }, [resetToPracticeIdle, updateRecordingStatus])

  const cleanupRecordingAudio = useCallback(() => {
    recordingAudioSourceRef.current?.disconnect()
    recordingAudioGainRef.current?.disconnect()
    recordingAudioDestinationRef.current?.disconnect()
    recordingAudioDestinationRef.current?.stream.getTracks().forEach((track) => track.stop())
    teacherCaptureStreamRef.current?.getTracks().forEach((track) => track.stop())
    recordingAudioSourceRef.current = null
    recordingAudioGainRef.current = null
    recordingAudioDestinationRef.current = null
    teacherCaptureStreamRef.current = null
    const context = recordingAudioContextRef.current
    recordingAudioContextRef.current = null
    if (context && context.state !== 'closed') void context.close()
  }, [])

  useEffect(() => {
    safeStorage.setItem('frametune-language', language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    setError('')
    setBpmError('')
    if (cameraStatus === 'loading') setCameraMessage(language === 'zh' ? '正在启动摄像头…' : 'Starting camera…')
    else if (cameraStatus === 'error') setCameraMessage(language === 'zh' ? '摄像头不可用。请关闭后重试。' : 'Camera unavailable. Turn it off and try again.')
  }, [language])

  useEffect(() => () => {
    analysisRef.current?.abort()
    cancelPendingLoop()
    recordingSessionRef.current += 1
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current)
    if (recordingFrameRef.current !== null) cancelAnimationFrame(recordingFrameRef.current)
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop()
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    cleanupRecordingAudio()
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
    cameraRequestRef.current += 1
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [cancelPendingLoop, cleanupRecordingAudio])

  useEffect(() => {
    const cameraVideo = cameraVideoRef.current
    const stream = cameraStreamRef.current
    if (!cameraVideo || !stream || cameraStatus !== 'active') return
    cameraVideo.srcObject = stream
    void cameraVideo.play().catch(() => setCameraMessage(text('摄像头已连接，但画面无法自动播放。', 'The camera is connected, but the self-view could not start automatically.')))
  }, [cameraStatus, compareMode, language])

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === playerRef.current)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  // Floating panel: drag its header down to dismiss (plus Close / Escape / tap on the video).
  const sheetDragRef = useRef<{ id: number; y: number } | null>(null)
  const startSheetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button')) return
    sheetDragRef.current = { id: event.pointerId, y: event.clientY }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const moveSheetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sheetDragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const sheet = event.currentTarget.parentElement
    const dy = Math.max(0, event.clientY - drag.y)
    if (sheet) { sheet.style.transition = 'none'; sheet.style.transform = dy ? `translateY(${dy}px)` : '' }
  }
  const endSheetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sheetDragRef.current
    if (!drag || drag.id !== event.pointerId) return
    sheetDragRef.current = null
    const sheet = event.currentTarget.parentElement
    if (sheet) { sheet.style.transition = ''; sheet.style.transform = '' }
    if (event.type === 'pointerup' && event.clientY - drag.y > 70) setSettingsDrawerOpen(false)
  }

  useEffect(() => {
    if (!settingsDrawerOpen && !sideRailOpen) return
    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSettingsDrawerOpen(false); setSideRailOpen(false) }
    }
    const closeOnUnrelatedClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (settingsDrawerRef.current?.contains(target)) return
      if ((event.target as Element | null)?.closest?.('.menu-cluster')) return
      // The dock stays usable while a panel floats over the video (scrub to move a boundary, play, etc.).
      if ((event.target as Element | null)?.closest?.('.practice-dock') && settingsDrawerOpen) return
      if (playerRef.current?.contains(target) && settingsDrawerOpen) { setSettingsDrawerOpen(false); return }
      if (!playerRef.current?.contains(target)) { setSettingsDrawerOpen(false); setSideRailOpen(false) }
    }
    window.addEventListener('keydown', handleDrawerKeyDown)
    document.addEventListener('mousedown', closeOnUnrelatedClick)
    return () => {
      window.removeEventListener('keydown', handleDrawerKeyDown)
      document.removeEventListener('mousedown', closeOnUnrelatedClick)
    }
  }, [settingsDrawerOpen, sideRailOpen])

  useEffect(() => {
    if (!reviewOpen) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    setIsFullscreen(false)
    const closeReviewOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeReviewToPractice()
    }
    window.addEventListener('keydown', closeReviewOnEscape)
    return () => window.removeEventListener('keydown', closeReviewOnEscape)
  }, [closeReviewToPractice, reviewOpen])

  useEffect(() => {
    if (!practiceStorageKey) return
    safeStorage.setItem(practiceStorageKey, JSON.stringify({
      schemaVersion: 2, tempoMode: confirmedTempoMode,
      bpm, firstBeatTime, firstBeatConfirmed, rawFormalStartTime, formalStartTime, formalStartLabel,
      currentSegmentIndex: tempoStatus === 'analyzing' || tempoStatus === 'editing' ? currentSegmentIndex : safeSegmentIndex, rangeMode, playbackMode, boundaryOffsets,
      tempoSource, segmentMode, customCuts,
    } satisfies SavedPracticeState))
    void patchDance(danceId(practiceStorageKey), { practice: safeStorage.getItem(practiceStorageKey) ?? undefined, duration: duration || undefined }, { name: fileName, size: fileSize })
  }, [duration, fileName, fileSize, customCuts, segmentMode, tempoSource, boundaryOffsets, bpm, confirmedTempoMode, currentSegmentIndex, firstBeatConfirmed, firstBeatTime, formalStartLabel, formalStartTime, playbackMode, practiceStorageKey, rangeMode, rawFormalStartTime, safeSegmentIndex, tempoStatus])

  const seekBy = useCallback((seconds: number) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) return
    cancelPendingLoop()
    const nextTime = Math.min(video.duration, Math.max(0, video.currentTime + seconds))
    video.currentTime = nextTime
    setCurrentTime(nextTime)
  }, [cancelPendingLoop])

  const pauseAndSeek = (time: number) => {
    const video = videoRef.current
    const nextTime = Math.min(duration, Math.max(0, time))
    cancelPendingLoop()
    if (video) {
      video.pause()
      video.currentTime = nextTime
    }
    setCurrentTime(nextTime)
  }

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current
    if (!videoUrl || !video) return
    if (!video.paused || isLoopWaiting) {
      cancelPendingLoop()
      video.pause()
      return
    }
    try {
      if (!markKind && !(settingsDrawerOpen && menuPage === 'practice') && (video.currentTime >= practiceRange.endTime - 0.04 || video.currentTime < practiceRange.startTime)) video.currentTime = practiceRange.startTime
      await video.play()
      setError('')
    } catch {
      setError(text('无法播放此视频。请确认文件格式受浏览器支持。', 'This video could not be played. Check that its format is supported by your browser.'))
    }
  }, [cancelPendingLoop, isLoopWaiting, language, practiceRange.endTime, practiceRange.startTime, videoUrl, markKind, menuPage, settingsDrawerOpen])

  const changeSegment = useCallback((index: number) => {
    if (!learningSegments.length) return
    cancelPendingLoop()
    const nextIndex = Math.min(Math.max(0, index), learningSegments.length - 1)
    setCurrentSegmentIndex(nextIndex)
    const nextStart = getPracticeRange(rangeMode, learningSegments, nextIndex, duration, bpm, segmentMode === 'beats').startTime
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = nextStart }
    setCurrentTime(nextStart)
  }, [bpm, cancelPendingLoop, duration, learningSegments, rangeMode, segmentMode])

  const changePlaybackMode = useCallback((mode: PlaybackMode) => {
    cancelPendingLoop()
    setPlaybackMode(mode)
  }, [cancelPendingLoop])

  const handleTimeUpdate = (video: HTMLVideoElement) => {
    setCurrentTime(video.currentTime)
    if (markKind || (settingsDrawerOpen && menuPage === 'practice') || !learningSegments.length || video.paused || loopPendingRef.current || video.currentTime < practiceRange.endTime - 0.04) return
    if (playbackMode === 'continuous') {
      video.pause()
      video.currentTime = practiceRange.endTime
      return
    }
    loopPendingRef.current = true
    video.pause()
    setIsLoopWaiting(true)
    loopTimerRef.current = window.setTimeout(() => {
      loopTimerRef.current = null
      loopPendingRef.current = false
      setIsLoopWaiting(false)
      video.currentTime = practiceRange.startTime
      void video.play().catch(() => setError(text('循环播放无法自动继续，请点击播放。', 'Loop playback could not resume automatically. Select Play to continue.')))
    }, 2000)
  }

  const toggleMirror = useCallback(() => {
    setIsMirrored((current) => {
      safeStorage.setItem('adl-mirrored', String(!current))
      return !current
    })
  }, [])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement === playerRef.current) await document.exitFullscreen()
      else if (isFullscreen) setIsFullscreen(false)
      else if (playerRef.current?.requestFullscreen) await playerRef.current.requestFullscreen()
      else setIsFullscreen(true)
    } catch {
      setError(text('浏览器无法切换全屏模式。', 'The browser could not switch fullscreen mode.'))
    }
  }, [language, isFullscreen])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return
      const key = event.key.toLowerCase()
      if (event.code === 'Space' && target?.tagName === 'BUTTON') return
      if (event.code === 'Space') { event.preventDefault(); void togglePlayback() }
      else if (event.code === 'ArrowLeft') { event.preventDefault(); seekBy(-2) }
      else if (event.code === 'ArrowRight') { event.preventDefault(); seekBy(2) }
      else if (event.code === 'ArrowUp') { event.preventDefault(); changeSegment(safeSegmentIndex - 1) }
      else if (event.code === 'ArrowDown') { event.preventDefault(); changeSegment(safeSegmentIndex + 1) }
      else if (key === 'm') { event.preventDefault(); toggleMirror() }
      else if (key === 'l') { event.preventDefault(); changePlaybackMode(playbackMode === 'loop' ? 'continuous' : 'loop') }
      else if (key === 'f') { event.preventDefault(); void toggleFullscreen() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [changePlaybackMode, changeSegment, playbackMode, safeSegmentIndex, seekBy, toggleFullscreen, toggleMirror, togglePlayback])


  const clearExternalAudio = useCallback(() => {
    const el = externalAudioElRef.current
    if (el) { try { el.pause() } catch { /* ignore */ }; el.removeAttribute('src'); el.load() }
    externalAudioElRef.current = null
    externalFileRef.current = null
    if (externalAudioUrlRef.current) URL.revokeObjectURL(externalAudioUrlRef.current)
    externalAudioUrlRef.current = null
    setExternalAudioUrl(null)
    setExternalAudioName(null)
    setAudioOffset(0)
    audioOffsetRef.current = 0
    setAlignStatus('idle')
    setAlignScore(null)
    // Restore native gain path on next applyTeacherGain.
    queueMicrotask(() => applyTeacherGain())
  }, [applyTeacherGain])

  const syncExternalAudio = useCallback((forceSeek = false) => {
    const video = videoRef.current
    const audio = externalAudioElRef.current
    if (!video || !audio || !externalAudioUrlRef.current) return
    const target = externalTimeAt(video.currentTime, audioOffsetRef.current)
    audio.playbackRate = video.playbackRate || 1
    audio.volume = isMuted ? 0 : volume
    if (!(audio.duration > 0) || target < 0 || target > audio.duration) {
      if (!audio.paused) audio.pause()
      return
    }
    if (forceSeek || Math.abs(audio.currentTime - target) > 0.12) {
      try { audio.currentTime = target } catch { /* ignore seek errors while loading */ }
    }
    if (!video.paused && !video.ended) {
      if (audio.paused) void audio.play().catch(() => undefined)
    } else if (!audio.paused) {
      audio.pause()
    }
  }, [isMuted, volume])

  // Keep the replacement soundtrack locked to the teacher video clock (play/pause/seek/rate).
  useEffect(() => {
    const video = videoRef.current
    if (!video || !externalAudioUrl) return
    const bump = () => syncExternalAudio(true)
    const soft = () => syncExternalAudio(false)
    video.addEventListener('play', bump)
    video.addEventListener('pause', bump)
    video.addEventListener('seeking', bump)
    video.addEventListener('seeked', bump)
    video.addEventListener('ratechange', bump)
    video.addEventListener('timeupdate', soft)
    applyTeacherGain()
    syncExternalAudio(true)
    return () => {
      video.removeEventListener('play', bump)
      video.removeEventListener('pause', bump)
      video.removeEventListener('seeking', bump)
      video.removeEventListener('seeked', bump)
      video.removeEventListener('ratechange', bump)
      video.removeEventListener('timeupdate', soft)
    }
  }, [externalAudioUrl, audioOffset, syncExternalAudio, applyTeacherGain, speed, isMuted, volume])

  const runExternalAlign = useCallback(async () => {
    const videoFile = fileRef.current
    const audioFile = externalFileRef.current
    if (!videoFile || !audioFile) return
    setAlignStatus('running')
    setAlignScore(null)
    try {
      const guess = await guessOffsetBetweenFiles(videoFile, audioFile)
      setAudioOffset(guess.offsetSeconds)
      audioOffsetRef.current = guess.offsetSeconds
      setAlignScore(guess.score)
      setAlignStatus('done')
      syncExternalAudio(true)
    } catch {
      setAlignStatus('failed')
    }
  }, [syncExternalAudio])

  const handleExternalAudioChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!isExternalAudioFile(file)) {
      setError(text('请选择 mp3 / aac / wav 等音频文件。', 'Choose an mp3 / aac / wav audio file.'))
      return
    }
    if (!videoUrl || !fileRef.current) {
      setError(text('请先选择舞蹈视频，再上传外挂音频。', 'Choose a dance video before uploading a soundtrack.'))
      return
    }
    clearExternalAudio()
    const url = URL.createObjectURL(file)
    externalFileRef.current = file
    externalAudioUrlRef.current = url
    setExternalAudioUrl(url)
    setExternalAudioName(file.name)
    setAudioOffset(0)
    audioOffsetRef.current = 0
    setAlignStatus('idle')
    setAlignScore(null)
    setError('')
    const audio = new Audio()
    audio.preload = 'auto'
    audio.src = url
    externalAudioElRef.current = audio
    applyTeacherGain()
    const onReady = () => { syncExternalAudio(true); void runExternalAlign() }
    if (audio.readyState >= 1) onReady()
    else audio.addEventListener('loadedmetadata', onReady, { once: true })
    // Key / studio originals often decode cleaner than the phone room mix — re-detect BPM from this track.
    runTempoAnalysis(file, bpm, { force: true })
  }

  /** "Change video": save this video's alignment, stop playback, then open the file picker. */
  const openVideoPicker = (hint: DanceRecord | null = null) => {
    if (recordingStatus === 'recording' || recordingStatus === 'countdown' || recordingStatus === 'processing') return
    cancelPendingLoop()
    videoRef.current?.pause()
    if (practiceStorageKey) {
      void patchDance(danceId(practiceStorageKey), { practice: safeStorage.getItem(practiceStorageKey) ?? undefined, count: safeStorage.getItem(countKeyOf(practiceStorageKey)) ?? undefined, duration: duration || undefined }, { name: fileName, size: fileSize })
    }
    setPickHint(hint); setNotice('')
    setSettingsDrawerOpen(false)
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setError(text('不支持此文件格式。请选择 MP4、MOV 或 WebM 视频。', 'This file format is not supported. Choose an MP4, MOV, or WebM video.'))
      event.target.value = ''
      return
    }
    cancelPendingLoop()
    analysisRef.current?.abort()
    onsetRequestedRef.current = ''
    if (pickHint) {
      const same = `${file.name}:${file.size}` === pickHint.id
      setNotice(same ? text(`已恢复「${pickHint.name}」的对齐`, `Restored alignment for "${pickHint.name}"`) : text(`所选文件和保存的「${pickHint.name}」不一致，按新视频处理`, `The chosen file does not match the saved "${pickHint.name}"; treated as a new video`))
      setPickHint(null)
    }
    fileRef.current = file
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const storageKey = videoStorageKey(file)
    await hydrateFromDance(storageKey)
    const saved = readPracticeState(storageKey)
    setConfirmedTempoMode(saved.tempoMode)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setVideoUrl(url); setFileName(file.name); setFileSize(file.size); setPracticeStorageKey(storageKey)
    setBpm(saved.bpm); setBpmInput(saved.tempoMode === 'manual' ? String(saved.bpm) : ''); setFirstBeatTime(saved.firstBeatTime); setFirstBeatConfirmed(saved.firstBeatConfirmed)
    setRawFormalStartTime(saved.rawFormalStartTime); setFormalStartTime(saved.formalStartTime); setFormalStartLabel(saved.formalStartLabel)
    setCurrentSegmentIndex(saved.currentSegmentIndex); setRangeMode(saved.rangeMode); setPlaybackMode(saved.playbackMode); setBoundaryOffsets(saved.boundaryOffsets); setSelectedBoundaryIndex(0)
    setSegmentMode(saved.segmentMode); setCustomCuts(saved.customCuts); setTempoSource(saved.tempoMode === 'auto' && saved.tempoSource === 'unset' ? 'onset' : saved.tempoSource); setAudioOnsets([]); setTempoAlternatives([]); setBpmEditorOpen(false); setTempoPhase(''); onsetRequestedRef.current = ''
    setSingleTeacherFraming(DEFAULT_TEACHER_FRAMING); setSplitTeacherFraming(DEFAULT_TEACHER_FRAMING); setDisplayMode('contain')
    setMarkKind(null); setSettingsDrawerOpen(false); setSideRailOpen(false); setMenuPage('practice'); setDockExpanded(true); setDuration(0); setCurrentTime(0); setIsPlaying(false); setOrientation('landscape'); setError('')
    gestureRef.current.reset()
    if (saved.tempoMode === 'manual') { setTempoStatus('manual'); setTempoFailure('') }
    else runTempoAnalysis(file, saved.bpm)
    event.target.value = ''
  }

  const runTempoAnalysis = (file: File, previousBpm?: number, opts?: { force?: boolean }) => {
    analysisRef.current?.abort()
    const controller = new AbortController()
    analysisRef.current = controller
    setTempoStatus('analyzing'); setTempoFailure(''); setBpmInput(''); setBpmError('')
    setTempoPhase('catalog')
    setBpmEditorOpen(false) // never force a typing box into the start-markers row
    const adopt = (value: number, source: TempoSource) => {
      cancelPendingLoop()
      setBpm(value); setBpmInput(String(value))
      if (previousBpm === undefined || Math.abs(previousBpm - value) > Math.max(.5, previousBpm * .01)) { setBoundaryOffsets([]); setSelectedBoundaryIndex(0) }
      setTempoStatus('auto'); setConfirmedTempoMode('auto'); setTempoSource(source); setTempoPhase('')
      setBpmEditorOpen(false)
    }
    const paint = async () => {
      await new Promise<void>(resolve => { requestAnimationFrame(() => resolve()) })
      // Brief dwell so「正在匹配曲库 / 读取标签」is readable before the next step.
      await new Promise<void>(resolve => setTimeout(resolve, 180))
    }
    void (async () => {
      // 1) Filename/size catalog (matched-tempo.json) — first attempt; first success wins.
      setTempoPhase('catalog'); await paint()
      const matched = await lookupMatchedTempo(file)
      if (controller.signal.aborted) return
      if (matched) adopt(matched.bpm, 'matched')

      // 2) Embedded tags (MP4 tmpo / ID3 TBPM) if catalog missed.
      setTempoPhase('tag'); await paint()
      const embedded = await readEmbeddedTempo(blobSource(file))
      if (controller.signal.aborted) return
      if (!matched && embedded) adopt(embedded.bpm, 'tag')

      // 3) Onset auto-detect — always collect onsets; adopt BPM only if still unresolved.
      setTempoPhase('onset'); await paint()
      try {
        const result = await analyzeVideoAudioCached(file, controller.signal, { force: opts?.force })
        if (controller.signal.aborted) return
        setAudioOnsets(result.onsets)
        const prior = matched?.bpm ?? embedded?.bpm
        const fromTempo = result.tempo ? [...(prior ? [result.tempo.bpm] : []), ...result.tempo.alternatives] : []
        const candidates = [...fromTempo, ...(result.suggestions ?? [])].filter((value, index, all) =>
          (!prior || Math.abs(value / prior - 1) > .02) && all.findIndex(o => Math.abs(o / value - 1) < .02) === index)
        setTempoAlternatives(candidates.slice(0, 5))
        if (matched || embedded) { setTempoPhase(''); return }
        // Soft confidence; auto-adopt best suggestion; no forced typing box.
        if (result.tempo && result.tempo.confidence >= .08) {
          adopt(result.tempo.bpm, 'onset')
          return
        }
        const soft = result.suggestions?.[0]
        if (soft) {
          adopt(soft, 'onset')
          return
        }
        setTempoStatus('unavailable'); setTempoFailure('unstable'); setTempoPhase('')
      } catch (failure: unknown) {
        if (!controller.signal.aborted && !matched && !embedded) {
          setTempoStatus('unavailable')
          setTempoFailure(failure instanceof Error ? failure.message : 'analysis-failed')
          setTempoPhase('')
        } else if (!controller.signal.aborted) {
          setTempoPhase('')
        }
      }
    })()
  }

  const markTimelineStart = (kind: 'music' | 'dance') => {
    const time = videoRef.current?.currentTime ?? currentTime
    if (time >= duration - .25) { setError(text('起点需要放在视频结束之前。', 'Choose a start before the video ends.')); return }
    if (kind === 'dance' && !firstBeatConfirmed) { setError(text('请先设置音乐起点。', 'Set music start first.')); return }
    if (kind === 'dance' && firstBeatTime !== null && time < firstBeatTime) { setError(text('动作起点不能早于音乐起点。', 'Dance start must be after music start.')); return }
    if (kind === 'music') {
      setFirstBeatTime(time); setFirstBeatConfirmed(true)
      if (formalStartTime !== null && formalStartTime < time) { setFormalStartTime(null); setRawFormalStartTime(null); setFormalStartLabel('') }
      coach.updateSettings({ anchorMode: 'music' })
    } else {
      setRawFormalStartTime(time); setFormalStartTime(time)
      setFormalStartLabel(firstBeatTime === null ? '' : nearestBeatPoint(time, firstBeatTime, bpm).label)
      coach.updateSettings({ anchorMode: 'dance' })
    }
    setBoundaryOffsets([]); setSelectedBoundaryIndex(0); setCurrentSegmentIndex(0); setMarkKind(null); setError('')
    pauseAndSeek(time)
  }

  /** Confirm whatever markKind is active at the current playhead (bar click / release). */
  const confirmMarkAtPlayhead = () => {
    if (markKind === 'music') { markTimelineStart('music'); return }
    if (markKind === 'dance') { markTimelineStart('dance'); return }
    if (markKind === 'customFirst') {
      const time = videoRef.current?.currentTime ?? currentTime
      const cuts = evenCutsFromFirst(time, duration)
      if (!cuts.length) { setError(text('第一小节太短或太长，请拖到合适位置再确认。', 'First section is too short or too long — drag, then confirm.')); return }
      setCustomCuts(cuts); setSegmentMode('custom'); setCurrentSegmentIndex(0); setMarkKind(null); setError('')
      pauseAndSeek(0)
    }
  }

  const beginMark = (kind: 'music' | 'dance' | 'customFirst') => {
    if (kind === 'dance' && !firstBeatConfirmed) { setError(text('请先设置音乐起点。', 'Set music start first.')); return }
    cancelPendingLoop(); videoRef.current?.pause()
    setError('')
    setMarkKind(current => current === kind ? null : kind)
    setSettingsDrawerOpen(false); setSideRailOpen(false)
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = speed; video.volume = 1; video.muted = false; applyTeacherGain()
    setOrientation(video.videoWidth === video.videoHeight ? 'square' : video.videoWidth > video.videoHeight ? 'landscape' : 'portrait')
    setDisplayMode('contain'); setSingleTeacherFraming(DEFAULT_TEACHER_FRAMING); setSplitTeacherFraming(DEFAULT_TEACHER_FRAMING)
    setDuration(Number.isFinite(video.duration) ? video.duration : 0)
    setError('')
  }

  const getTeacherPanBounds = (zoom: number, mode = renderDisplayMode) => {
    const video = videoRef.current
    const stage = videoStageRef.current
    if (!video?.videoWidth || !video.videoHeight || !stage?.clientWidth || !stage.clientHeight) return { x: 0, y: 0 }
    const fitScale = mode === 'cover'
      ? Math.max(stage.clientWidth / video.videoWidth, stage.clientHeight / video.videoHeight)
      : Math.min(stage.clientWidth / video.videoWidth, stage.clientHeight / video.videoHeight)
    const renderedWidth = video.videoWidth * fitScale * zoom
    const renderedHeight = video.videoHeight * fitScale * zoom
    return {
      x: Math.max(0, (renderedWidth - stage.clientWidth) / 2),
      y: Math.max(0, (renderedHeight - stage.clientHeight) / 2),
    }
  }

  const clampTeacherFraming = (framing: TeacherFraming, mode = renderDisplayMode) => {
    const zoom = Math.min(MAX_TEACHER_ZOOM, Math.max(MIN_TEACHER_ZOOM, framing.zoom))
    const bounds = getTeacherPanBounds(zoom, mode)
    return {
      zoom,
      panX: bounds.x ? Math.min(bounds.x, Math.max(-bounds.x, framing.panX)) : 0,
      panY: bounds.y ? Math.min(bounds.y, Math.max(-bounds.y, framing.panY)) : 0,
    }
  }

  const setCurrentTeacherFraming = (updater: (current: TeacherFraming) => TeacherFraming) => {
    if (compareMode) setSplitTeacherFraming((current) => clampTeacherFraming(updater(current), 'contain'))
    else setSingleTeacherFraming((current) => clampTeacherFraming(updater(current), displayMode))
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    gestureRef.current.start(event.pointerId, event.clientX, event.clientY, clampTeacherFraming(teacherFraming))
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const framing = gestureRef.current.move(event.pointerId, event.clientX, event.clientY)
    if (framing) setCurrentTeacherFraming(() => framing)
  }
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const tap = gestureRef.current.end(event.pointerId, event.type === 'pointercancel')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (tap) void togglePlayback()
  }

  useEffect(() => {
    const stage = videoStageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setTeacherViewportRevision((revision) => revision + 1))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [compareMode, isFullscreen, videoUrl])

  const applyBpm = (value?: number) => {
    const next = value ?? Number(bpmInput)
    if (!Number.isFinite(next) || next < 40 || next > 240) { setBpmError(text('请输入 40–240 之间的 BPM。', 'Enter a BPM between 40 and 240.')); return }
    analysisRef.current?.abort()
    cancelPendingLoop(); videoRef.current?.pause()
    setBpm(next); setBpmInput(String(next)); setBpmError(''); setTempoStatus('manual'); setConfirmedTempoMode('manual'); setTempoSource('manual'); setTempoFailure(''); setTempoPhase(''); setBoundaryOffsets([]); setSelectedBoundaryIndex(0)
  }
  const selectPracticeRange = (mode: PracticeRangeMode) => {
    cancelPendingLoop(); setRangeMode(mode)
    const nextStart = getPracticeRange(mode, learningSegments, safeSegmentIndex, duration, bpm, segmentMode === 'beats').startTime
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = nextStart }
    setCurrentTime(nextStart)
  }
  const applyBoundaryAtTime = (index: number, time: number) => {
    const naturalBoundary = naturalLearningSegments[index]?.endTime
    if (naturalBoundary === undefined) return
    const before = learningSegments[index]?.startTime
    const after = learningSegments[index + 1]?.endTime ?? duration
    if (before === undefined || time <= before + .25 || time >= after - .25) { setError(text('请选择相邻分界之间的位置。', 'Choose a position between the neighboring boundaries.')); return }
    setError('')
    setSelectedBoundaryIndex(index)
    setBoundaryOffsets((current) => {
      const next = [...current]
      next[index] = time - naturalBoundary
      return next
    })
  }
  /** Instant write: scrub playhead → nearest (or selected) beat boundary. */
  const applyBoundaryAtPlayhead = () => {
    if (segmentMode !== 'beats' || learningSegments.length < 2) return
    const time = videoRef.current?.currentTime ?? currentTime
    let best = Math.min(selectedBoundaryIndex, learningSegments.length - 2)
    let bestDist = Infinity
    for (let i = 0; i < learningSegments.length - 1; i++) {
      const d = Math.abs(time - learningSegments[i].endTime)
      if (d < bestDist) { bestDist = d; best = i }
    }
    applyBoundaryAtTime(best, time)
  }
  const addCustomCut = () => {
    const next = addCut(customCuts, videoRef.current?.currentTime ?? currentTime, duration)
    if (!next) { setError(text('这里不能添加分界：离视频两端或已有分界太近。', 'Cannot add a cut here: too close to an edge or another cut.')); return }
    setError(''); setCustomCuts(next); setCurrentSegmentIndex(0)
  }
  const moveCustomCut = (index: number, time: number) => {
    const next = moveCut(customCuts, index, time, duration)
    if (next) { setError(''); setCustomCuts(next) }
    else setError(text('分界需与相邻分界至少相隔 0.5 秒。', 'Keep cuts at least 0.5 s apart.'))
  }
  const switchSegmentMode = (mode: SegmentMode) => {
    if (mode === segmentMode) return
    cancelPendingLoop(); videoRef.current?.pause()
    setSegmentMode(mode); setCurrentSegmentIndex(0); setError('')
    const start = mode === 'custom' ? 0 : naturalLearningSegments.length ? getPracticeRange(rangeMode, beatSegments, 0, duration, bpm, true).startTime : 0
    if (videoRef.current) videoRef.current.currentTime = start
    setCurrentTime(start)
  }

  // Timeline drag ends (mouse, touch or keyboard) → keep practising: resume playback, even from a pause.
  const resumeAfterScrub = () => {
    const video = videoRef.current
    if (!video || !videoUrl) return
    if (markKind || (settingsDrawerOpen && menuPage === 'practice') || recordingStatusRef.current === 'countdown' || recordingStatusRef.current === 'processing') return
    const time = video.currentTime
    if (learningSegments.length && (time < practiceRange.startTime - .001 || time >= practiceRange.endTime - .04)) setCurrentSegmentIndex(segmentIndexAt(learningSegments, time))
    cancelPendingLoop()
    void video.play().then(() => setError('')).catch(() => setError(text('无法播放此视频。请确认文件格式受浏览器支持。', 'This video could not be played. Check that its format is supported by your browser.')))
  }
  scrubResumeRef.current = resumeAfterScrub
  useEffect(() => {
    const input = timelineRef.current
    if (!input) return
    const done = () => scrubResumeRef.current()
    input.addEventListener('change', done)
    return () => input.removeEventListener('change', done)
  }, [videoUrl, showLanding])

  const changeSpeed = (next: number) => {
    if (videoRef.current) videoRef.current.playbackRate = next
    if (externalAudioElRef.current) externalAudioElRef.current.playbackRate = next
    setSpeed(next); safeStorage.setItem('adl-playback-speed', String(next))
  }
  const changeVolume = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value)
    const muted = next === 0
    setVolume(next); setIsMuted(muted); safeStorage.setItem('adl-volume', String(next))
    const effective = externalAudioUrlRef.current || muted ? 0 : next * nativeGainRef.current
    if (playbackGainRef.current) playbackGainRef.current.gain.value = effective
    if (recordingAudioGainRef.current) recordingAudioGainRef.current.gain.value = effective
    if (videoRef.current) { videoRef.current.volume = 1; videoRef.current.muted = false }
    const ext = externalAudioElRef.current
    if (ext) ext.volume = muted ? 0 : next
    ;(window as unknown as { __adlTeacherGain?: number }).__adlTeacherGain = effective
    void playbackAudioContextRef.current?.resume().catch(() => undefined)
  }
  const toggleMute = () => {
    const next = !isMuted
    setIsMuted(next)
    const effective = externalAudioUrlRef.current || next ? 0 : volume * nativeGainRef.current
    if (playbackGainRef.current) playbackGainRef.current.gain.value = effective
    if (recordingAudioGainRef.current) recordingAudioGainRef.current.gain.value = effective
    if (videoRef.current) { videoRef.current.volume = 1; videoRef.current.muted = false }
    const ext = externalAudioElRef.current
    if (ext) ext.volume = next ? 0 : volume
    ;(window as unknown as { __adlTeacherGain?: number }).__adlTeacherGain = effective
  }

  const releaseCamera = useCallback(() => {
    cameraRequestRef.current += 1
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null
    setCompareMode(false)
    setCameraStatus('idle')
    setCameraMessage('')
  }, [])

  const drawRecordingFrame = useCallback(() => {
    const canvas = recordingCanvasRef.current
    const teacher = videoRef.current
    const learner = cameraVideoRef.current
    const stage = videoStageRef.current
    if (!canvas || !teacher?.videoWidth || !teacher.videoHeight || !learner?.videoWidth || !learner.videoHeight || !stage) return
    const context = canvas.getContext('2d')
    if (!context) return
    const panelWidth = RECORDING_WIDTH / 2
    context.fillStyle = '#050505'
    context.fillRect(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT)

    const viewportScale = Math.min(panelWidth / stage.clientWidth, RECORDING_HEIGHT / stage.clientHeight)
    const viewportWidth = stage.clientWidth * viewportScale
    const viewportHeight = stage.clientHeight * viewportScale
    const viewportX = (panelWidth - viewportWidth) / 2
    const viewportY = (RECORDING_HEIGHT - viewportHeight) / 2
    const fitScale = renderDisplayMode === 'cover'
      ? Math.max(stage.clientWidth / teacher.videoWidth, stage.clientHeight / teacher.videoHeight)
      : Math.min(stage.clientWidth / teacher.videoWidth, stage.clientHeight / teacher.videoHeight)
    const framing = clampTeacherFraming(teacherFraming)
    const teacherWidth = teacher.videoWidth * fitScale * framing.zoom * viewportScale
    const teacherHeight = teacher.videoHeight * fitScale * framing.zoom * viewportScale
    const teacherX = viewportX + viewportWidth / 2 + framing.panX * viewportScale
    const teacherY = viewportY + viewportHeight / 2 + framing.panY * viewportScale
    context.save()
    context.beginPath()
    context.rect(viewportX, viewportY, viewportWidth, viewportHeight)
    context.clip()
    context.translate(teacherX, teacherY)
    context.scale(isMirrored ? -1 : 1, 1)
    context.drawImage(teacher, -teacherWidth / 2, -teacherHeight / 2, teacherWidth, teacherHeight)
    context.restore()

    const learnerScale = Math.min(panelWidth / learner.videoWidth, RECORDING_HEIGHT / learner.videoHeight)
    const learnerWidth = learner.videoWidth * learnerScale
    const learnerHeight = learner.videoHeight * learnerScale
    context.save()
    context.beginPath()
    context.rect(panelWidth, 0, panelWidth, RECORDING_HEIGHT)
    context.clip()
    context.translate(panelWidth + panelWidth / 2, RECORDING_HEIGHT / 2)
    context.scale(mirrorSelfView ? -1 : 1, 1)
    context.drawImage(learner, -learnerWidth / 2, -learnerHeight / 2, learnerWidth, learnerHeight)
    context.restore()
  }, [isMirrored, mirrorSelfView, renderDisplayMode, teacherFraming])

  const stopRecording = useCallback(() => {
    recordingSessionRef.current += 1
    setCountdownValue(null)
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current)
    recordingTimerRef.current = null
    if (recordingFrameRef.current !== null) cancelAnimationFrame(recordingFrameRef.current)
    recordingFrameRef.current = null
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      updateRecordingStatus('processing')
      recorder.stop()
    }
    resetToPracticeIdle()
  }, [resetToPracticeIdle, updateRecordingStatus])

  const cancelCountdown = useCallback(() => {
    if (recordingStatusRef.current !== 'countdown') return
    recordingSessionRef.current += 1
    setCountdownValue(null)
    updateRecordingStatus('idle')
    const restore = countdownRestoreRef.current
    const video = videoRef.current
    countdownRestoreRef.current = null
    if (restore && video) {
      video.currentTime = restore.time
      setCurrentTime(restore.time)
      if (restore.wasPlaying) void video.play().catch(() => undefined)
    }
  }, [updateRecordingStatus])

  const stopCamera = useCallback(() => {
    if (recordingStatusRef.current === 'countdown') cancelCountdown()
    if (recordingStatusRef.current === 'recording' || recordingStatusRef.current === 'processing') {
      pendingCameraStopRef.current = true
      stopRecording()
      return
    }
    releaseCamera()
  }, [cancelCountdown, releaseCamera, stopRecording])

  const beginMediaRecording = useCallback(async () => {
    const canvas = recordingCanvasRef.current
    const teacher = videoRef.current
    const camera = cameraStreamRef.current
    if (!canvas || !teacher || !camera || camera.getVideoTracks().every((track) => track.readyState !== 'live')) throw new Error('camera-unavailable')
    canvas.width = RECORDING_WIDTH
    canvas.height = RECORDING_HEIGHT
    drawRecordingFrame()
    cleanupRecordingAudio()
    setRecordingAudioNotice('')
    setRecordingHasTeacherAudio(false)
    const canvasStream = canvas.captureStream(RECORDING_FPS)
    let recordingAudioTracks: MediaStreamTrack[] = []
    try {
      const capturableTeacher = teacher as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }
      const captureTeacherStream = capturableTeacher.captureStream?.() ?? capturableTeacher.mozCaptureStream?.()
      const externalEl = externalAudioElRef.current as (HTMLAudioElement & { captureStream?: () => MediaStream }) | null
      const externalStream = externalAudioUrlRef.current && externalEl?.captureStream ? externalEl.captureStream() : null
      const sourceStream = (externalStream?.getAudioTracks().length ? externalStream : captureTeacherStream) ?? null
      if (!sourceStream?.getAudioTracks().length || typeof AudioContext === 'undefined') throw new Error('teacher-audio-unavailable')
      const audioContext = new AudioContext()
      teacherCaptureStreamRef.current = sourceStream
      recordingAudioContextRef.current = audioContext
      await audioContext.resume()
      if (audioContext.state !== 'running') throw new Error('teacher-audio-context-suspended')
      const audioSource = audioContext.createMediaStreamSource(sourceStream)
      const audioGain = audioContext.createGain()
      const audioDestination = audioContext.createMediaStreamDestination()
      // With external soundtrack the video GainNode is 0; record the replacement at the UI volume instead.
      audioGain.gain.value = externalAudioUrlRef.current
        ? (isMuted ? 0 : volume)
        : (playbackGainRef.current?.gain.value ?? ((window as unknown as { __adlTeacherGain?: number }).__adlTeacherGain ?? 1))
      audioSource.connect(audioGain)
      audioGain.connect(audioDestination)
      recordingAudioSourceRef.current = audioSource
      recordingAudioGainRef.current = audioGain
      recordingAudioDestinationRef.current = audioDestination
      recordingAudioTracks = audioDestination.stream.getAudioTracks()
      setRecordingHasTeacherAudio(true)
    } catch {
      cleanupRecordingAudio()
      setRecordingAudioNotice(text('当前浏览器无法录制老师视频声音，本次录像将仅包含画面。', 'This browser cannot capture the teacher video audio. This recording will be video-only.'))
    }
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...recordingAudioTracks])
    recordingStreamRef.current = stream
    const mimeType = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRecorderRef.current = recorder
    recordingChunksRef.current = []
    setRecordingMimeType(mimeType || recorder.mimeType || 'video/webm')
    recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data) }
    recorder.onerror = () => {
      setRecordingError(text('录制过程中发生错误，请重试。', 'Recording failed. Please try again.'))
      updateRecordingStatus('error')
      if (recorder.state !== 'inactive') recorder.stop()
      else {
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
        recordingStreamRef.current = null
        cleanupRecordingAudio()
      }
    }
    recorder.onstop = () => {
      resetToPracticeIdle()
      if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
      cleanupRecordingAudio()
      mediaRecorderRef.current = null
      const type = recorder.mimeType || mimeType || 'video/webm'
      const blob = new Blob(recordingChunksRef.current, { type })
      recordingChunksRef.current = []
      if (blob.size) {
        if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
        const url = URL.createObjectURL(blob)
        recordingUrlRef.current = url
        setRecordingUrl(url)
        setReviewOpen(true)
        setReviewSpeed(1)
        updateRecordingStatus('ready')
      } else {
        setRecordingError(text('没有生成可回看的录像，请重试。', 'No reviewable recording was created. Please try again.'))
        updateRecordingStatus('error')
      }
      if (pendingCameraStopRef.current) {
        pendingCameraStopRef.current = false
        releaseCamera()
      }
    }
    const render = () => {
      if (recorder.state === 'inactive') return
      drawRecordingFrame()
      recordingFrameRef.current = requestAnimationFrame(render)
    }
    recorder.start(1000)
    recordingStartedAtRef.current = performance.now()
    setRecordingElapsed(0)
    updateRecordingStatus('recording')
    render()
    recordingTimerRef.current = window.setInterval(() => setRecordingElapsed((performance.now() - recordingStartedAtRef.current) / 1000), 200)
    await teacher.play()
  }, [cleanupRecordingAudio, drawRecordingFrame, isMuted, language, releaseCamera, resetToPracticeIdle, updateRecordingStatus, volume])

  const startRecordingCountdown = useCallback(async () => {
    const video = videoRef.current
    const camera = cameraStreamRef.current
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      setRecordingError(text('当前浏览器不支持本地录像，请使用支持录像的浏览器。', 'Local recording is not supported by this browser. Try a supported browser.'))
      updateRecordingStatus('error')
      return
    }
    if (!videoUrl || !video || !compareMode || cameraStatus !== 'active' || !camera) {
      setRecordingError(text('请先载入视频并开启可用的摄像头对比。', 'Load a video and start camera comparison before recording.'))
      updateRecordingStatus('error')
      return
    }
    setRecordingError('')
    setMarkKind(null); setSettingsDrawerOpen(false)
    cancelPendingLoop()
    countdownRestoreRef.current = { time: video.currentTime, wasPlaying: !video.paused }
    video.pause()
    const session = ++recordingSessionRef.current
    updateRecordingStatus('countdown')
    for (let value = countdownSeconds; value > 0; value -= 1) {
      if (recordingSessionRef.current !== session) return
      setCountdownValue(value)
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }
    if (recordingSessionRef.current !== session) return
    setCountdownValue(null)
    video.currentTime = practiceRange.startTime
    setCurrentTime(practiceRange.startTime)
    if (Math.abs(video.currentTime - practiceRange.startTime) > 0.01 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => {
        const finish = () => { video.removeEventListener('seeked', finish); resolve() }
        video.addEventListener('seeked', finish, { once: true })
        window.setTimeout(finish, 1500)
      })
    }
    if (recordingSessionRef.current !== session) return
    try {
      await beginMediaRecording()
    } catch {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
      cleanupRecordingAudio()
      setRecordingError(text('无法开始本地录像。请检查浏览器支持和摄像头状态。', 'Could not start local recording. Check browser support and camera status.'))
      updateRecordingStatus('error')
    }
  }, [beginMediaRecording, cameraStatus, cancelPendingLoop, cleanupRecordingAudio, compareMode, countdownSeconds, language, practiceRange.startTime, updateRecordingStatus, videoUrl])

  const deleteRecording = () => {
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
    recordingUrlRef.current = null
    setRecordingUrl(null)
    setReviewOpen(false)
    setRecordingElapsed(0)
    setRecordingError('')
    resetToPracticeIdle()
    updateRecordingStatus('idle')
  }
  const startCamera = useCallback(async () => {
    const requestId = cameraRequestRef.current + 1
    cameraRequestRef.current = requestId
    setCompareMode(true)
    setCameraStatus('loading')
    setCameraMessage(text('正在启动摄像头…', 'Starting camera…'))
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('error')
      setCameraMessage(text('当前浏览器不支持摄像头访问。', 'This browser does not support camera access.'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      if (cameraRequestRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = stream
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
        if (recordingStatusRef.current === 'countdown') cancelCountdown()
        if (recordingStatusRef.current === 'recording') stopRecording()
        setCameraStatus('error')
        setCameraMessage(text('摄像头已停止。', 'Camera stopped.'))
      }, { once: true }))
      setCameraStatus('active')
      setCameraMessage('')
    } catch (cameraError) {
      if (cameraRequestRef.current !== requestId) return
      const name = cameraError instanceof DOMException ? cameraError.name : ''
      setCameraStatus('error')
      setCameraMessage(name === 'NotAllowedError' || name === 'SecurityError'
        ? text('摄像头访问被拒绝。请在浏览器设置中允许摄像头权限。', 'Camera access was denied. Allow camera permission in your browser settings.')
        : name === 'NotFoundError' || name === 'DevicesNotFoundError'
          ? text('未检测到可用摄像头。', 'No available camera was detected.')
          : text('无法启动摄像头，请检查设备是否被其他程序占用。', 'The camera could not start. Check whether another app is using it.'))
    }
  }, [cancelCountdown, language, stopRecording])
  const toggleCompareMode = useCallback(() => {
    if (compareMode) stopCamera()
    else void startCamera()
  }, [compareMode, startCamera, stopCamera])
  const visibleTeacherFraming = clampTeacherFraming(teacherFraming)

  if (showLanding) return <LandingPage onStart={() => setShowLanding(false)} language={language} setLanguage={setLanguage} />

  return (
    <main className={`app-shell${videoUrl ? ' has-video' : ''}`}>
      {!videoUrl && <header className="app-header">
        <button type="button" className="workspace-brand" onClick={() => { stopCamera(); setShowLanding(true) }} aria-label={text('返回帧琢首页', 'Return to the FrameTune home page')}><strong>帧琢</strong><span>FrameTune</span><small>{text('测试版', 'Beta')}</small></button>
        <div className="workspace-header-tools"><p className="workspace-tagline">{text('逐帧精练，雕琢姿态', 'Refine every move, frame by frame.')}</p><div className="workspace-language" aria-label="Language"><button type="button" className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>中文</button><span>/</span><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button></div></div>
      </header>}
      <section className="workspace">
        {!videoUrl ? (
          <><label className="upload-panel"><span className="upload-icon">＋</span><strong>{text('选择舞蹈视频', 'Choose a dance video')}</strong><span>{text('MP4、MOV 或 WebM · 文件保留在本机', 'MP4, MOV, or WebM · stays on this device')}</span><input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={handleFileChange} /></label>
          <details className="saved-details"><summary>{text('已保存的舞', 'Saved dances')}</summary><SavedDances language={language} onPick={record => openVideoPicker(record)} /></details></>
        ) : <>
          <input ref={fileInputRef} type="file" className="hidden-file-input" tabIndex={-1} aria-label={text('选择新的舞蹈视频', 'Choose another dance video')} accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={handleFileChange} />
          <div ref={playerRef} className={`player-frame practice-player ${orientation}${compareMode ? ' comparing' : ''}${isFullscreen ? ' is-immersive' : ''}`}>
            <div className="practice-topbar">
              <button type="button" className="workspace-brand topbar-brand" onClick={() => { stopCamera(); setShowLanding(true) }} aria-label={text('返回帧琢首页', 'Return to the FrameTune home page')}><span className="topbar-back" aria-hidden="true">‹</span><strong>帧琢</strong></button>
              <div className="topbar-tools" role="toolbar" aria-label={text('练习准备', 'Practice preparation')}>
                <button type="button" aria-pressed={coach.prefs.enabled || coach.prefs.overlay} className={`topbar-toggle topbar-count${coach.prefs.enabled || coach.prefs.overlay ? ' active' : ''}`} title={text('老师数拍子：打开后自动识别 BPM、对齐动作和第 1 拍，原声静音', 'Teacher counts: BPM, motion and beat 1 are found automatically; original sound is muted')} onClick={coach.toggleQuick}>{text('数拍', 'Count')}</button>
                <button type="button" className={`topbar-toggle${isMirrored ? ' active' : ''}`} aria-pressed={isMirrored} onClick={toggleMirror}>{text('镜像', 'Mirror')}</button>
                <button type="button" aria-label={compareMode ? text('关闭摄像头', 'Turn camera off') : text('摄像头对比', 'Compare with camera')} aria-pressed={compareMode} title={text('同时显示本机摄像头，不录制或上传', 'Show your local camera without recording or uploading')} className={`topbar-toggle${compareMode ? ' active' : ''}`} onClick={toggleCompareMode}>{text('摄像头', 'Camera')}</button>
                {compareMode && cameraStatus === 'active' && recordingStatus !== 'recording' && recordingStatus !== 'processing' && <button type="button" className="record-button" disabled={recordingStatus === 'countdown'} onClick={() => void startRecordingCountdown()}>{recordingStatus === 'countdown' ? text('倒计时中', 'Counting down') : text('开始录制', 'Record')}</button>}
                {recordingStatus === 'recording' && <button type="button" className="stop-record-button" onClick={stopRecording}>{text('停止录制', 'Stop')}</button>}
                {recordingUrl && !reviewOpen && <button type="button" className="topbar-review" aria-label={text('查看录像', 'Review recording')} onClick={() => setReviewOpen(true)}>{text('回看', 'Review')}</button>}
              </div>
              <div className="menu-cluster">
                <button type="button" className="menu-more" aria-expanded={sideRailOpen} aria-label={text('更多', 'More')} title={text('数拍设置、曲速、外挂音频、视频与语言…', 'Count settings, tempo, external audio, video and language…')} onClick={() => { setSideRailOpen(value => !value); if (settingsDrawerOpen && menuPage !== 'practice') setSettingsDrawerOpen(false) }}>⋯</button>
                {sideRailOpen && <nav className="side-rail" aria-label={text('更多选项', 'More options')}>
                  <div className="rail-group" role="group" aria-label={text('数拍', 'Counts')}><span className="rail-label" aria-hidden="true">{text('数拍', 'COUNTS')}</span>
                    <button type="button" className="rail-item" onClick={() => { setSideRailOpen(false); setMenuPage('practice'); setSettingsDrawerOpen(true); cancelPendingLoop(); videoRef.current?.pause(); setMarkKind(null) }}>{text('数拍与分段', 'Count & sections')}</button>
                    <button type="button" className="rail-item" onClick={() => { setSideRailOpen(false); setSettingsDrawerOpen(false); setDockExpanded(true); setBpmEditorOpen(true) }}>{text('曲速校准', 'Song tempo (BPM)')}</button>
                  </div>
                  <div className="rail-group" role="group" aria-label={text('声音', 'Sound')}><span className="rail-label" aria-hidden="true">{text('声音', 'SOUND')}</span>
                    <button type="button" className="rail-item" onClick={() => { setSideRailOpen(false); setMenuPage('audio'); setSettingsDrawerOpen(true) }}>{text('外挂音频', 'External audio')}</button>
                  </div>
                  <div className="rail-group" role="group" aria-label={text('视频', 'Video')}><span className="rail-label" aria-hidden="true">{text('视频', 'VIDEO')}</span>
                    <button type="button" className="rail-item change-video-button" disabled={recordingStatus === 'recording' || recordingStatus === 'countdown' || recordingStatus === 'processing'} onClick={() => { setSideRailOpen(false); openVideoPicker() }}>{text('换视频', 'Change video')}</button>
                    <button type="button" className="rail-item" onClick={() => { setSideRailOpen(false); setMenuPage('saved'); setSettingsDrawerOpen(true) }}>{text('已保存的舞', 'Saved dances')}</button>
                    <button type="button" className="rail-item" aria-label={isFullscreen ? text('退出全屏', 'Exit fullscreen') : text('进入全屏', 'Enter fullscreen')} onClick={() => { setSideRailOpen(false); void toggleFullscreen() }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" /></svg><span aria-hidden="true">{isFullscreen ? text('退出全屏', 'Exit fullscreen') : text('全屏', 'Fullscreen')}</span></button>
                    <button type="button" className="rail-item" onClick={() => { setSideRailOpen(false); setMenuPage('recording'); setSettingsDrawerOpen(true) }}>{text('录像设置', 'Recording settings')}</button>
                  </div>
                  <div className="rail-group" role="group" aria-label={text('其他', 'Other')}><span className="rail-label" aria-hidden="true">{text('其他', 'OTHER')}</span>
                    <div className="rail-row"><span>{text('语言', 'Language')}</span><div className="seg-pill rail-language" role="group" aria-label="Language"><button type="button" className={language === 'zh' ? 'active' : ''} aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button><button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button></div></div>
                    <button type="button" className="rail-item" onClick={() => { setSideRailOpen(false); setMenuPage('help'); setSettingsDrawerOpen(true) }}>{text('使用说明', 'Help')}</button>
                  </div>
                </nav>}
              </div>
            </div>
            <div className={`video-stage${compareMode ? ' compare-mode' : ''}`}>
              <div ref={videoStageRef} className={`teacher-video-panel${canPanTeacher ? ' draggable-stage' : ''}`}
                onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onLostPointerCapture={event => { gestureRef.current.end(event.pointerId, true) }}>
                <video key={videoUrl} ref={videoRef} className={`${orientation}${canPanTeacher ? ' draggable-video' : ''}`}
                  style={{
                    objectFit: renderDisplayMode,
                    objectPosition: '50% 50%',
                    transform: `translate3d(${visibleTeacherFraming.panX}px, ${visibleTeacherFraming.panY}px, 0) scale(${visibleTeacherFraming.zoom}) scaleX(${isMirrored ? -1 : 1})`,
                  }} src={videoUrl} preload="metadata" playsInline draggable={false}
                  onLoadedMetadata={handleLoadedMetadata} onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} onError={() => setError(text('视频加载失败。此文件可能损坏，或编码不受当前浏览器支持。', 'The video could not be loaded. It may be damaged or use a codec that this browser does not support.'))}
                />
                {compareMode && <span className="panel-label">{text('教师视频', 'Teacher video')}</span>}
              </div>
              {compareMode && <div className="camera-panel">
                {cameraStatus === 'active' && <video ref={cameraVideoRef} className="camera-video" style={{ objectFit: 'contain', objectPosition: '50% 50%', transform: mirrorSelfView ? 'scaleX(-1)' : 'scaleX(1)' }} autoPlay muted playsInline />}
                {cameraStatus !== 'active' && <div className={`camera-state ${cameraStatus}`} role={cameraStatus === 'error' ? 'alert' : 'status'}><span className="camera-state-icon" aria-hidden="true">◉</span><strong>{cameraStatus === 'loading' ? text('正在启动摄像头…', 'Starting camera…') : cameraStatus === 'error' ? text('摄像头不可用', 'Camera unavailable') : text('摄像头已停止', 'Camera stopped')}</strong>{cameraMessage && <p>{cameraMessage}</p>}</div>}
                <span className="panel-label">{text('我的画面', 'My camera')}</span>
                {cameraStatus === 'active' && <button type="button" title={text('只改变自己的预览方向', 'Changes only your self-view')} className={`self-mirror-button ${mirrorSelfView ? 'active' : ''}`} onClick={() => setMirrorSelfView((value) => !value)}>{text('镜像自己', 'Mirror self-view')}</button>}
              </div>}
              <BeatOverlay videoRef={videoRef} grid={coach.grid} active={coach.prefs.overlay && !!coach.grid} delayMs={coach.prefs.delayMs} />
              <div className="stage-status-stack">
              {(coach.prefs.enabled || coach.prefs.overlay) && (coach.pose.status === 'loading' || coach.pose.status === 'running' || coach.pose.status === 'ready' || coach.pose.status === 'failed') && (
                <p className={`stage-chip pose-stage-status${coach.pose.status === 'failed' ? ' is-failed' : coach.pose.status === 'ready' ? ' is-ready' : ''}`} role={coach.pose.status === 'failed' ? 'alert' : 'status'} data-testid="pose-stage-status">
                  {coach.pose.status === 'ready' ? text('分析完成', 'Analysis done') : coach.pose.status === 'failed' ? text('分析失败', 'Analysis failed') : text('分析中', 'Analyzing')}
                </p>
              )}
{(coach.prefs.enabled || coach.prefs.overlay) && (tempoStatus === 'unavailable' || tempoStatus === 'analyzing' || coach.pose.status === 'running' || coach.pose.status === 'loading') && <p className="count-auto-status stage-chip" role={tempoStatus === 'unavailable' ? 'alert' : 'status'}>{tempoStatus === 'unavailable' ? text(`没能自动识别 BPM（${tempoFailure === 'large-file' ? '视频过大' : tempoFailure === 'unsupported-audio' ? '无法解码音频' : tempoFailure === 'analysis-timeout' ? '分析超时' : tempoFailure === 'silent-audio' ? '几乎无声' : tempoFailure === 'too-short' ? '音频太短' : tempoFailure === 'unstable' ? '节拍不稳定' : '分析未完成'}）：点底栏手动输入。`, `BPM not detected (${tempoFailure || 'unknown'}): tap BPM below to type it.`) : tempoStatus === 'analyzing' ? analyzingPhaseLabel(tempoPhase, language) : text('正在分析老师动作…', 'Analyzing the teacher’s motion…')}</p>}</div>
              {recordingStatus === 'countdown' && countdownValue !== null && <div className="recording-countdown" role="status" aria-live="assertive"><strong>{countdownValue}</strong><span>{text('准备开始', 'Get ready')}</span><button type="button" onClick={cancelCountdown}>{text('取消', 'Cancel')}</button></div>}
              {recordingStatus === 'recording' && <div className="recording-live-status" role="status"><span aria-hidden="true" />{text('录制中', 'Recording')} {formatTime(recordingElapsed)}</div>}
              {settingsDrawerOpen && <section ref={settingsDrawerRef} className={`compact-menu menu-sheet menu-sheet-${menuPage}`} aria-label={text('练习菜单', 'Practice menu')}>
                <div className="compact-menu-header" onPointerDown={startSheetDrag} onPointerMove={moveSheetDrag} onPointerUp={endSheetDrag} onPointerCancel={endSheetDrag}><span className="sheet-grabber" aria-hidden="true" /><strong>{menuPage === 'practice' ? text('数拍与分段', 'Count & sections') : menuPage === 'audio' ? text('外挂音频', 'External audio') : menuPage === 'saved' ? text('已保存的舞', 'Saved dances') : menuPage === 'recording' ? text('录像设置', 'Recording settings') : text('使用说明', 'Help')}</strong><button type="button" className="sheet-close" onClick={() => setSettingsDrawerOpen(false)}>{text('关闭', 'Close')}</button></div>
                {menuPage === 'practice' && <CountSettingsPanel language={language} prefs={coach.prefs} settings={coach.settings} grid={coach.grid} anchorInfo={coach.anchorInfo} countInfo={coach.countInfo} pose={coach.pose} voiceState={coach.voiceState} time={currentTime}
                  tempoReady={tempoStatus === 'auto' || tempoStatus === 'manual'} hasMusicStart={firstBeatConfirmed && firstBeatTime !== null} hasDanceStart={formalStartTime !== null} musicStartTime={firstBeatTime} danceStartTime={formalStartTime} hasAudioOnsets={audioOnsets.length > 0}
                  setPrefs={coach.setPrefs} updateSettings={coach.updateSettings} onToggleCount={coach.toggleQuick} onMarkMusicStart={() => beginMark('music')} onMarkDanceStart={() => beginMark('dance')} onSetHere={() => coach.updateSettings({ anchorMode: 'manual', manualAnchor: videoRef.current?.currentTime ?? currentTime })}
                  onNudge={coach.adjustAnd} onMove={coach.moveAndTo} onResetAdjust={coach.resetAdjust} onCancelPose={coach.cancelPose} onRetryPose={coach.retryPose} onRequestPose={coach.requestPose}
                  exporting={exportingCount} onExport={() => { setExportingCount(true); void coach.exportWav().then(blob => { if (!blob) return; const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${fileName.replace(/\.[^.]+$/, '')}-count.wav`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 4000) }).finally(() => setExportingCount(false)) }}
                  segmentMode={segmentMode} onSegmentMode={switchSegmentMode} sectionCount={learningSegments.length}
                  segmentsEditor={segmentMode === 'custom' ? <CustomCutsEditor language={language} cuts={customCuts} duration={duration} currentTime={currentTime} liveRange={(() => { const segs = customSegments; if (!segs.length) return null; const idx = Math.min(Math.max(0, segmentIndexAt(segs, currentTime)), segs.length - 1); const s = segs[idx]; return { index: idx + 1, start: s.startTime, end: s.endTime } })()} onAdd={addCustomCut} onMove={moveCustomCut} onRemove={index => setCustomCuts(removeCut(customCuts, index))} onSeek={pauseAndSeek} />
                    : learningSegments.length > 0 ? <><p role="status" className="cut-live-range">{(() => { const idx = Math.min(Math.max(0, safeSegmentIndex), learningSegments.length - 1); const s = learningSegments[idx]; return text(`第 ${idx + 1} 段 ${s.startTime.toFixed(2)}–${s.endTime.toFixed(2)}s`, `Section ${idx + 1} ${s.startTime.toFixed(2)}–${s.endTime.toFixed(2)}s`) })()}</p>{(tempoStatus !== 'auto' && tempoStatus !== 'manual') && <p role="status" className="segment-temp-note">{text(`临时按曲速 ${segmentBpm} 分段；确认 BPM 后会按真实曲速重算。`, `Temporary sections at song tempo ${segmentBpm}; they rebuild when BPM is confirmed.`)}</p>}<div className="inline-controls"><button type="button" onClick={() => setBoundaryOffsets(current => { const next = [...current]; next[selectedBoundaryIndex] = 0; return next })}>{text('恢复自动分界', 'Restore auto boundary')}</button></div><p>{text('进度条保持干净（段号在下方按钮）；打开本页时拖进度条到新位置松手可改最近分界（即时生效）。', 'The progress bar stays clean (section numbers are below); with this page open, scrub and release to move the nearest boundary — applies immediately.')}</p></>
                      : <p>{text('先标记音乐与动作起点，生成至少两段。', 'Mark both starts to create at least two sections.')}</p>}
                />}
                {menuPage === 'audio' && <ExternalAudioPanel language={language} fileName={externalAudioName} offsetSeconds={audioOffset} alignStatus={alignStatus} alignScore={alignScore} inputRef={audioInputRef} accept={EXTERNAL_AUDIO_ACCEPT} onPick={handleExternalAudioChange} onClear={clearExternalAudio} onOffset={value => { const next = Math.min(30, Math.max(-30, Math.round(value * 100) / 100)); setAudioOffset(next); audioOffsetRef.current = next; syncExternalAudio(true) }} onRealign={() => { void runExternalAlign() }} />}
                {menuPage === 'saved' && <div className="compact-menu-body"><SavedDances language={language} onPick={record => openVideoPicker(record)} /></div>}
                {menuPage === 'recording' && <div className="compact-menu-body"><label>{text('倒计时', 'Countdown')} <select aria-label={text('录制倒计时', 'Recording countdown')} value={countdownSeconds} disabled={recordingStatus === 'countdown' || recordingStatus === 'recording'} onChange={event => setCountdownSeconds(Number(event.target.value) as 3 | 5 | 10)}>{[3,5,10].map(value => <option key={value} value={value}>{value}s</option>)}</select></label><p>{text('只录老师声音，不录麦克风；录像不上传。', 'Teacher audio only. No microphone, no uploads.')}</p>{recordingAudioNotice && <p role="status">{recordingAudioNotice}</p>}{recordingError && <p role="alert">{recordingError}</p>}</div>}
                {menuPage === 'help' && <div className="compact-menu-body"><p>{text('底栏点「音乐」→ 进度条高亮 → 在 bar 上点一下确认音乐起点；再点「动作」→ 拖到动作开始处确认。数拍第 1 拍优先用手标。', 'Dock: tap Music → bar highlights → tap to confirm; then Dance → drag and confirm. Beat 1 prefers your markers.')}</p><p>{text('底栏「自定义」拖到第一小节终点确认即可按长度均分。复杂项（数拍方式/音色/and/原声）在 ⋯ → 数拍与分段；数拍疏密（×2/÷2）在点开 BPM 数字后的曲速校准里。BPM 失败时列出最佳候选供一键采用。', 'Dock Custom tiles the first-section length. Count style / voice / and / original sound live under ⋯ → Count & sections; count density (×2/÷2) is in the tempo editor behind the BPM number. On BPM failure, best candidates appear for one-tap adopt.')}</p><p>{text('⋯ 里分组：数拍（数拍与分段、曲速校准）、声音（外挂音频）、视频（换视频、已保存的舞、全屏、录像设置）、其他（语言、使用说明）。镜像与缩放手势仍可用。', '⋯ groups: Counts (count & sections, song tempo), Sound (external audio), Video (change video, saved dances, fullscreen, recording), Other (language, help). Mirror and pinch-zoom still work.')}</p><p title={fileName}>{fileName} · {formatFileSize(fileSize)}</p></div>}
              </section>}
            </div>
            <canvas ref={recordingCanvasRef} className="recording-canvas" aria-hidden="true" />
            <PracticeDock language={language} expanded={dockExpanded} onExpanded={setDockExpanded} speed={speed} speeds={SPEEDS} onSpeed={changeSpeed}
              sections={learningSegments} selected={safeSegmentIndex} rangeMode={rangeMode} onRange={selectPracticeRange} onSection={changeSegment} playing={isPlaying} waiting={isLoopWaiting} onPlay={() => void togglePlayback()}
              loop={playbackMode === 'loop'} onLoop={value => changePlaybackMode(value ? 'loop' : 'continuous')}
              hint={dockHint} onDismissHint={() => { setDockHint(false); safeStorage.setItem('adl-dock-hint', 'dismissed') }}
              timeline={<>
                {markKind && <div className="marker-setup" role="status"><span>{markKind === 'music' ? text('在进度条上点一下 = 确认音乐起点', 'Tap the bar once to confirm music start') : markKind === 'dance' ? text('拖到动作开始处，松手或点确认 = 动作起点', 'Drag to the first move, then release or tap Confirm') : text('拖到第一小节终点，松手或点确认 = 按该长度均分', 'Drag to end of first section, then release or tap Confirm')}</span><button type="button" className="confirm-button" onClick={confirmMarkAtPlayhead}>{text('确认', 'Confirm')}</button><button type="button" onClick={() => setMarkKind(null)}>{text('取消', 'Cancel')}</button></div>}
                <div className="start-markers">
                  <button type="button" className={`mark-chip${markKind === 'music' ? ' active' : ''}${firstBeatConfirmed ? ' set' : ''}`} aria-pressed={markKind === 'music'} title={text('点「音乐」→ 在进度条上点一下确认', 'Tap Music, then tap the bar to confirm')} onClick={() => beginMark('music')}><span className="step-num" aria-hidden="true">1</span>{text('音乐', 'Music')} {firstBeatConfirmed && firstBeatTime !== null ? firstBeatTime.toFixed(2) + 's' : '—'}</button>
                  <span className={`step-line${firstBeatConfirmed ? ' is-lit' : ''}`} aria-hidden="true" />
                  <button type="button" className={`mark-chip${markKind === 'dance' ? ' active' : ''}${formalStartTime !== null ? ' set' : ''}`} aria-pressed={markKind === 'dance'} title={text('点「动作」→ 拖进度条再确认', 'Tap Dance, drag the bar, then confirm')} onClick={() => beginMark('dance')}><span className="step-num" aria-hidden="true">2</span>{text('动作', 'Dance')} {formalStartTime === null ? '—' : formalStartTime.toFixed(2) + 's'}</button>
                  <button type="button" className={`mark-chip mark-chip-small${markKind === 'customFirst' ? ' active' : ''}`} aria-pressed={markKind === 'customFirst'} title={text('自定义：拖出第一小节长度，整段均分', 'Custom: mark first-section length, then tile')} onClick={() => beginMark('customFirst')}>{text('自定义', 'Custom')}</button>
                  <BpmChip language={language} status={tempoStatus} bpm={bpm} source={tempoSource} open={bpmEditorOpen} failure={tempoFailure} phase={tempoPhase} onToggle={() => setBpmEditorOpen(value => !value)} />
                </div>
                {bpmEditorOpen && <BpmEditor language={language} bpm={tempoStatus === 'unavailable' || tempoStatus === 'analyzing' ? null : bpm} alternatives={tempoAlternatives} countInfo={coach.countInfo} onLevelShift={coach.shiftLevel} failure={tempoFailure} analyzing={tempoStatus === 'analyzing'} phase={tempoPhase} onRetry={() => { if (fileRef.current) runTempoAnalysis(fileRef.current, bpm, { force: true }) }} onCommit={value => { applyBpm(value); setBpmEditorOpen(false) }} onClose={() => setBpmEditorOpen(false)} />}
                <div className="timeline-row"><span>{markKind || (settingsDrawerOpen && menuPage === 'practice') ? currentTime.toFixed(2) : formatTime(currentTime)}</span><div className={`timeline-track${markKind || (settingsDrawerOpen && menuPage === 'practice' && segmentMode === 'custom') ? ' timeline-highlight' : ''}`}><input ref={timelineRef} aria-label={text('视频进度', 'Video timeline')} type="range" min="0" max={duration || 0} step="0.01" value={Math.min(currentTime, duration || 0)} onChange={event => pauseAndSeek(Number(event.target.value))} onPointerUp={() => { if (markKind) { confirmMarkAtPlayhead(); return } if (settingsDrawerOpen && menuPage === 'practice' && segmentMode === 'beats' && learningSegments.length > 1) applyBoundaryAtPlayhead(); else resumeAfterScrub() }} onTouchEnd={() => { if (markKind) { confirmMarkAtPlayhead(); return } if (settingsDrawerOpen && menuPage === 'practice' && segmentMode === 'beats' && learningSegments.length > 1) applyBoundaryAtPlayhead(); else resumeAfterScrub() }} /></div><span>{formatTime(duration)}</span></div>
                {error && <p className="dock-error" role="alert">{error}</p>}
                {recordingError && <p className="dock-error" role="alert">{recordingError}</p>}
                {recordingAudioNotice && <p className="dock-notice" role="status">{recordingAudioNotice}</p>}
                {recordingStatus === 'processing' && <p className="dock-notice" role="status">{text('正在生成录像…', 'Preparing recording…')}</p>}
              </>}
            />
          </div>

          {recordingUrl && reviewOpen && <div className="recording-review-backdrop" role="presentation">
            <section className="recording-review" role="dialog" aria-modal="true" aria-labelledby="recording-review-title">
              <header><div><p className="panel-kicker">LOCAL REVIEW</p><h2 id="recording-review-title">{text('练习录像回看', 'Practice recording review')}</h2></div><button type="button" className="review-close" aria-label={text('关闭回放', 'Close Review')} onClick={closeReviewToPractice}>×</button></header>
              <video src={recordingUrl} controls loop playsInline onLoadedMetadata={(event) => { event.currentTarget.playbackRate = reviewSpeed }} />
              <div className="review-speed" aria-label={text('回看速度', 'Review speed')}>{([0.5, 0.75, 1] as const).map((value) => <button type="button" key={value} className={reviewSpeed === value ? 'active' : ''} onClick={(event) => { setReviewSpeed(value); const reviewVideo = event.currentTarget.closest('.recording-review')?.querySelector('video'); if (reviewVideo) reviewVideo.playbackRate = value }}>{value}×</button>)}</div>
              <div className="review-actions"><button type="button" className="back-to-practice" onClick={closeReviewToPractice}>{text('返回练习', 'Back to Practice')}</button><a className="button-link" href={recordingUrl} download={`frametune-practice-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`}>{text('下载 WebM', 'Download WebM')}</a><button type="button" onClick={deleteRecording}>{text('删除录像', 'Delete recording')}</button><button type="button" disabled={cameraStatus !== 'active'} onClick={() => { closeReviewToPractice(); setRecordingError(''); void startRecordingCountdown() }}>{text('再录一次', 'Record another')}</button></div>
              <p>{text(`本地生成 · ${recordingHasTeacherAudio ? '包含老师视频声音' : '仅画面'} · ${recordingMimeType || 'video/webm'}`, `Created locally · ${recordingHasTeacherAudio ? 'teacher video audio included' : 'video only'} · ${recordingMimeType || 'video/webm'}`)}</p>
              {recordingAudioNotice && <p className="recording-audio-notice" role="status">{recordingAudioNotice}</p>}
            </section>
          </div>}
        </>}
        {!videoUrl && error && <p className="error-message" role="alert">{error}</p>}
      </section>
      {(pickHint || notice) && <div className="pick-toast" role="status">
        <span>{pickHint ? text(`请选择视频文件「${pickHint.name}」，文件一致会自动恢复对齐。`, `Choose the video file "${pickHint.name}"; if it matches, alignment is restored automatically.`) : notice}</span>
        <button type="button" aria-label={text('关闭提示', 'Dismiss')} onClick={() => { setPickHint(null); setNotice('') }}>×</button>
      </div>}
    </main>
  )
}

export default App
