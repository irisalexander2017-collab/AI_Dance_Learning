export type PracticeRangeMode = 'current' | 'previous-current' | 'from-start'

export interface BeatPoint {
  time: number
  beatNumber: number
  isHalf: boolean
  label: string
  halfStep: number
}

export interface LearningSegment {
  startTime: number
  endTime: number
  segmentIndex: number
  startBeat: string
  endBeat: string
  incomplete: boolean
}

export interface PracticeRange {
  startTime: number
  endTime: number
}

export function getPreparationRange(segments: LearningSegment[], bpm: number): PracticeRange | null {
  if (segments.length === 0) return null
  const formalStart = segments[0].startTime
  const startTime = Math.max(0, formalStart - beatDuration(bpm) * 8)
  if (startTime >= formalStart - 0.001) return null
  return { startTime, endTime: segments[0].endTime }
}

const modulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor

export function beatDuration(bpm: number) {
  return 60 / bpm
}

export function beatPointAtStep(firstBeatTime: number, bpm: number, halfStep: number): BeatPoint {
  const beatIndex = Math.floor(halfStep / 2)
  const beatNumber = modulo(beatIndex, 8) + 1
  const isHalf = modulo(halfStep, 2) === 1
  return {
    time: firstBeatTime + halfStep * beatDuration(bpm) / 2,
    beatNumber,
    isHalf,
    label: isHalf ? `${beatNumber}-and` : String(beatNumber),
    halfStep,
  }
}

export function nearestBeatPoint(time: number, firstBeatTime: number, bpm: number) {
  const halfDuration = beatDuration(bpm) / 2
  return beatPointAtStep(firstBeatTime, bpm, Math.round((time - firstBeatTime) / halfDuration))
}

export function activeBeatPoint(time: number, firstBeatTime: number, bpm: number) {
  const halfDuration = beatDuration(bpm) / 2
  return beatPointAtStep(firstBeatTime, bpm, Math.floor((time - firstBeatTime) / halfDuration + 0.0001))
}

export function buildLearningSegments(duration: number, formalStartTime: number, firstBeatTime: number, bpm: number) {
  const segmentDuration = beatDuration(bpm) * 8
  const segments: LearningSegment[] = []
  let startTime = Math.max(0, formalStartTime)
  let index = 1
  while (startTime < duration - 0.001) {
    const naturalEnd = startTime + segmentDuration
    const endTime = Math.min(duration, naturalEnd)
    segments.push({
      startTime,
      endTime,
      segmentIndex: index,
      startBeat: nearestBeatPoint(startTime, firstBeatTime, bpm).label,
      endBeat: activeBeatPoint(Math.max(startTime, endTime - 0.001), firstBeatTime, bpm).label,
      incomplete: naturalEnd > duration + 0.001,
    })
    startTime = naturalEnd
    index += 1
  }
  return segments
}

export function applyBoundaryOffsets(segments: LearningSegment[], offsets: number[], firstBeatTime: number, bpm: number) {
  if (segments.length < 2) return segments
  const boundaries = segments.slice(0, -1).map((segment, index) => {
    const previous = index === 0 ? segments[0].startTime : segments[index - 1].endTime + (offsets[index - 1] ?? 0)
    const next = segments[index + 1].endTime + (offsets[index + 1] ?? 0)
    return Math.min(next - 0.25, Math.max(previous + 0.25, segment.endTime + (offsets[index] ?? 0)))
  })
  return segments.map((segment, index) => {
    const startTime = index === 0 ? segment.startTime : boundaries[index - 1]
    const endTime = index === segments.length - 1 ? segment.endTime : boundaries[index]
    return {
      ...segment,
      startTime,
      endTime,
      startBeat: nearestBeatPoint(startTime, firstBeatTime, bpm).label,
      endBeat: activeBeatPoint(Math.max(startTime, endTime - 0.001), firstBeatTime, bpm).label,
    }
  })
}

export function getPracticeRange(
  mode: PracticeRangeMode,
  segments: LearningSegment[],
  currentIndex: number,
  duration: number,
  bpm: number,
): PracticeRange {
  if (segments.length === 0) return { startTime: 0, endTime: duration }
  const safeIndex = Math.min(Math.max(0, currentIndex), segments.length - 1)
  const current = segments[safeIndex]
  const preparationStart = getPreparationRange(segments, bpm)?.startTime ?? segments[0].startTime
  if (mode === 'current' && safeIndex === 0) return { startTime: preparationStart, endTime: current.endTime }
  if (mode === 'previous-current') return { startTime: safeIndex <= 1 ? preparationStart : segments[safeIndex - 1].startTime, endTime: current.endTime }
  if (mode === 'from-start') return { startTime: preparationStart, endTime: current.endTime }
  return { startTime: current.startTime, endTime: current.endTime }
}

export function videoStorageKey(file: Pick<File, 'name' | 'size' | 'lastModified'>) {
  return `adl-practice:${file.name}:${file.size}:${file.lastModified}`
}
