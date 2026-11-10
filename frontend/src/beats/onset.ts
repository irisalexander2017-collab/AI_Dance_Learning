import { fft } from '../practice/tempoAnalysis.ts'

export interface TimedEvent { time: number; strength: number }

/** Multi-band spectral-flux onset peaks for the whole track (100 Hz resolution, strength 0..1).
 *  Used to lock the beat grid's phase to the music, not for tempo estimation. */
export function onsetEvents(samples: Float32Array, sampleRate: number): TimedEvent[] {
  const size = 1024, hop = Math.max(32, Math.round(sampleRate / 100))
  const frames = Math.floor((samples.length - size) / hop)
  if (frames < 100) return []
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
      if (frame > 4) bands[frequency < 220 ? 0 : frequency < 2000 ? 1 : 2][frame] += Math.max(0, power - previous[bin])
      previous[bin] = power
    }
  }
  const onset = new Float32Array(frames)
  for (const data of bands) {
    const sorted = Array.from(data).sort((a, b) => a - b)
    const scale = sorted[Math.floor(frames * .99)]
    if (!(scale > .01)) continue
    const mean = data.reduce((a, b) => a + b, 0) / frames
    for (let i = 0; i < frames; i++) onset[i] += Math.min(2, Math.max(0, data[i] - mean * .8) / scale) / bands.length
  }
  const fps = sampleRate / hop
  const peak = onset.reduce((m, v) => Math.max(m, v), 0)
  if (peak <= 0) return []
  const events: TimedEvent[] = []
  for (let i = 1; i < frames - 1; i++) {
    if (onset[i] < peak * .25 || onset[i] <= onset[i - 1] || onset[i] < onset[i + 1]) continue
    const l = onset[i - 1], c = onset[i], r = onset[i + 1], d = l - 2 * c + r
    const shift = d < 0 ? Math.max(-.5, Math.min(.5, .5 * (l - r) / d)) : 0
    // The spectral window is centred size/2 samples after its first sample.
    events.push({ time: (i + shift) / fps + size / 2 / sampleRate, strength: Math.min(1, c / peak) })
  }
  return events
}
