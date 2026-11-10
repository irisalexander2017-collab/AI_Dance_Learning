import type { TimedEvent } from './onset.ts'

/** Phase search: where inside one beat period do accents (pose peaks) and music onsets pile up? */
const mod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor
const circularDistance = (time: number, phase: number, period: number) => {
  const d = mod(time - phase, period)
  return d > period / 2 ? d - period : d
}

export interface PhaseSource { events: TimedEvent[]; weight: number }
export interface PhaseResult {
  /** Offset of a beat inside [0, period), seconds. */
  phase: number
  /** 0..1: the weighted average of each source's concentration (resultant length); ≈ 0.1 means "no real rhythm". */
  concentration: number
  perSource: number[]
}

/** Circular statistics: resultant length R and mean phase of events folded at `period`. */
export function foldStats(events: TimedEvent[], period: number) {
  let re = 0, im = 0, total = 0
  for (const { time, strength } of events) {
    const angle = 2 * Math.PI * mod(time, period) / period
    re += strength * Math.cos(angle); im += strength * Math.sin(angle); total += strength
  }
  if (total <= 0) return { concentration: 0, phase: 0 }
  return { concentration: Math.hypot(re, im) / total, phase: mod(Math.atan2(im, re), 2 * Math.PI) * period / (2 * Math.PI) }
}

function gaussianScore(events: TimedEvent[], period: number, phase: number, sigma: number) {
  let score = 0, total = 0
  for (const { time, strength } of events) {
    const d = circularDistance(time, phase, period)
    score += strength * Math.exp(-0.5 * (d / sigma) ** 2); total += strength
  }
  return total > 0 ? score / total : 0
}

/** Best common phase for several evidence sources. Each source is normalised to its own total strength, so a
 *  sparse accent list cannot be drowned by a dense onset list; sources without events are ignored. */
export function alignPhase(period: number, sources: PhaseSource[], opts: { sigma?: number; around?: number; halfWidth?: number } = {}): PhaseResult | null {
  const used = sources.filter(source => source.weight > 0 && source.events.length >= 4)
  if (!used.length || !(period > 0)) return null
  const sigma = opts.sigma ?? Math.min(0.045, period * 0.12)
  const step = 0.004
  let best = { phase: 0, score: -1 }
  const evaluate = (phase: number) => used.reduce((sum, source) => sum + source.weight * gaussianScore(source.events, period, phase, sigma), 0)
  if (opts.around !== undefined && opts.halfWidth !== undefined) {
    for (let offset = -opts.halfWidth; offset <= opts.halfWidth + 1e-9; offset += step) {
      const phase = mod(opts.around + offset, period), score = evaluate(phase)
      if (score > best.score) best = { phase, score }
    }
  } else for (let phase = 0; phase < period; phase += step) { const score = evaluate(phase); if (score > best.score) best = { phase, score } }
  const perSource = used.map(source => foldStats(source.events, period).concentration)
  const weights = used.reduce((sum, source) => sum + source.weight, 0)
  return { phase: best.phase, concentration: used.reduce((sum, source, i) => sum + source.weight * perSource[i], 0) / weights, perSource }
}

/** Which of the `count` consecutive beats is the "1"? Folds accent strength modulo `count` beats. */
export function pickDownbeat(period: number, phase: number, sources: PhaseSource[], count = 8, sigma = Math.min(0.06, period * 0.15)): { beatOffset: number; margin: number } {
  const sums = new Array(count).fill(0)
  for (const source of sources) {
    const total = source.events.reduce((sum, event) => sum + event.strength, 0)
    if (!total || source.weight <= 0) continue
    for (const { time, strength } of source.events) {
      const beat = Math.round((time - phase) / period)
      if (Math.abs(time - phase - beat * period) > sigma * 2) continue
      sums[mod(beat, count)] += source.weight * strength / total
    }
  }
  let best = 0
  for (let i = 1; i < count; i++) if (sums[i] > sums[best]) best = i
  const sorted = [...sums].sort((a, b) => b - a)
  return { beatOffset: best, margin: sorted[0] > 0 ? (sorted[0] - sorted[1]) / sorted[0] : 0 }
}

/** Sharpens a rough tempo: the BPM within ±`span` whose beat period makes the onsets line up best over the whole track.
 *  Returns the input when no clear improvement exists. A 1 % tempo error would smear the grid by half a beat after ~50 beats. */
export function refineTempo(events: TimedEvent[], bpm: number, span = 0.02): { bpm: number; concentration: number } {
  if (events.length < 12) return { bpm, concentration: 0 }
  const steps = Math.round(span / 0.0004)
  const scores: number[] = []
  for (let i = -steps; i <= steps; i++) scores.push(foldStats(events, 60 / (bpm * (1 + i * 0.0004))).concentration)
  let best = 0
  scores.forEach((score, i) => { if (score > scores[best]) best = i })
  const center = scores[steps]
  if (scores[best] < center * 1.15 + 0.02) return { bpm, concentration: center }
  // Parabolic interpolation around the peak for sub-step precision.
  const left = scores[Math.max(0, best - 1)], right = scores[Math.min(scores.length - 1, best + 1)], mid = scores[best]
  const denom = left - 2 * mid + right
  const shift = denom < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denom)) : 0
  return { bpm: Math.round(bpm * (1 + (best - steps + shift) * 0.0004) * 100) / 100, concentration: scores[best] }
}
