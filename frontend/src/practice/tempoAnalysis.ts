import type { AudioAnalysis } from '../beats/audioAnalysis.ts'
export interface TempoEstimate { bpm: number; confidence: number; analyzedWindows: number }
/** One autocorrelation peak of an analysis window: a possible beat period with its support. */
export interface TempoPeak { bpm: number; score: number; correlation: number }
export interface WindowEstimate extends Omit<TempoEstimate, 'analyzedWindows'> { peaks: TempoPeak[] }

// At most five 24-second windows spread over the complete track, not just its intro.
export function windowStarts(length: number, sampleRate: number): number[] {
  const size = Math.round(sampleRate * 24)
  const count = Math.min(5, Math.ceil(length / size))
  if (count <= 1) return [0]
  return Array.from({ length: count }, (_, i) => Math.round(i * (length - size) / (count - 1)))
}

export function fft(real: Float64Array, imaginary: Float64Array) {
  const size = real.length
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1
    while (j & bit) { j ^= bit; bit >>= 1 }
    j ^= bit
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]]
      ;[imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length, wr = Math.cos(angle), wi = Math.sin(angle)
    for (let start = 0; start < size; start += length) {
      let r = 1, im = 0
      for (let j = 0; j < length / 2; j++) {
        const a = start + j, b = a + length / 2
        const tr = r * real[b] - im * imaginary[b], ti = r * imaginary[b] + im * real[b]
        real[b] = real[a] - tr; imaginary[b] = imaginary[a] - ti
        real[a] += tr; imaginary[a] += ti
        const next = r * wr - im * wi
        im = r * wi + im * wr; r = next
      }
    }
  }
}

// Positive changes in log-power spectra separate percussion attacks from sustained notes.
// This uses the spectral-flux principle; it is not a port of librosa or an AI model.
export function meanPower(samples: Float32Array): number {
  let energy = 0
  for (const sample of samples) {
    if (!Number.isFinite(sample)) return NaN
    energy += sample * sample
  }
  return energy / samples.length
}

export function estimateWindow(samples: Float32Array, sampleRate: number, power: number, relaxed = false): WindowEstimate | null {
  const size = 1024, hop = Math.max(32, Math.round(sampleRate / 100))
  const frames = Math.floor((samples.length - size) / hop)
  if (frames < 600) return null
  if (!Number.isFinite(power) || power < 1e-8) return null
  const bands = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)]
  const previous = new Float64Array(size / 2), real = new Float64Array(size), imaginary = new Float64Array(size)
  const hann = Float64Array.from({ length: size }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (size - 1)))
  for (let frame = 0; frame < frames; frame++) {
    for (let j = 0; j < size; j++) { real[j] = samples[frame * hop + j] * hann[j]; imaginary[j] = 0 }
    fft(real, imaginary)
    for (let bin = 2; bin < size / 2; bin++) {
      const frequency = bin * sampleRate / size
      if (frequency > 8000) break
      const power = Math.log1p(real[bin] * real[bin] + imaginary[bin] * imaginary[bin])
      const delta = Math.max(0, power - previous[bin])
      if (frame > 4) bands[frequency < 220 ? 0 : frequency < 2000 ? 1 : 2][frame] += delta
      previous[bin] = power
    }
  }
  const onset = new Float32Array(frames)
  for (let band = 0; band < bands.length; band++) {
    const data = bands[band]
    const sorted = Array.from(data).sort((a, b) => a - b)
    const scale = sorted[Math.floor(frames * .99)]
    if (scale < .01) continue
    const mean = data.reduce((a, b) => a + b, 0) / frames
    // Each normalized band gets an equal vote: a slow bass motif must not
    // override a consistent beat carried by the rest of the spectrum.
    const weight = 1 / bands.length
    for (let i = 0; i < frames; i++) onset[i] += weight * Math.min(2, Math.max(0, data[i] - mean * .8) / scale)
  }
  let norm = 0, peak = 0, peaks = 0
  const meanOnset = onset.reduce((sum, value) => sum + value, 0) / frames
  const centered = Float32Array.from(onset, value => value - meanOnset)
  for (let i = 0; i < frames; i++) { norm += centered[i] * centered[i]; peak = Math.max(peak, onset[i]) }
  for (let i = 1; i < frames - 1; i++) if (onset[i] > peak * .2 && onset[i] > onset[i - 1] && onset[i] >= onset[i + 1]) peaks++
  if (norm < 1e-5 || peaks < 4) return null
  const intervals: { distance: number; weight: number }[] = []
  let previousPeak = -1
  for (let i = 1; i < frames - 1; i++) {
    if (onset[i] < peak * .4 || onset[i] <= onset[i - 1] || onset[i] < onset[i + 1]) continue
    if (previousPeak >= 0 && i - previousPeak < sampleRate / hop * .12) continue
    if (previousPeak >= 0) intervals.push({ distance: i - previousPeak, weight: Math.min(onset[i], onset[previousPeak]) })
    previousPeak = i
  }
  const intervalWeight = intervals.reduce((sum, item) => sum + item.weight, 0)
  const fps = sampleRate / hop
  const maxLag = Math.ceil(fps * 1.5)
  const correlations = new Float64Array(maxLag * 3 + 3)
  for (let lag = 1; lag < correlations.length; lag++) {
    let sum = 0
    for (let i = lag; i < frames; i++) sum += centered[i] * centered[i - lag]
    correlations[lag] = sum / norm
  }
  const refinedLag = (lag: number) => {
    const left = correlations[lag - 1], center = correlations[lag], right = correlations[lag + 1]
    const denominator = left - 2 * center + right
    return lag + (denominator < 0 ? Math.max(-.5, Math.min(.5, .5 * (left - right) / denominator)) : 0)
  }
  const at = (lag: number) => {
    const lower = Math.floor(lag), fraction = lag - lower
    return correlations[lower] * (1 - fraction) + correlations[lower + 1] * fraction
  }
  const score = (lag: number) => {
    // Harmonic support favors a real beat interval over isolated subdivision peaks.
    const refined = refinedLag(lag)
    const peakCorrelation = correlations[lag] + .25 * (correlations[lag + 1] - correlations[lag - 1]) * (refined - lag)
    const value = peakCorrelation + .35 * at(refined * 2) + .15 * at(refined * 3)
    const directSupport = intervals.reduce((sum, item) => sum + (Math.abs(item.distance - refined) <= Math.max(2, refined * .06) ? item.weight : 0), 0) / (intervalWeight || 1)
    return value * (1 - refined / frames) + .3 * directSupport
  }
  const candidates: { lag: number; score: number }[] = []
  for (let lag = Math.floor(fps / 4); lag <= maxLag; lag++) {
    if (correlations[lag] <= correlations[lag - 1] || correlations[lag] < correlations[lag + 1]) continue
    if (correlations[lag] >= .08) candidates.push({ lag, score: score(lag) })
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (!best || best.score <= 0) return null
  const bestLag = best.lag, bestPeriod = refinedLag(bestLag)
  // Half/double-time is a conventional metrical alternative; unrelated or
  // three-beat-cycle candidates with nearly equal support are not certainty.
  const peaksOut: TempoPeak[] = candidates.slice(0, 8).map(candidate => ({ bpm: 60 * fps / refinedLag(candidate.lag), score: candidate.score, correlation: correlations[candidate.lag] }))
  if (!relaxed && candidates.slice(1).some(candidate => {
    if (candidate.score < best.score * .98) return false
    const period = refinedLag(candidate.lag)
    const ratio = Math.max(period, bestPeriod) / Math.min(period, bestPeriod)
    return ratio > 1.03 && Math.abs(ratio - 2) / 2 > .03
  })) return null
  const rawBpm = 60 * fps / refinedLag(bestLag)
  if (rawBpm < 39 || rawBpm > 245) return null
  return { bpm: Math.round(Math.max(40, Math.min(240, rawBpm)) * 10) / 10, confidence: Math.min(1, correlations[bestLag]), peaks: peaksOut }
}

export function estimateTempo(samples: Float32Array, sampleRate: number): TempoEstimate | null {
  if (!Number.isFinite(sampleRate) || sampleRate < 1000 || samples.length / sampleRate < 8) return null
  // Drop near-silent windows (long intros) from the agreement denominator so they do not force "未识别".
  const audibleWindows = windowStarts(samples.length, sampleRate)
    .map(start => samples.subarray(start, start + Math.round(sampleRate * 24)))
    .map(data => ({ data, power: meanPower(data) }))
    .filter(window => Number.isFinite(window.power) && window.power >= 1e-8)
  if (!audibleWindows.length) return null
  // Softened vs the old .4 share / .12 confidence, but keep non-octave veto (relaxed=false)
  // so nearly-tied unrelated tempi are not auto-adopted — analyzeAudioSamples still lists suggestions.
  const estimates = audibleWindows
    .map(window => estimateWindow(window.data, sampleRate, window.power, false))
    .filter((value): value is WindowEstimate => value !== null)
  if (!estimates.length) return null
  let group: typeof estimates = []
  for (const candidate of estimates) {
    const matches = estimates.filter(value => Math.abs(value.bpm - candidate.bpm) / candidate.bpm < .05)
    if (matches.length > group.length) group = matches
  }
  // Soft plurality (~1/3). A single window may carry a short clip (≤2 audible windows), not a long mixed one.
  const share = group.length / audibleWindows.length
  if (share < .34 && !(group.length >= 1 && audibleWindows.length <= 2 && group[0].confidence >= .18)) return null
  group.sort((a, b) => a.bpm - b.bpm)
  const bpm = group[Math.floor(group.length / 2)].bpm
  const confidence = group.reduce((sum, value) => sum + value.confidence, 0) / group.length * Math.min(1, share / .34)
  if (confidence < .08) return null
  return { bpm, confidence, analyzedWindows: estimates.length }
}

export async function analyzeVideoTempo(file: File, signal: AbortSignal): Promise<TempoEstimate | null> {
  return (await analyzeVideoAudio(file, signal)).legacy
}

/** When decodeAudioData rejects a playable container, capture via a media element into Web Audio.
 *  Hardened for iOS Safari: resume AudioContext, keep a user-gesture-friendly play(), avoid false silent/timeout kills. */
async function decodeViaMediaElement(file: File, sampleRate: number, signal: AbortSignal): Promise<AudioBuffer> {
  if (typeof document === 'undefined') throw new Error('unsupported-audio')
  const url = URL.createObjectURL(file)
  const media = document.createElement('video')
  media.preload = 'auto'
  media.playsInline = true
  media.setAttribute('playsinline', '')
  media.setAttribute('webkit-playsinline', '')
  media.muted = false
  // Tiny audible volume so WebKit still feeds MediaElementSource; destination gain stays near silent.
  media.volume = 0.01
  media.crossOrigin = 'anonymous'
  media.src = url
  const capture = new AudioContext({ sampleRate })
  const cleanupListeners: Array<() => void> = []
  const onAbort = (reject: (reason?: unknown) => void) => {
    const handler = () => reject(new DOMException('Cancelled', 'AbortError'))
    signal.addEventListener('abort', handler, { once: true })
    cleanupListeners.push(() => signal.removeEventListener('abort', handler))
  }
  try {
    if (capture.state === 'suspended') {
      try { await capture.resume() } catch { /* gesture may still unlock on play() */ }
    }
    await new Promise<void>((resolve, reject) => {
      onAbort(reject)
      if (media.readyState >= 1) { resolve(); return }
      media.onloadedmetadata = () => resolve()
      media.onerror = () => reject(new Error('unsupported-audio'))
      // Some WebKit builds only fire canplay / loadeddata.
      media.onloadeddata = () => { if (Number.isFinite(media.duration)) resolve() }
      try { media.load() } catch { /* ignore */ }
    })
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (!Number.isFinite(media.duration) || media.duration < 8) throw new Error('too-short')
    if (capture.state === 'suspended') {
      try { await capture.resume() } catch { /* play() below often unlocks */ }
    }
    const source = capture.createMediaElementSource(media)
    const chunks: Float32Array[] = []
    const processor = capture.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0)
      // Copy eagerly — WebKit may reuse the underlying buffer.
      chunks.push(new Float32Array(input))
    }
    // Keep destination slightly open so Safari does not drop the capture graph as "silent sink".
    const mute = capture.createGain(); mute.gain.value = 0.00001
    source.connect(processor); processor.connect(mute); mute.connect(capture.destination)
    // Cap rate: iOS often stalls or delivers empty buffers above ~2–4×.
    media.playbackRate = 2
    try {
      const playPromise = media.play()
      if (playPromise) await playPromise
    } catch {
      // One more unlock attempt after a failed autoplay (still within import gesture when possible).
      if (capture.state === 'suspended') await capture.resume().catch(() => undefined)
      media.muted = true
      try {
        const retry = media.play()
        if (retry) await retry
      } catch {
        throw new Error('unsupported-audio')
      }
      media.muted = false
    }
    if (capture.state === 'suspended') await capture.resume().catch(() => undefined)
    const captureTimeoutMs = Math.min(120_000, Math.max(45_000, media.duration * 1000 / Math.max(1, media.playbackRate) + 15_000))
    await new Promise<void>((resolve, reject) => {
      onAbort(reject)
      const timer = setTimeout(() => reject(new Error('analysis-timeout')), captureTimeoutMs)
      cleanupListeners.push(() => clearTimeout(timer))
      media.onended = () => { clearTimeout(timer); resolve() }
      media.onerror = () => { clearTimeout(timer); reject(new Error('unsupported-audio')) }
      // If playhead stalls near the end with enough samples, treat as done (iOS sometimes skips ended).
      const stall = setInterval(() => {
        if (signal.aborted) return
        const length = chunks.reduce((n, c) => n + c.length, 0)
        if (length >= capture.sampleRate * 8 && media.currentTime > 0 && media.paused && media.ended) {
          clearTimeout(timer); clearInterval(stall); resolve()
        }
      }, 500)
      cleanupListeners.push(() => clearInterval(stall))
    })
    try { processor.disconnect() } catch { /* */ }
    try { source.disconnect() } catch { /* */ }
    try { mute.disconnect() } catch { /* */ }
    const length = chunks.reduce((n, chunk) => n + chunk.length, 0)
    if (length < capture.sampleRate * 8) throw new Error('too-short')
    const buffer = capture.createBuffer(1, length, capture.sampleRate)
    const channel = buffer.getChannelData(0)
    let offset = 0
    for (const chunk of chunks) { channel.set(chunk, offset); offset += chunk.length }
    // Energy check uses a lenient floor — ScriptProcessor on iOS can under-report peaks.
    let energy = 0
    const step = Math.max(1, Math.floor(channel.length / 200_000))
    for (let i = 0; i < channel.length; i += step) energy += channel[i] * channel[i]
    const mean = energy / Math.max(1, Math.ceil(channel.length / step))
    if (!(mean > 1e-14) && !(energy > 1e-10)) throw new Error('silent-audio')
    return buffer
  } finally {
    for (const stop of cleanupListeners) try { stop() } catch { /* */ }
    try { media.pause() } catch { /* */ }
    URL.revokeObjectURL(url)
    media.removeAttribute('src'); media.load()
    await capture.close().catch(() => undefined)
  }
}

export async function analyzeVideoAudio(file: File, signal: AbortSignal): Promise<AudioAnalysis> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  if (file.size > 250 * 1024 * 1024) throw new Error('large-file')
  const context = new AudioContext({ sampleRate: 22050 })
  let worker: Worker | undefined
  let cancel = () => {}
  let timeout: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => reject(new DOMException('Cancelled', 'AbortError'))
    timeout = setTimeout(() => reject(new Error('analysis-timeout')), 40000)
    signal.addEventListener('abort', cancel, { once: true })
  })
  const bounded = <T,>(operation: Promise<T>) => Promise.race([operation, deadline])
  try {
    const bytes = await bounded(file.arrayBuffer())
    let audio: AudioBuffer
    try { audio = await bounded(context.decodeAudioData(bytes.slice(0))) }
    catch (failure) {
      if (signal.aborted || (failure instanceof Error && failure.message === 'analysis-timeout')) throw failure
      // Browser can often *play* a file it refuses to decodeAudioData (HEVC/odd AAC packaging).
      try { audio = await bounded(decodeViaMediaElement(file, 22050, signal)) }
      catch (fallback) {
        if (signal.aborted || (fallback instanceof Error && (fallback.message === 'analysis-timeout' || fallback.message === 'too-short' || fallback.message === 'silent-audio'))) throw fallback
        throw new Error('unsupported-audio')
      }
    }
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (audio.duration < 8) throw new Error('too-short')
    const size = Math.min(audio.length, Math.round(audio.sampleRate * 24))
    const starts = windowStarts(audio.length, audio.sampleRate)
    const mono = new Float32Array(size * starts.length)
    // Selecting a channel avoids cancelling out phase-inverted stereo recordings.
    let selectedChannel = 0, loudest = -1
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const data = audio.getChannelData(channel)
      let energy = 0
      for (const start of starts) for (let i = start; i < start + size; i += 32) energy += data[i] * data[i]
      if (energy > loudest) { loudest = energy; selectedChannel = channel }
    }
    if (!(loudest > 1e-8)) throw new Error('silent-audio')
    const data = audio.getChannelData(selectedChannel)
    starts.forEach((start, index) => mono.set(data.subarray(start, start + size), index * size))
    // Continuous start of the track (max 3 minutes) so onset times keep their real position.
    const full = data.slice(0, Math.min(data.length, Math.round(audio.sampleRate * 180)))
    // Keep copies: transferring buffers to the worker empties them, and we may need a main-thread fallback.
    const monoCopy = mono.slice()
    const fullCopy = full.slice()
    try {
      return await bounded(new Promise<AudioAnalysis>((resolve, reject) => {
        worker = new Worker(new URL('./tempo.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<AudioAnalysis>) => resolve(event.data)
        worker.onerror = () => reject(new Error('analysis-failed'))
        worker.postMessage({ samples: mono, full, sampleRate: audio.sampleRate }, [mono.buffer, full.buffer])
      }))
    } catch (failure) {
      if (signal.aborted || (failure instanceof Error && failure.message === 'analysis-timeout')) throw failure
      // Worker blocked / failed to load: same detector on the main thread (dynamic import avoids a cycle).
      const { analyzeAudioSamples } = await import('../beats/audioAnalysis.ts')
      return analyzeAudioSamples(monoCopy, fullCopy, audio.sampleRate)
    }
  } finally {
    clearTimeout(timeout!)
    signal.removeEventListener('abort', cancel)
    worker?.terminate()
    await context.close()
  }
}
