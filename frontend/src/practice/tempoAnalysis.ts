export interface TempoEstimate { bpm: number; confidence: number; analyzedWindows: number }

// At most five 24-second windows spread over the complete track, not just its intro.
function windowStarts(length: number, sampleRate: number): number[] {
  const size = Math.round(sampleRate * 24)
  const count = Math.min(5, Math.ceil(length / size))
  if (count <= 1) return [0]
  return Array.from({ length: count }, (_, i) => Math.round(i * (length - size) / (count - 1)))
}

function fft(real: Float64Array, imaginary: Float64Array) {
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
function meanPower(samples: Float32Array): number {
  let energy = 0
  for (const sample of samples) {
    if (!Number.isFinite(sample)) return NaN
    energy += sample * sample
  }
  return energy / samples.length
}

function estimateWindow(samples: Float32Array, sampleRate: number, power: number): Omit<TempoEstimate, 'analyzedWindows'> | null {
  const size = 1024, hop = Math.max(32, Math.round(sampleRate / 100))
  const frames = Math.floor((samples.length - size) / hop)
  if (frames < 600) return null
  if (!Number.isFinite(power) || power < 1e-7) return null
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
  if (norm < 1e-5 || peaks < 6) return null
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
    if (correlations[lag] >= .18) candidates.push({ lag, score: score(lag) })
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (!best || best.score <= 0) return null
  const bestLag = best.lag, bestPeriod = refinedLag(bestLag)
  // Half/double-time is a conventional metrical alternative; unrelated or
  // three-beat-cycle candidates with nearly equal support are not certainty.
  if (candidates.slice(1).some(candidate => {
    if (candidate.score < best.score * .95) return false
    const period = refinedLag(candidate.lag)
    const ratio = Math.max(period, bestPeriod) / Math.min(period, bestPeriod)
    return ratio > 1.03 && Math.abs(ratio - 2) / 2 > .03
  })) return null
  const rawBpm = 60 * fps / refinedLag(bestLag)
  if (rawBpm < 39 || rawBpm > 245) return null
  return { bpm: Math.round(Math.max(40, Math.min(240, rawBpm)) * 10) / 10, confidence: Math.min(1, correlations[bestLag]) }
}

export function estimateTempo(samples: Float32Array, sampleRate: number): TempoEstimate | null {
  if (!Number.isFinite(sampleRate) || sampleRate < 1000 || samples.length / sampleRate < 8) return null
  const audibleWindows = windowStarts(samples.length, sampleRate)
    .map(start => samples.subarray(start, start + Math.round(sampleRate * 24)))
    .map(data => ({ data, power: meanPower(data) }))
    // Silence may be a long intro, but failed audible/invalid windows must
    // remain in the denominator rather than disappear as "no evidence".
    .filter(window => !Number.isFinite(window.power) || window.power >= 1e-7)
  const estimates = audibleWindows
    .map(window => estimateWindow(window.data, sampleRate, window.power))
    .filter((value): value is Omit<TempoEstimate, 'analyzedWindows'> => value !== null)
  if (!estimates.length) return null
  let group: typeof estimates = []
  for (const candidate of estimates) {
    const matches = estimates.filter(value => Math.abs(value.bpm - candidate.bpm) / candidate.bpm < .03)
    if (matches.length > group.length) group = matches
  }
  // Different song sections cannot safely share one fixed eight-beat division.
  if (group.length / audibleWindows.length < .6) return null
  group.sort((a, b) => a.bpm - b.bpm)
  const bpm = group[Math.floor(group.length / 2)].bpm
  const confidence = group.reduce((sum, value) => sum + value.confidence, 0) / group.length * group.length / audibleWindows.length
  if (confidence < .2) return null
  return { bpm, confidence, analyzedWindows: estimates.length }
}

export async function analyzeVideoTempo(file: File, signal: AbortSignal): Promise<TempoEstimate | null> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  if (file.size > 150 * 1024 * 1024) throw new Error('large-file')
  const context = new AudioContext({ sampleRate: 22050 })
  let worker: Worker | undefined
  let cancel = () => {}
  let timeout: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => reject(new DOMException('Cancelled', 'AbortError'))
    timeout = setTimeout(() => reject(new Error('analysis-timeout')), 20000)
    signal.addEventListener('abort', cancel, { once: true })
  })
  const bounded = <T,>(operation: Promise<T>) => Promise.race([operation, deadline])
  try {
    const bytes = await bounded(file.arrayBuffer())
    let audio: AudioBuffer
    try { audio = await bounded(context.decodeAudioData(bytes)) }
    catch (failure) {
      if (signal.aborted || (failure instanceof Error && failure.message === 'analysis-timeout')) throw failure
      throw new Error('unsupported-audio')
    }
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
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
    const data = audio.getChannelData(selectedChannel)
    starts.forEach((start, index) => mono.set(data.subarray(start, start + size), index * size))
    return await bounded(new Promise<TempoEstimate | null>((resolve, reject) => {
      worker = new Worker(new URL('./tempo.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<TempoEstimate | null>) => resolve(event.data)
      worker.onerror = () => reject(new Error('analysis-failed'))
      worker.postMessage({ samples: mono, sampleRate: audio.sampleRate }, [mono.buffer])
    }))
  } finally {
    clearTimeout(timeout!)
    signal.removeEventListener('abort', cancel)
    worker?.terminate()
    await context.close()
  }
}
