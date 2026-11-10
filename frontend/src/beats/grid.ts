/** The "老师数拍子" grid. Number beats (1…8) sit on a regular lattice anchored at one video time; the extra "and" hits inside a
 *  beat are either fixed (one "&" at the half beat) or follow the teacher (0–3 per beat → &, e a, or e & a, from the motion accents). */
export const COUNT_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'] as const
export type CountWord = typeof COUNT_WORDS[number] | 'and'

/** Positions of the extra hits inside beat k, as fractions of a beat. */
export type SubPattern = Readonly<Record<number, readonly number[]>>
export const FIXED_SUBS: readonly number[] = [0.5]

/** Overlay / spoken syllable for the n-th extra hit when a beat has `count` extras.
 *  0 → none; 1 → & (and); 2 → e a; 3 → e & a. Voice samples only ship "and", so word stays 'and'. */
export function subSyllable(count: number, which: number): { label: string; word: CountWord } {
  const labels = count <= 1 ? ['&'] : count === 2 ? ['e', 'a'] : ['e', '&', 'a']
  return { label: labels[Math.max(0, Math.min(labels.length - 1, which))] ?? '&', word: 'and' }
}

export interface BeatGrid {
  /** Number-beat tempo: one count "1…8" per 60/bpm seconds. */
  bpm: number
  /** Video time (s) of the count "1". */
  anchor: number
  /** Manual fine-tuning of "and" points, seconds keyed by point index (k·4 + s with s = 1…3). */
  adjust: Readonly<Record<number, number>>
  /** null = fixed "1 & 2 &" (one "&" per beat); otherwise the per-beat extra hits that follow the teacher. */
  subs?: SubPattern | null
}

export interface GridPoint {
  /** k·4 + s: beat number k counted from the anchor, s = 0 for the number and 1…3 for the extra hits. */
  index: number
  time: number
  /** 1..8 */
  beat: number
  /** true for an "and" */
  half: boolean
  /** 0 for the number, 1…3 for the extra hits */
  sub: number
  /** "1".."8" or "&" */
  label: string
  word: CountWord
  adjusted: boolean
}

const mod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor
export const beatInterval = (bpm: number) => 60 / bpm
/** Kept for the fixed "& at the half beat" layout. */
export const halfBeat = (bpm: number) => 30 / bpm
export const maxAdjust = (bpm: number) => Math.min(0.25, 15 / bpm * 0.9)
export const beatOfIndex = (index: number) => Math.floor(index / 4)
export const subOfIndex = (index: number) => mod(index, 4)

export function clampAdjust(bpm: number, seconds: number) {
  const limit = maxAdjust(bpm)
  return Math.min(limit, Math.max(-limit, seconds))
}

export const subsOfBeat = (grid: BeatGrid, k: number): readonly number[] => grid.subs ? grid.subs[k] ?? [] : FIXED_SUBS

export function pointAt(grid: BeatGrid, index: number): GridPoint | null {
  const k = beatOfIndex(index), s = subOfIndex(index)
  const interval = beatInterval(grid.bpm)
  const beat = mod(k, 8) + 1
  if (s === 0) return { index, time: grid.anchor + k * interval, beat, half: false, sub: 0, label: String(beat), word: COUNT_WORDS[beat - 1], adjusted: false }
  const fractions = subsOfBeat(grid, k)
  const fraction = fractions[s - 1]
  if (fraction === undefined) return null
  const offset = grid.adjust[index] ?? 0
  const syl = subSyllable(fractions.length, s - 1)
  return { index, time: grid.anchor + (k + fraction) * interval + offset, beat, half: true, sub: s, label: syl.label, word: syl.word, adjusted: Math.abs(offset) > 1e-4 }
}

function beatPoints(grid: BeatGrid, k: number): GridPoint[] {
  const out: GridPoint[] = []
  for (let s = 0; s <= 3; s++) { const point = pointAt(grid, k * 4 + s); if (point) out.push(point) }
  return out
}

/** Points whose (adjusted) time falls in [from, to), in time order. */
export function pointsBetween(grid: BeatGrid, from: number, to: number): GridPoint[] {
  const interval = beatInterval(grid.bpm), slack = maxAdjust(grid.bpm)
  const first = Math.floor((from - slack - grid.anchor) / interval) - 1, last = Math.ceil((to + slack - grid.anchor) / interval)
  const out: GridPoint[] = []
  for (let k = first; k <= last; k++) for (const point of beatPoints(grid, k)) if (point.time >= from && point.time < to) out.push(point)
  return out.sort((a, b) => a.time - b.time)
}

/** The count that is "current" at `time` (the last point whose time has passed). */
export function activePoint(grid: BeatGrid, time: number): GridPoint {
  const interval = beatInterval(grid.bpm)
  const k = Math.floor((time - grid.anchor) / interval)
  let best: GridPoint | null = null
  for (let j = k - 2; j <= k + 1; j++) for (const point of beatPoints(grid, j)) if (point.time <= time && (!best || point.time > best.time)) best = point
  return best ?? pointAt(grid, (k - 2) * 4)!
}

export interface CountEvent { index: number; word: CountWord; label: string; mediaTime: number; beat: number }

/** Count events in a media window; `includeAnd=false` yields only the numbers. */
export function planCountEvents(grid: BeatGrid, from: number, to: number, includeAnd = true): CountEvent[] {
  return pointsBetween(grid, from, to)
    .filter(point => includeAnd || !point.half)
    .map(point => ({ index: point.index, word: point.word, label: point.label, mediaTime: point.time, beat: point.beat }))
}

/** Wall-clock seconds from "now" until a count sounds, when the video plays at `rate`. Samples are never stretched. */
export const realDelay = (mediaTime: number, mediaNow: number, rate: number) => (mediaTime - mediaNow) / rate

const withAdjust = (grid: BeatGrid, index: number, seconds: number): Record<number, number> => {
  const next = { ...grid.adjust }
  const value = clampAdjust(grid.bpm, seconds)
  if (Math.abs(value) < 0.0005) delete next[index]; else next[index] = Math.round(value * 10000) / 10000
  return next
}

export function nudgeAdjust(grid: BeatGrid, index: number, deltaSeconds: number): Record<number, number> {
  if (subOfIndex(index) === 0) return { ...grid.adjust }
  return withAdjust(grid, index, (grid.adjust[index] ?? 0) + deltaSeconds)
}

/** Drag support: put the "and" at `index` exactly at `time` (clamped). */
export function setAdjustToTime(grid: BeatGrid, index: number, time: number): Record<number, number> {
  if (subOfIndex(index) === 0) return { ...grid.adjust }
  const base = pointAt({ ...grid, adjust: {} }, index)
  if (!base) return { ...grid.adjust }
  return withAdjust(grid, index, time - base.time)
}
