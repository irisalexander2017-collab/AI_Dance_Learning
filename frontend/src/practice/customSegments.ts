import type { LearningSegment } from './beatTimeline.ts'

/** Free-length sections: cut points are absolute video times, never tied to BPM or the eight-beat grid. */
export type SegmentMode = 'beats' | 'custom'
export const MIN_SEGMENT_SECONDS = 0.5

export function normalizeCuts(cuts: readonly number[], duration: number): number[] {
  const sorted = cuts.filter(Number.isFinite).map(value => Math.round(value * 100) / 100).sort((a, b) => a - b)
  const out: number[] = []
  for (const cut of sorted) {
    if (cut < MIN_SEGMENT_SECONDS || (duration > 0 && cut > duration - MIN_SEGMENT_SECONDS)) continue
    if (out.length && cut - out[out.length - 1] < MIN_SEGMENT_SECONDS) continue
    out.push(cut)
  }
  return out
}

export function addCut(cuts: readonly number[], time: number, duration: number): number[] | null {
  const next = normalizeCuts([...cuts, time], duration)
  return next.length === normalizeCuts(cuts, duration).length + 1 ? next : null
}

export function moveCut(cuts: readonly number[], index: number, time: number, duration: number): number[] | null {
  if (index < 0 || index >= cuts.length) return null
  const low = (cuts[index - 1] ?? 0) + MIN_SEGMENT_SECONDS, high = (cuts[index + 1] ?? duration) - MIN_SEGMENT_SECONDS
  if (time < low || time > high) return null
  const next = [...cuts]; next[index] = Math.round(time * 100) / 100
  return next
}

export const removeCut = (cuts: readonly number[], index: number) => cuts.filter((_, i) => i !== index)

/** One cut = two sections. No cuts = no sections (the whole video just plays). */
export function buildCustomSegments(cuts: readonly number[], duration: number): LearningSegment[] {
  const points = normalizeCuts(cuts, duration)
  if (!points.length || !(duration > 0)) return []
  const edges = [0, ...points, duration]
  return edges.slice(0, -1).map((startTime, index) => ({
    startTime, endTime: edges[index + 1], segmentIndex: index + 1, startBeat: '', endBeat: '', incomplete: false,
  }))
}


/** One press: mark the end of the first section, then tile that length across the whole video. */
export function evenCutsFromFirst(firstEnd: number, duration: number): number[] {
  const len = Math.round(firstEnd * 100) / 100
  if (!(len >= MIN_SEGMENT_SECONDS) || !(duration > 0) || len >= duration - MIN_SEGMENT_SECONDS) return []
  const cuts: number[] = []
  let t = len
  while (t < duration - MIN_SEGMENT_SECONDS + 1e-9) {
    cuts.push(Math.round(t * 100) / 100)
    t += len
  }
  return normalizeCuts(cuts, duration)
}

export function segmentIndexAt(segments: readonly LearningSegment[], time: number): number {
  const index = segments.findIndex(segment => time >= segment.startTime && time < segment.endTime)
  return index >= 0 ? index : time >= (segments[segments.length - 1]?.endTime ?? 0) ? Math.max(0, segments.length - 1) : 0
}
