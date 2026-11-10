import { resolveAnchor, type AnchorResult } from './anchor.ts'
import type { CountInfo } from './countInfo.ts'
import type { CountSettings } from './countSettings.ts'
import type { BeatGrid } from './grid.ts'
import { chooseNumberLevel, lockFirstBeat, quantizeSubBeats, subStats } from './motionTempo.ts'
import type { MotionAnalysis } from './motionTempo.ts'
import type { TimedEvent } from './onset.ts'

export const NUMBER_BPM = { min: 30, max: 240 }

export interface CountPlanInput {
  /** Music tempo (tag or audio detection). */
  bpm: number
  settings: Pick<CountSettings, 'follow' | 'levelShift' | 'anchorMode' | 'manualAnchor' | 'alignBasis' | 'adjust' | 'adjustBpm'>
  /** null until the pose analysis finished (or when it is not wanted). */
  motion: MotionAnalysis | null
  poseAccents: TimedEvent[]
  audioOnsets: TimedEvent[]
  musicStart: number | null
  /** The user's formal dance-start marker. */
  danceStart: number | null
  duration: number
  /** Other tempos the audio detector listed (×2 / ÷2 / tempogram candidates). */
  audioCandidates?: number[]
}

export interface CountPlan { numberBpm: number; anchorInfo: AnchorResult; grid: BeatGrid; info: CountInfo }

/** Everything the count needs, in one pure step:
 *  1. level — the music tempo (×2/÷2/×3…) whose interval matches the teacher's motion period, then the user's ×2/÷2 steps;
 *  2. first beat — manual / marker choices win; in auto the teacher's detected movement start, phase-refined by accents and onsets;
 *  3. extra hits per beat — the teacher's accent peaks inside each beat, snapped to ¼ ⅓ ½ ⅔ ¾ (none when "fixed 1&2&"). */
export function planCount(input: CountPlanInput): CountPlan {
  const { bpm, settings, audioOnsets, duration } = input
  const motion = settings.follow ? input.motion : null
  const level = motion
    ? (() => { const choice = chooseNumberLevel(bpm, motion, input.poseAccents, 1.6, input.audioCandidates ?? []); return { bpm: choice.bpm, ratio: choice.ratio, reliable: choice.reliable, margin: choice.margin } })()
    : { bpm, ratio: 1, reliable: false, margin: 0 }
  const shifted = level.bpm * 2 ** settings.levelShift
  const numberBpm = shifted >= NUMBER_BPM.min && shifted <= NUMBER_BPM.max ? Math.round(shifted * 100) / 100 : level.bpm
  const interval = 60 / numberBpm
  const span = duration || motion?.duration || 0

  // User-marked music/dance starts win: never lock onto detectDanceStart (~60s) when a marker exists.
  const hasUserMarker = input.danceStart !== null || input.musicStart !== null
  const useMotionStart = motion && settings.anchorMode === 'auto' && !hasUserMarker && motion.danceStart !== null
  const motionBeat = useMotionStart
    ? lockFirstBeat(motion.danceStart!, interval, input.poseAccents, settings.alignBasis === 'pose' ? [] : audioOnsets, span)
    : null
  // Prefer explicit markers even when settings still say "auto".
  const anchorMode = settings.anchorMode === 'auto' && hasUserMarker
    ? (input.danceStart !== null ? 'dance' : 'music')
    : settings.anchorMode
  const anchorInfo: AnchorResult = motionBeat
    ? { anchor: motionBeat.anchor, source: 'motion-start', evidence: motionBeat.shiftMs !== 0 ? (settings.alignBasis === 'pose' ? 'pose' : 'pose+audio') : 'none', shiftMs: motionBeat.shiftMs, concentration: { pose: null, audio: null } }
    : resolveAnchor({
      bpm: numberBpm, mode: anchorMode, manualAnchor: settings.manualAnchor, musicStart: input.musicStart, danceStart: input.danceStart,
      poseAccents: input.poseAccents, audioOnsets, basis: settings.alignBasis,
    })
  // follow=false → null → FIXED_SUBS (explicit fixed 1&2&).
  // follow + pose ready → motion accents (0–3 extras → & / e a / e & a).
  // follow + pose not ready → {} empty pattern (numbers only): prefer fewer wrong ands over fixed half-beat ands.
  const subs = !settings.follow ? null
    : !motion ? {}
    : quantizeSubBeats(input.poseAccents, anchorInfo.anchor, interval, anchorInfo.anchor, span)
  const adjust = settings.adjustBpm !== null && Math.abs(settings.adjustBpm - numberBpm) < 0.05 ? settings.adjust : {}
  const grid: BeatGrid = { bpm: numberBpm, anchor: anchorInfo.anchor, subs, adjust }
  const stats = subs ? subStats(subs, anchorInfo.anchor, interval, anchorInfo.anchor, span) : null
  const info: CountInfo = {
    basis: motion ? 'motion' : 'music', follow: settings.follow, musicBpm: bpm, numberBpm, ratio: level.ratio, levelShift: settings.levelShift,
    reliable: level.reliable, margin: level.margin, danceStart: motion?.danceStart ?? null, firstBeat: motionBeat,
    subCounts: stats ? stats.withSubs as [number, number, number, number] : null,
  }
  return { numberBpm, anchorInfo, grid, info }
}
