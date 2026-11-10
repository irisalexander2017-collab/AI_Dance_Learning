import type { BeatGrid, CountWord } from '../beats/grid.ts'
import { MediaClock, scheduleWindow, type ScheduledCount } from './clock.ts'
import { onsetTable, type VoiceSet } from './countVoice.ts'

export interface CountLogEntry {
  index: number; label: string; word: CountWord; mediaTime: number
  /** Audio-clock time the sample was started at / is heard at. */
  ctxStart: number; ctxHit: number; ctxNow: number; rate: number; wall: number
  /** Set when the sample was dropped before it sounded (seek, pause, grid edit). */
  cancelled?: boolean
}
declare global { interface Window { __countLog?: CountLogEntry[]; __countExport?: () => string } }

export interface SchedulerHandles {
  video: HTMLVideoElement
  getGrid: () => BeatGrid | null
  getPrefs: () => { enabled: boolean; volume: number; andWords: boolean; delayMs: number }
}

const LOOKAHEAD = 0.28
const TICK_MS = 25

/** Lookahead scheduler: counts are queued on the AudioContext clock ahead of time and never go through setTimeout jitter.
 *  Spacing follows the video's media time (so slow motion stretches the gaps); sample playback speed is never changed. */
export class CountScheduler {
  private clock = new MediaClock()
  private timer: number | undefined
  private done = new Set<number>()
  private live: { source: AudioBufferSourceNode; gain: GainNode; end: number; hit: number; entry: CountLogEntry }[] = []
  private voice: VoiceSet | null = null
  /** First video reading after (re)start; the clock is only trusted once currentTime has really advanced. */
  private settleFrom: number | null = null
  readonly master: GainNode
  constructor(readonly context: AudioContext, private handles: SchedulerHandles) {
    this.master = context.createGain(); this.master.connect(context.destination)
    window.__countLog ??= []
    window.__countExport = () => JSON.stringify(window.__countLog)
  }
  setVoice(voice: VoiceSet | null) { this.voice = voice; this.stopAll() }
  start() { if (this.timer === undefined) { this.timer = window.setInterval(() => this.tick(), TICK_MS); this.tick() } }
  stop() { if (this.timer !== undefined) window.clearInterval(this.timer); this.timer = undefined; this.stopAll(); this.clock.invalidate() }
  /** Called on seek / pause / grid edit: forget everything queued. */
  stopAll() {
    const now = this.context.currentTime
    for (const item of this.live) {
      if (item.hit > now) item.entry.cancelled = true
      try { item.gain.gain.cancelScheduledValues(now); item.gain.gain.setValueAtTime(item.gain.gain.value, now); item.gain.gain.linearRampToValueAtTime(0, now + 0.01); item.source.stop(now + 0.012) } catch { /* already ended */ }
    }
    this.live = []; this.done.clear(); this.clock.invalidate(); this.settleFrom = null
  }
  private tick() {
    const { video } = this.handles, prefs = this.handles.getPrefs(), grid = this.handles.getGrid()
    if (!this.voice || !grid || !prefs.enabled || video.paused || video.ended || video.seeking || video.readyState < 2) { if (this.live.length || this.done.size) this.stopAll(); return }
    const now = this.context.currentTime
    if (this.context.state !== 'running') { void this.context.resume().catch(() => undefined); return }
    if (!this.clock.ready) {
      // Right after play()/seek the video reports its start position for a moment before it really runs: wait for motion.
      if (this.settleFrom === null) { this.settleFrom = video.currentTime; return }
      if (Math.abs(video.currentTime - this.settleFrom) < 0.03 * video.playbackRate) return
      this.clock.reset(video.currentTime, now, video.playbackRate)
    } else if (this.clock.sync(video.currentTime, now, video.playbackRate)) { this.stopAll(); return }
    this.master.gain.value = prefs.volume
    const latency = (this.context.outputLatency || 0) + (this.context.baseLatency || 0)
    const events = scheduleWindow(grid, this.clock, now, now + LOOKAHEAD, { onset: onsetTable(this.voice), includeAnd: prefs.andWords, shift: prefs.delayMs / 1000 - latency })
    for (const event of events) if (!this.done.has(event.index)) this.play(event, now)
    this.live = this.live.filter(item => item.end > now)
    if (this.done.size > 256) { const keep = [...this.done].slice(-64); this.done = new Set(keep) }
  }
  private play(event: ScheduledCount, now: number) {
    const sample = this.voice![event.word]
    const when = Math.max(event.ctxStart, now), offset = Math.max(0, now - event.ctxStart)
    this.done.add(event.index)
    // The perceptual hit is already behind us (> 30 ms): skipping it is better than a late, confusing count.
    if (event.ctxHit < now - 0.03 || offset >= sample.buffer.duration) return
    const source = this.context.createBufferSource(); source.buffer = sample.buffer
    const gain = this.context.createGain(); source.connect(gain); gain.connect(this.master)
    const previous = this.live[this.live.length - 1]
    if (previous && previous.end > when) { previous.gain.gain.setValueAtTime(1, when); previous.gain.gain.linearRampToValueAtTime(0, when + 0.015); try { previous.source.stop(when + 0.02) } catch { /* ended */ } }
    source.start(when, offset)
    const log = window.__countLog!
    const entry: CountLogEntry = { index: event.index, label: event.label, word: event.word, mediaTime: event.mediaTime, ctxStart: event.ctxStart, ctxHit: event.ctxHit, ctxNow: now, rate: this.clock.rate, wall: performance.now() }
    this.live.push({ source, gain, end: when + sample.buffer.duration - offset, hit: event.ctxHit, entry })
    log.push(entry)
    if (log.length > 5000) log.splice(0, log.length - 4000)
  }
}
