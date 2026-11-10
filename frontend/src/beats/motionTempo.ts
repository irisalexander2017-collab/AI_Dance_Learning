import type { AccentCurve, AccentPeak } from '../pose/motionAccents.ts'

/** Teacher-driven count: everything here works on the motion-energy curve and its accent peaks (see motionAccents.ts),
 *  and decides (1) when the teacher starts moving, (2) the rhythmic level of the *number* beats, (3) where the first
 *  "1" sits and (4) how many extra "and" hits each beat has. Pure functions, unit-tested. */

const percentile = (values: ArrayLike<number>, q: number) => { const s = Array.from(values).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0 }

/** Number beats between 40 and 150 per minute are countable by a person; faster levels stay "and"s inside a beat. */
export const NUMBER_INTERVAL_RANGE = { min: 0.4, max: 1.5 } as const
/** Candidate relations between the music BPM and the number-beat level (the music BPM itself ×2/÷2/×3/÷3 and the 3:2 pair). */
/** Whole-number multiples / fractions of the music pulse only: a count of 1·2·3 must stay on the music's own pulse (no 3:2 levels). */
export const LEVEL_RATIOS = [1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4] as const
/** Where the teacher's extra hits may fall inside one number beat. */
export const SUB_POSITIONS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4] as const
export const MAX_SUBS = 3
/** Peaks weaker than this (normalized strength from pickPeaks) do not create a sub-syllable. */
export const MIN_SUB_STRENGTH = 0.35

export interface MotionPeriod {
  /** Dominant period of the motion-energy curve, seconds (comb-enhanced autocorrelation). */
  seconds: number
  /** Autocorrelation at that lag divided by lag 0; ~0.1 is already a clear rhythm in dance footage. */
  strength: number
  reliable: boolean
  /** Strongest autocorrelation maxima, for the report. */
  peaks: { seconds: number; score: number }[]
}

export interface MotionAnalysis {
  /** Time (s) at which the teacher starts moving; null if no sustained movement was found. */
  danceStart: number | null
  period: MotionPeriod | null
  duration: number
  /** Accent peaks per second over the moving part of the clip. */
  hitsPerSecond: number
}

/** First time the (smoothed) motion energy rises above a threshold and *stays* there. A first-frame spike, a short
 *  jitter or a still title card is ignored because the energy has to hold for most of the next 1.2 s. */
export function detectDanceStart(curve: AccentCurve): { time: number | null; confidence: number } {
  const { values, dt } = curve
  const n = values.length
  if (n < 20) return { time: null, confidence: 0 }
  const w = Math.max(1, Math.round(0.4 / dt))
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i]
  const smooth = (i: number) => { const a = Math.max(0, i - w), b = Math.min(n, i + w + 1); return (prefix[b] - prefix[a]) / (b - a) }
  const sm = Float32Array.from({ length: n }, (_, i) => smooth(i))
  // Reference = typical energy while moving (upper-middle of the clip), threshold = 45 % of it.
  const active = Array.from(sm).filter(v => v > 0)
  if (active.length < 10) return { time: null, confidence: 0 }
  const reference = percentile(active, 0.6)
  // Pose jitter on a still body stays far below 0.1 body-sizes/s, real dancing is around 1: below the floor there is no movement to lock to.
  if (reference < 0.1) return { time: null, confidence: 0 }
  const threshold = 0.45 * reference
  // The first 0.6 s are skipped: pose trackers settle on the person and the clip fades in during that time.
  const hold = Math.round(1.2 / dt), skip = Math.round(0.6 / dt), fineW = Math.max(1, Math.round(0.05 / dt)), probe = Math.round(0.3 / dt)
  const fine = (i: number) => { const a = Math.max(0, i - fineW), b = Math.min(n, i + fineW + 1); return (prefix[b] - prefix[a]) / (b - a) }
  for (let i = skip; i + hold < n; i++) {
    if (sm[i] < threshold) continue
    let above = 0
    for (let j = i; j < i + hold; j++) if (sm[j] >= threshold) above++
    if (above / hold < 0.8) continue
    // The 0.8 s smoothing blurs the edge: look for where the lightly smoothed energy really crosses the threshold and stays above for 0.3 s.
    let start = i
    for (let k = Math.max(skip, i - w); k <= i; k++) {
      let ok = true
      for (let j = k; j < Math.min(n, k + probe); j += 2) if (fine(j) < threshold) { ok = false; break }
      if (ok) { start = k; break }
    }
    return { time: Math.round(start * dt * 1000) / 1000, confidence: Math.min(1, above / hold) }
  }
  return { time: null, confidence: 0 }
}

/** Dominant movement period from the autocorrelation of the high-passed energy curve, searched inside the countable range of number beats (0.4–1.5 s). */
export function motionPeriod(curve: AccentCurve, minSeconds = NUMBER_INTERVAL_RANGE.min, maxSeconds = NUMBER_INTERVAL_RANGE.max): MotionPeriod | null {
  const { values, dt } = curve
  const n = values.length
  const maxLag = Math.round(maxSeconds * 2 / dt)
  if (n < maxLag * 2) return null
  // High-pass (subtract a 1 s moving mean) so slow energy swells do not dominate.
  const w = Math.round(0.5 / dt)
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i]
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - w), b = Math.min(n, i + w + 1); x[i] = values[i] - (prefix[b] - prefix[a]) / (b - a) }
  const ac = new Float32Array(maxLag + 1)
  for (let lag = 0; lag <= maxLag; lag++) { let s = 0; for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag]; ac[lag] = s / (n - lag) }
  if (!(ac[0] > 1e-9)) return null
  const norm = Float32Array.from(ac, v => v / ac[0])
  const lo = Math.round(minSeconds / dt), hi = Math.round(maxSeconds / dt)
  const peaks: { seconds: number; score: number; lag: number }[] = []
  for (let lag = Math.max(2, lo); lag <= hi; lag++) {
    if (norm[lag] > norm[lag - 1] && norm[lag] >= norm[lag + 1] && norm[lag] > 0.02) {
      // comb: a true period also repeats at twice the lag
      const twice = lag * 2 <= maxLag ? Math.max(0, norm[lag * 2]) : 0
      peaks.push({ seconds: lag * dt, score: norm[lag] + 0.5 * twice, lag })
    }
  }
  if (!peaks.length) return null
  peaks.sort((a, b) => b.score - a.score)
  const best = peaks[0]
  return { seconds: best.seconds, strength: norm[best.lag], reliable: norm[best.lag] >= 0.05, peaks: peaks.slice(0, 4).map(({ seconds, score }) => ({ seconds, score })) }
}

export function analyzeMotion(curve: AccentCurve): MotionAnalysis {
  const start = detectDanceStart(curve)
  const duration = curve.values.length * curve.dt
  const movingSpan = Math.max(1, duration - (start.time ?? 0))
  return {
    danceStart: start.time, period: motionPeriod(curve), duration,
    hitsPerSecond: curve.peaks.filter(peak => peak.time >= (start.time ?? 0)).length / movingSpan,
  }
}

export interface LevelCandidate { ratio: number; bpm: number; interval: number; hitsPerBeat: number; cost: number }
export interface LevelChoice {
  /** Number-beat BPM actually used (audio BPM × ratio). */
  bpm: number
  ratio: number
  interval: number
  /** False when the motion gave no usable rhythm; the music BPM is then kept unchanged. */
  reliable: boolean
  candidates: LevelCandidate[]
  /** Cost gap between the best and the second-best candidate: below ~0.25 the choice is tentative. */
  margin: number
}

/** Picks the rhythmic level of the number beats. `audioBpm` is the music tempo (tag or onset analysis), the candidates are
 *  its ×2/÷2/×3/÷3 and 3:2 relatives. The best candidate has an interval close to the dominant movement period, carries about
 *  1–2 teacher hits per number, and stays near the music tempo when the evidence is a tie. */
export function chooseNumberLevel(audioBpm: number, motion: MotionAnalysis | null, peaks: AccentPeak[], hitsTarget = 1.6, audioCandidates: number[] = []): LevelChoice {
  const span = motion ? Math.max(1, motion.duration - (motion.danceStart ?? 0)) : 1
  const start = motion?.danceStart ?? 0
  const moving = peaks.filter(peak => peak.time >= start)
  const reliablePeriod = !!motion?.period && motion.period.reliable
  const hasHits = moving.length >= 12
  const candidates: LevelCandidate[] = LEVEL_RATIOS.map(ratio => {
    const bpm = audioBpm * ratio, interval = 60 / bpm
    const hitsPerBeat = moving.length / (span / interval)
    // A light prior for the music tempo itself, and a bonus when the audio detector independently lists this tempo as a candidate.
    let cost = 0.15 * Math.abs(Math.log(ratio))
    if (ratio !== 1 && audioCandidates.some(candidate => Math.abs(Math.log(candidate / bpm)) < 0.03)) cost -= 0.12
    if (reliablePeriod) cost += Math.min(...motion!.period!.peaks.slice(0, 3).map(peak => Math.abs(Math.log(interval / peak.seconds))))
    if (hasHits) cost += 0.7 * Math.abs(Math.log(Math.max(0.05, hitsPerBeat) / hitsTarget))
    return { ratio, bpm, interval, hitsPerBeat, cost }
  }).filter(candidate => candidate.interval >= NUMBER_INTERVAL_RANGE.min - 1e-9 && candidate.interval <= NUMBER_INTERVAL_RANGE.max + 1e-9)
  const direct = { ratio: 1, bpm: audioBpm, interval: 60 / audioBpm, hitsPerBeat: 0, cost: 0 }
  if (!candidates.length) return { bpm: audioBpm, ratio: 1, interval: 60 / audioBpm, reliable: false, candidates: [direct], margin: 0 }
  if (!reliablePeriod && !hasHits) return { bpm: audioBpm, ratio: 1, interval: 60 / audioBpm, reliable: false, candidates, margin: 0 }
  const ranked = [...candidates].sort((a, b) => a.cost - b.cost)
  const best = ranked[0]
  return { bpm: Math.round(best.bpm * 100) / 100, ratio: best.ratio, interval: best.interval, reliable: true, candidates, margin: ranked.length > 1 ? ranked[1].cost - best.cost : 1 }
}

export interface FirstBeat {
  anchor: number
  /** 'dance-start' = the detected start unchanged; 'dance-start+peak' = snapped to the first accent next to it; 'dance-start+evidence' = phase moved onto the accents the whole clip agrees on. */
  source: 'dance-start' | 'dance-start+peak' | 'dance-start+evidence'
  /** Movement start the beat grid was anchored to (before the phase refinement), seconds. */
  start: number
  /** Applied refinement in ms (+ = later than the detected start). */
  shiftMs: number
  /** Mean accent proximity (0..1) of the beats at the chosen phase and at the plain start, to show how much the evidence agreed. */
  score: number
  baseScore: number
}

/** How well beats at anchor + k·interval line up with accent events: mean over beats of the best-matching event's Gaussian-weighted strength. */
export function beatAccentScore(events: AccentPeak[], anchor: number, interval: number, duration: number, sigma = 0.06): number {
  if (!events.length) return 0
  const sorted = events
  let total = 0, count = 0, cursor = 0
  const start = Math.ceil((0 - anchor) / interval)
  for (let k = start; anchor + k * interval <= duration; k++) {
    const time = anchor + k * interval
    while (cursor < sorted.length - 1 && sorted[cursor + 1].time < time) cursor++
    let best = 0
    for (let j = Math.max(0, cursor - 1); j <= Math.min(sorted.length - 1, cursor + 2); j++) best = Math.max(best, Math.min(2, sorted[j].strength) / 2 * Math.exp(-0.5 * ((sorted[j].time - time) / sigma) ** 2))
    total += best; count++
  }
  return count ? total / count : 0
}

/** The teacher's first beat. It starts at the detected movement start; the phase is then moved by at most a third of a beat
 *  (≤ 0.3 s) to the offset at which the whole clip's motion accents (and, with less weight, the music onsets) agree best —
 *  but only when that is clearly better than the plain start (+8 %), otherwise the detected start stays. */
export function lockFirstBeat(start: number, interval: number, motionPeaks: AccentPeak[], audioOnsets: AccentPeak[], duration: number): FirstBeat {
  const reach = Math.min(interval / 3, 0.3)
  const score = (anchor: number) => beatAccentScore(motionPeaks, anchor, interval, duration) + 0.5 * beatAccentScore(audioOnsets, anchor, interval, duration)
  const base = score(start)
  let best = { anchor: start, score: base }
  for (let offset = -reach; offset <= reach + 1e-9; offset += 0.004) {
    const anchor = start + offset
    if (anchor < 0) continue
    const value = score(anchor)
    if (value > best.score) best = { anchor, score: value }
  }
  const moved = best.score > base * 1.08 + 0.003
  // The first beat is the lattice beat next to the teacher's first accent (a detected start is only accurate to a few tenths of a second).
  const first = motionPeaks.find(peak => peak.time >= start - 0.1 && peak.time <= start + interval / 2)
  let anchor = moved ? best.anchor : start
  let source: FirstBeat['source'] = moved ? 'dance-start+evidence' : 'dance-start'
  if (moved) anchor = best.anchor + Math.round(((first?.time ?? start) - best.anchor) / interval) * interval
  else if (first) { anchor = first.time; source = 'dance-start+peak' }
  while (anchor < 0) anchor += interval
  return { anchor, source, start, shiftMs: Math.round((anchor - start) * 1000), score: moved ? best.score : base, baseScore: base }
}

export type SubPattern = Record<number, number[]>

/** Extra-hit positions per number beat from accent peaks *between* beats. Beat k covers
 *  [anchor + k·T, anchor + (k+1)·T). Peaks within ±max(90 ms, 15 % of T) of a beat belong to the number (no sub).
 *  Weak peaks (strength < MIN_SUB_STRENGTH) are ignored — prefer fewer wrong ands.
 *  Follow mode places each sub near the accent; nearby accents merge; at most MAX_SUBS (3 → 1 e & a). */
export function quantizeSubBeats(peaks: AccentPeak[], anchor: number, interval: number, from: number, to: number): SubPattern {
  const pattern: SubPattern = {}
  const guard = Math.max(0.09, 0.15 * interval)
  const first = Math.floor((from - anchor) / interval), last = Math.ceil((to - anchor) / interval)
  for (let k = first; k <= last; k++) pattern[k] = []
  const perBeat = new Map<number, AccentPeak[]>()
  for (const peak of peaks) {
    const k = Math.floor((peak.time - anchor) / interval)
    const offset = peak.time - anchor - k * interval
    if (offset < guard || interval - offset < guard) continue
    if (peak.time < from || peak.time > to) continue
    if (peak.strength < MIN_SUB_STRENGTH) continue
    const list = perBeat.get(k) ?? []
    list.push({ time: offset / interval, strength: peak.strength }); perBeat.set(k, list)
  }
  const mergeGap = 1 / 5
  for (const [k, raw] of perBeat) {
    const merged: AccentPeak[] = []
    for (const peak of [...raw].sort((a, b) => b.strength - a.strength)) if (merged.every(other => Math.abs(other.time - peak.time) >= mergeGap)) merged.push(peak)
    const kept = merged.sort((a, b) => b.strength - a.strength).slice(0, MAX_SUBS).sort((a, b) => a.time - b.time)
    pattern[k] = placeSubs(kept.map(peak => peak.time))
  }
  return pattern
}

/** Keep accent-relative fractions (clamped away from the number beats); ensure ≥0.18 beat gap between subs.
 *  Supports 0–3 extras (1 / 1& / 1 e a / 1 e & a). If three cannot fit with min gaps, drop to two. */
export function placeSubs(fractions: number[]): number[] {
  const lo = 0.12, hi = 0.88, minGap = 0.18
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v))
  const round = (v: number) => Math.round(v * 1000) / 1000
  if (fractions.length === 0) return []
  if (fractions.length === 1) return [round(clamp(fractions[0]))]
  if (fractions.length === 2) {
    let a = clamp(fractions[0]), b = clamp(fractions[1])
    if (b < a) [a, b] = [b, a]
    if (b - a < minGap) {
      const mid = (a + b) / 2
      a = clamp(mid - minGap / 2); b = clamp(mid + minGap / 2)
      if (b - a < minGap) return [round((a + b) / 2)] // too cramped → one sub
    }
    return [round(a), round(b)]
  }
  // 3 extras → aim for e & a spacing; if gaps collapse, fall back to two.
  let vals = fractions.slice(0, 3).map(clamp).sort((a, b) => a - b)
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] - vals[i - 1] >= minGap) continue
      const mid = (vals[i] + vals[i - 1]) / 2
      vals[i - 1] = clamp(mid - minGap / 2)
      vals[i] = clamp(mid + minGap / 2)
    }
    vals = vals.map(clamp).sort((a, b) => a - b)
  }
  const ok = vals.every((v, i) => i === 0 || v - vals[i - 1] >= minGap - 1e-9)
  if (!ok) return placeSubs([vals[0], vals[vals.length - 1]])
  return vals.map(round)
}

/** Legacy discrete snap (fixed-style grids / tests); follow mode uses placeSubs instead. */
export function snapSubs(fractions: number[]): number[] {
  if (fractions.length === 0) return []
  if (fractions.length === 1) return [SUB_POSITIONS.reduce((best, p) => Math.abs(p - fractions[0]) < Math.abs(best - fractions[0]) ? p : best, 0.5)]
  if (fractions.length === 2) {
    const pairs: [number, number][] = [[1 / 3, 2 / 3], [1 / 4, 1 / 2], [1 / 2, 3 / 4], [1 / 4, 3 / 4]]
    return pairs.reduce((best, pair) => Math.abs(pair[0] - fractions[0]) + Math.abs(pair[1] - fractions[1]) < Math.abs(best[0] - fractions[0]) + Math.abs(best[1] - fractions[1]) ? pair : best, pairs[0])
  }
  return placeSubs(fractions.slice(0, MAX_SUBS))
}

export interface SubStats { beats: number; withSubs: [number, number, number, number]; examples: { beat: number; time: number; subs: number[] }[] }
export function subStats(pattern: SubPattern, anchor: number, interval: number, from: number, to: number): SubStats {
  const withSubs: [number, number, number, number] = [0, 0, 0, 0]
  const examples: SubStats['examples'] = []
  let beats = 0
  for (const [key, subs] of Object.entries(pattern)) {
    const k = Number(key), time = anchor + k * interval
    if (time < from || time + interval > to) continue
    beats++; withSubs[Math.min(3, subs.length)]++
    if (subs.length && examples.length < 6) examples.push({ beat: k, time: Math.round(time * 100) / 100, subs })
  }
  return { beats, withSubs, examples }
}
