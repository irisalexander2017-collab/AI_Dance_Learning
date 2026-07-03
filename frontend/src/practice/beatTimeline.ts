export type PracticeRangeMode = 'current' | 'previous-current' | 'from-start' | 'full'

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

export function getPracticeRange(
  mode: PracticeRangeMode,
  segments: LearningSegment[],
  currentIndex: number,
  duration: number,
): PracticeRange {
  if (mode === 'full' || segments.length === 0) return { startTime: 0, endTime: duration }
  const safeIndex = Math.min(Math.max(0, currentIndex), segments.length - 1)
  const current = segments[safeIndex]
  if (mode === 'previous-current') return { startTime: segments[Math.max(0, safeIndex - 1)].startTime, endTime: current.endTime }
  if (mode === 'from-start') return { startTime: segments[0].startTime, endTime: current.endTime }
  return { startTime: current.startTime, endTime: current.endTime }
}

export function videoStorageKey(file: Pick<File, 'name' | 'size' | 'lastModified'>) {
  return `adl-practice:${file.name}:${file.size}:${file.lastModified}`
}
