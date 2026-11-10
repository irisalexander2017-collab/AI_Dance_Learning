import { realDelay, planCountEvents, type BeatGrid, type CountEvent, type CountWord } from '../beats/grid.ts'

/** Maps video (media) time to the Web Audio clock so counts can be scheduled ahead of time. */
export class MediaClock {
  anchorMedia = 0
  anchorCtx = 0
  rate = 1
  ready = false

  /** Feed the latest video reading. Returns true when it was a jump (seek, rate change, stall) that invalidates schedules. */
  sync(mediaTime: number, ctxTime: number, rate: number, jumpThreshold = 0.1): boolean {
    if (!this.ready || rate !== this.rate) { this.reset(mediaTime, ctxTime, rate); return true }
    const error = mediaTime - this.mediaAt(ctxTime)
    if (Math.abs(error) > jumpThreshold) { this.reset(mediaTime, ctxTime, rate); return true }
    // Small differences are reading jitter of video.currentTime: follow them slowly instead of chasing every frame.
    this.anchorMedia += error * 0.08
    return false
  }
  reset(mediaTime: number, ctxTime: number, rate: number) { this.anchorMedia = mediaTime; this.anchorCtx = ctxTime; this.rate = rate; this.ready = true }
  invalidate() { this.ready = false }
  mediaAt(ctxTime: number) { return this.anchorMedia + (ctxTime - this.anchorCtx) * this.rate }
  ctxAt(mediaTime: number) { return this.anchorCtx + realDelay(mediaTime, this.anchorMedia, this.rate) }
}

export interface ScheduledCount extends CountEvent {
  /** Audio-clock time at which the count is *heard* (its perceptual onset). */
  ctxHit: number
  /** Audio-clock time at which the sample must start so that its onset lands on ctxHit. */
  ctxStart: number
}

export interface ScheduleOptions {
  /** Seconds from the sample start to its perceptual onset, per word. */
  onset: Partial<Record<CountWord, number>>
  includeAnd: boolean
  /** User calibration (+ = later) minus device output latency, seconds. */
  shift: number
}

/** Every count that must be heard in the audio-clock window [ctxFrom, ctxTo). Pure, so it can be unit-tested. */
export function scheduleWindow(grid: BeatGrid, clock: Pick<MediaClock, 'mediaAt' | 'ctxAt' | 'rate'>, ctxFrom: number, ctxTo: number, options: ScheduleOptions): ScheduledCount[] {
  const events = planCountEvents(grid, clock.mediaAt(ctxFrom - options.shift) - 0.0001, clock.mediaAt(ctxTo - options.shift), options.includeAnd)
  return events.map(event => {
    const ctxHit = clock.ctxAt(event.mediaTime) + options.shift
    return { ...event, ctxHit, ctxStart: ctxHit - (options.onset[event.word] ?? 0) }
  }).filter(event => event.ctxHit >= ctxFrom && event.ctxHit < ctxTo)
}
