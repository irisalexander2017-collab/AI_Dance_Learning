import { alignPhase, foldStats, pickDownbeat, type PhaseSource } from './phase.ts'
import type { TimedEvent } from './onset.ts'

export type AnchorMode = 'auto' | 'music' | 'dance' | 'manual'
export type AlignBasis = 'both' | 'pose' | 'audio'
export interface AnchorInput {
  bpm: number
  mode: AnchorMode
  manualAnchor: number | null
  musicStart: number | null
  danceStart: number | null
  poseAccents: TimedEvent[]
  audioOnsets: TimedEvent[]
  basis: AlignBasis
}
export interface AnchorResult {
  anchor: number
  /** Where the number came from. `exact` anchors are never moved by evidence. */
  source: 'manual' | 'music-start' | 'dance-start' | 'auto' | 'motion-start'
  /** Which evidence refined it; 'none' when only the user's marker (or nothing) was available. */
  evidence: 'pose' | 'audio' | 'pose+audio' | 'none'
  shiftMs: number
  concentration: { pose: number | null; audio: number | null }
}

const mod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor
/** Concentration above what n random events give (≈ 1/√n); sources at chance level get zero weight. */
export const evidenceStrength = (events: TimedEvent[], period: number) => {
  if (events.length < 6) return { r: 0, weight: 0 }
  const r = foldStats(events, period).concentration
  return { r, weight: Math.max(0, r - 1.5 / Math.sqrt(events.length)) }
}

export function resolveAnchor(input: AnchorInput): AnchorResult {
  const period = 60 / input.bpm
  const useful = (events: TimedEvent[], allowed: boolean): { source: PhaseSource | null; r: number | null } => {
    if (!allowed) return { source: null, r: null }
    const { r, weight } = evidenceStrength(events, period)
    return { source: weight > 0 ? { events, weight } : null, r: events.length >= 6 ? r : null }
  }
  const pose = useful(input.poseAccents, input.basis !== 'audio')
  const audio = useful(input.audioOnsets, input.basis !== 'pose')
  const sources = [pose.source, audio.source].filter((source): source is PhaseSource => source !== null)
  const concentration = { pose: pose.r, audio: audio.r }
  const evidence: AnchorResult['evidence'] = pose.source && audio.source ? 'pose+audio' : pose.source ? 'pose' : audio.source ? 'audio' : 'none'
  if (input.mode === 'manual' && input.manualAnchor !== null) return { anchor: input.manualAnchor, source: 'manual', evidence: 'none', shiftMs: 0, concentration }

  const reference = input.mode === 'dance' ? input.danceStart ?? input.musicStart : input.mode === 'music' ? input.musicStart ?? input.danceStart : null
  const referenceSource: AnchorResult['source'] = input.mode === 'dance' && input.danceStart !== null ? 'dance-start' : 'music-start'
  if (reference !== null) {
    // The user's own marker leads: evidence may only nudge it by up to a quarter beat (max 100 ms).
    const half = Math.min(period / 4, 0.1)
    // Evidence whose best phase is farther than the allowed nudge is not trusted to move the marker at all.
    const global = sources.length ? alignPhase(period, sources) : null
    const farAway = global ? Math.abs(mod(global.phase - reference + period / 2, period) - period / 2) > half + 0.004 : false
    const refined = sources.length && !farAway ? alignPhase(period, sources, { around: mod(reference, period), halfWidth: half }) : null
    if (!refined) return { anchor: reference, source: referenceSource, evidence: 'none', shiftMs: 0, concentration }
    let shift = mod(refined.phase - reference + period / 2, period) - period / 2
    if (Math.abs(shift) > half + 1e-6) shift = 0
    return { anchor: reference + shift, source: referenceSource, evidence, shiftMs: Math.round(shift * 1000), concentration }
  }

  const aligned = sources.length ? alignPhase(period, sources) : null
  const base = input.danceStart ?? input.musicStart ?? 0
  if (!aligned) return { anchor: Math.max(0, base), source: 'auto', evidence: 'none', shiftMs: 0, concentration }
  const down = pickDownbeat(period, aligned.phase, sources)
  const classStart = aligned.phase + down.beatOffset * period
  // The "1" nearest the dance start, stepping in whole 8-beat bars.
  const bar = period * 8
  const anchor = classStart + Math.round((base - classStart) / bar) * bar
  return { anchor: Math.max(0, anchor < 0 ? anchor + bar : anchor), source: 'auto', evidence, shiftMs: 0, concentration }
}
