import { estimateTempo, estimateWindow, meanPower, windowStarts, type TempoEstimate } from '../practice/tempoAnalysis.ts'
import { chooseTempo, reconcileTempo } from './tempoCandidates.ts'
import { onsetEvents, type TimedEvent } from './onset.ts'
import { refineTempo } from './phase.ts'
import { inTempoRange, roundBpm } from './tempoCandidates.ts'

export interface AudioAnalysis {
  /** Final tempo after the speed prior; null when the rhythm is unclear. */
  tempo: { bpm: number; alternatives: number[]; confidence: number } | null
  legacy: TempoEstimate | null
  onsets: TimedEvent[]
  /** Best peak BPMs even when tempo is null — for one-tap adopt on failure. */
  suggestions: number[]
}

/** `windows` is the concatenation of the sampled 24 s windows (as the legacy estimator expects),
 *  `full` is the continuous start of the track used for onset times. */
export function analyzeAudioSamples(windows: Float32Array, full: Float32Array, sampleRate: number): AudioAnalysis {
  const legacy = estimateTempo(windows, sampleRate)
  const size = Math.round(sampleRate * 24)
  const perWindow = windowStarts(windows.length, sampleRate).map(start => {
    const data = windows.subarray(start, start + size)
    const power = meanPower(data)
    return !Number.isFinite(power) || power < 1e-8 ? null : estimateWindow(data, sampleRate, power, true)
  }).filter((value): value is NonNullable<typeof value> => value !== null)
  const choice = perWindow.length ? chooseTempo(perWindow.map(window => window.peaks.filter(peak => peak.correlation >= 0.08))) : null
  // Soften: accept choice when any window has modest confidence, or legacy alone.
  const reconciled = legacy || (choice && perWindow.some(w => w.confidence >= 0.08)) ? reconcileTempo(legacy?.bpm ?? null, choice) : null
  const confidence = legacy?.confidence ?? Math.max(0, ...perWindow.map(window => window.confidence))
  const onsets = reconciled ? onsetEvents(full, sampleRate) : []
  // Fine-tune within ±2 % so the grid does not drift away from the music over a long clip.
  const refined = reconciled ? refineTempo(onsets, reconciled.bpm) : null
  const suggestions: number[] = []
  const add = (value: number) => {
    const v = roundBpm(value)
    if (inTempoRange(v) && !suggestions.some(a => Math.abs(a / v - 1) < 0.03)) suggestions.push(v)
  }
  if (reconciled) {
    add(refined ? refined.bpm : reconciled.bpm)
    for (const a of reconciled.alternatives) add(a)
  } else if (choice) {
    add(choice.bpm)
    for (const a of choice.alternatives) add(a)
  } else {
    // Last resort: top peaks across windows, scored.
    const peaks = perWindow.flatMap(w => w.peaks).filter(peak => inTempoRange(peak.bpm) && peak.score > 0)
      .sort((a, b) => b.score - a.score)
    for (const peak of peaks.slice(0, 6)) add(peak.bpm)
  }
  return {
    tempo: reconciled ? { ...reconciled, bpm: refined ? roundBpm(refined.bpm) : reconciled.bpm, confidence } : null,
    legacy,
    onsets,
    suggestions: suggestions.slice(0, 5),
  }
}
