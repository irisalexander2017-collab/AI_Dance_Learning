import type { TempoPeak } from '../practice/tempoAnalysis.ts'

export const MIN_BPM = 40
export const MAX_BPM = 240
/** Dance practice music clusters around 85–150 BPM; this soft prior breaks half/double-time ties. */
export const PRIOR_CENTER_BPM = 118
export const PRIOR_SPREAD = 0.38

export const tempoPrior = (bpm: number) => Math.exp(-0.5 * (Math.log(bpm / PRIOR_CENTER_BPM) / PRIOR_SPREAD) ** 2)
export const inTempoRange = (bpm: number) => Number.isFinite(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM
export const roundBpm = (bpm: number) => Math.round(bpm * 10) / 10

export interface TempoChoice {
  bpm: number
  /** Other plausible tempi, best first (always contains the ×2 / ÷2 neighbours that fit 40–240). */
  alternatives: number[]
  support: number
}

function relation(ratio: number): number {
  const near = (target: number) => Math.abs(ratio / target - 1) < 0.03
  if (near(1)) return 1
  if (near(2) || near(0.5)) return 0.5
  if (near(3) || near(1 / 3)) return 0.25
  return 0
}

/** Picks a tempo from the autocorrelation peaks of several audio windows. Peaks that are 2× / ½× / 3× of a
 *  hypothesis support it partially; the speed prior then prefers 85–150 BPM over its half/double-time twin. */
export function chooseTempo(windows: TempoPeak[][]): TempoChoice | null {
  const peaks = windows.flat().filter(peak => inTempoRange(peak.bpm) && peak.score > 0)
  if (!peaks.length) return null
  const hypotheses: number[] = []
  for (const peak of peaks) for (const factor of [1, 2, 0.5]) {
    const bpm = peak.bpm * factor
    if (inTempoRange(bpm) && !hypotheses.some(existing => Math.abs(existing / bpm - 1) < 0.02)) hypotheses.push(bpm)
  }
  const count = Math.max(1, windows.length)
  const ranked = hypotheses.map(hypothesis => {
    let support = 0
    for (const peak of peaks) support += peak.score * relation(peak.bpm / hypothesis)
    return { bpm: hypothesis, support: support / count, value: support / count * tempoPrior(hypothesis) }
  }).sort((a, b) => b.value - a.value)
  const best = ranked[0]
  if (!best || best.support <= 0) return null
  // Refine the winning value as the score-weighted mean of the peaks that directly support it.
  const direct = peaks.filter(peak => Math.abs(peak.bpm / best.bpm - 1) < 0.03)
  const refined = direct.length ? direct.reduce((sum, peak) => sum + peak.bpm * peak.score, 0) / direct.reduce((sum, peak) => sum + peak.score, 0) : best.bpm
  const bpm = roundBpm(refined)
  const alternatives: number[] = []
  const add = (value: number) => { const v = roundBpm(value); if (inTempoRange(v) && Math.abs(v / bpm - 1) > 0.03 && !alternatives.some(a => Math.abs(a / v - 1) < 0.03)) alternatives.push(v) }
  add(bpm * 2); add(bpm / 2)
  for (const other of ranked.slice(1, 4)) add(other.bpm)
  return { bpm, alternatives: alternatives.slice(0, 4), support: best.support }
}

/** Reconciles the legacy single-value estimator with the prior-aware choice: when they differ only by a
 *  half/double-time factor the prior decides; unrelated values keep the legacy (tested) result. */
export function reconcileTempo(legacyBpm: number | null, choice: TempoChoice | null): { bpm: number; alternatives: number[] } | null {
  if (legacyBpm === null) return choice ? { bpm: choice.bpm, alternatives: choice.alternatives } : null
  if (!choice) return { bpm: legacyBpm, alternatives: [roundBpm(legacyBpm * 2), roundBpm(legacyBpm / 2)].filter(inTempoRange) }
  const ratio = choice.bpm / legacyBpm
  const octave = Math.abs(ratio / 2 - 1) < 0.04 || Math.abs(ratio * 2 - 1) < 0.04
  const same = Math.abs(ratio - 1) < 0.04
  const bpm = octave ? (tempoPrior(choice.bpm) > tempoPrior(legacyBpm) * 1.15 ? choice.bpm : legacyBpm) : legacyBpm
  const alternatives = [...(same || octave ? [] : [choice.bpm]), ...choice.alternatives, legacyBpm * 2, legacyBpm / 2]
    .map(roundBpm).filter((v, i, all) => inTempoRange(v) && Math.abs(v / bpm - 1) > 0.03 && all.findIndex(o => Math.abs(o / v - 1) < 0.03) === i)
  return { bpm, alternatives: alternatives.slice(0, 4) }
}
