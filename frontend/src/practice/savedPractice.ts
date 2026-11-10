import type { PracticeRangeMode } from './beatTimeline'
import { normalizeCuts, type SegmentMode } from './customSegments.ts'

/** Where the stored BPM came from: filename catalog, embedded file tag, audio onset analysis or the user. */
export type TempoSource = 'matched' | 'tag' | 'onset' | 'manual' | 'unset'

export interface SavedPracticeState {
  schemaVersion: 2
  bpm: number
  tempoMode: 'auto' | 'manual' | 'unset'
  firstBeatTime: number | null
  firstBeatConfirmed: boolean
  rawFormalStartTime: number | null
  formalStartTime: number | null
  formalStartLabel: string
  currentSegmentIndex: number
  rangeMode: PracticeRangeMode
  playbackMode: 'loop' | 'continuous'
  boundaryOffsets: number[]
  /** Added in the count-voice update; absent in older saves. The two segmentations are stored independently. */
  tempoSource: TempoSource
  segmentMode: SegmentMode
  customCuts: number[]
}
export function normalizePracticeState(value: unknown): SavedPracticeState {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
  const firstBeatTime = time(stored.firstBeatTime)
  const formalStart = time(stored.formalStartTime)
  const formalStartTime = formalStart !== null && (firstBeatTime === null || formalStart >= firstBeatTime) ? formalStart : null
  const validBpm = typeof stored.bpm === 'number' && Number.isFinite(stored.bpm) && stored.bpm >= 40 && stored.bpm <= 240
  const bpm = validBpm ? stored.bpm as number : 100
  return {
    schemaVersion: 2, bpm,
    tempoMode: validBpm && stored.tempoMode === 'auto' ? 'auto' : validBpm && (stored.tempoMode === 'manual' || (stored.tempoMode === undefined && bpm !== 100)) ? 'manual' : 'unset',
    firstBeatTime,
    firstBeatConfirmed: firstBeatTime !== null && stored.firstBeatConfirmed !== false,
    rawFormalStartTime: time(stored.rawFormalStartTime),
    formalStartTime,
    formalStartLabel: typeof stored.formalStartLabel === 'string' ? stored.formalStartLabel : '',
    currentSegmentIndex: typeof stored.currentSegmentIndex === 'number' && Number.isFinite(stored.currentSegmentIndex) ? Math.max(0, Math.floor(stored.currentSegmentIndex)) : 0,
    rangeMode: stored.rangeMode === 'from-start' ? 'from-start' : 'current',
    playbackMode: stored.playbackMode === 'continuous' ? 'continuous' : 'loop',
    boundaryOffsets: Array.isArray(stored.boundaryOffsets) ? stored.boundaryOffsets.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) : [],
    tempoSource: stored.tempoSource === 'matched' || stored.tempoSource === 'tag' || stored.tempoSource === 'onset' || stored.tempoSource === 'manual' ? stored.tempoSource : 'unset',
    segmentMode: stored.segmentMode === 'custom' ? 'custom' : 'beats',
    customCuts: Array.isArray(stored.customCuts) ? normalizeCuts(stored.customCuts.filter((value): value is number => typeof value === 'number'), 0) : [],
  }
}
