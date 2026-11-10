/**
 * External soundtrack helpers: onset-flux envelopes + cross-correlation offset guess.
 * Offset convention used by the player: external.currentTime = video.currentTime - offsetSeconds.
 * Positive offset → play earlier in the uploaded file (video timeline starts later relative to the track).
 */

export const EXTERNAL_AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'm4a', 'ogg'] as const
export const EXTERNAL_AUDIO_ACCEPT = 'audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.aac,.m4a,.ogg'

export function isExternalAudioFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if ((EXTERNAL_AUDIO_EXTENSIONS as readonly string[]).includes(extension)) return true
  return file.type.startsWith('audio/')
}

/** Half-wave rectified energy flux at `fps` frames/sec (default 50). Cheap stand-in for onset envelope. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number, fps = 50): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate / fps))
  const frames = Math.floor(samples.length / hop)
  if (frames < 2) return new Float32Array(0)
  const energy = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    const start = i * hop
    const end = start + hop
    for (let j = start; j < end; j++) sum += samples[j]! * samples[j]!
    energy[i] = Math.sqrt(sum / hop)
  }
  const flux = new Float32Array(frames)
  for (let i = 1; i < frames; i++) flux[i] = Math.max(0, energy[i]! - energy[i - 1]!)
  // Soft peak normalize so quiet/loud pairs still correlate.
  let peak = 0
  for (let i = 0; i < frames; i++) if (flux[i]! > peak) peak = flux[i]!
  if (peak > 0) for (let i = 0; i < frames; i++) flux[i]! /= peak
  return flux
}

export interface OffsetGuess {
  /** Seconds for external.currentTime = video.currentTime - offsetSeconds */
  offsetSeconds: number
  /** Normalized peak correlation in roughly [-1, 1] (0 when envelopes are empty). */
  score: number
  fps: number
}

/**
 * Cross-correlate two onset envelopes. Positive lag means the external track's content
 * appears later on the video timeline → positive offsetSeconds in the player convention.
 */
export function estimateAudioOffset(
  videoEnvelope: Float32Array,
  externalEnvelope: Float32Array,
  fps: number,
  maxLagSeconds = 30,
): OffsetGuess {
  if (!videoEnvelope.length || !externalEnvelope.length || !(fps > 0)) {
    return { offsetSeconds: 0, score: 0, fps }
  }
  const maxLag = Math.min(
    Math.floor(maxLagSeconds * fps),
    videoEnvelope.length - 1,
    externalEnvelope.length - 1,
  )
  if (maxLag < 1) return { offsetSeconds: 0, score: 0, fps }

  let bestLag = 0
  let bestScore = -Infinity
  let energyA = 0
  for (let i = 0; i < videoEnvelope.length; i++) energyA += videoEnvelope[i]! * videoEnvelope[i]!
  let energyB = 0
  for (let i = 0; i < externalEnvelope.length; i++) energyB += externalEnvelope[i]! * externalEnvelope[i]!
  const denom = Math.sqrt(energyA * energyB) || 1

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sum = 0
    // video[i] vs external[i - lag]  ⇒  lag>0: external is delayed relative to video content match
    const i0 = Math.max(0, lag)
    const i1 = Math.min(videoEnvelope.length, externalEnvelope.length + lag)
    for (let i = i0; i < i1; i++) sum += videoEnvelope[i]! * externalEnvelope[i - lag]!
    const score = sum / denom
    if (score > bestScore) { bestScore = score; bestLag = lag }
  }
  return {
    offsetSeconds: Math.round((bestLag / fps) * 1000) / 1000,
    score: Number.isFinite(bestScore) ? bestScore : 0,
    fps,
  }
}

/** Pick loudest channel and optionally truncate to `maxSeconds` from the start. */
export function monoFromBuffer(buffer: AudioBuffer, maxSeconds = 90): Float32Array {
  const length = Math.min(buffer.length, Math.max(1, Math.round(buffer.sampleRate * maxSeconds)))
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice(0, length)
  let best = 0
  let bestEnergy = -1
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    let energy = 0
    for (let i = 0; i < length; i += 32) energy += data[i]! * data[i]!
    if (energy > bestEnergy) { bestEnergy = energy; best = c }
  }
  return buffer.getChannelData(best).slice(0, length)
}

/** Decode a local File/Blob to mono PCM for alignment (browser AudioContext). */
export async function decodeMonoPcm(file: Blob, sampleRate = 22050, maxSeconds = 90): Promise<{ samples: Float32Array; sampleRate: number }> {
  const context = new AudioContext({ sampleRate })
  try {
    const bytes = await file.arrayBuffer()
    const audio = await context.decodeAudioData(bytes.slice(0))
    return { samples: monoFromBuffer(audio, maxSeconds), sampleRate: audio.sampleRate }
  } finally {
    await context.close().catch(() => undefined)
  }
}

/** Guess offset between a video file's soundtrack and an uploaded audio file. */
export async function guessOffsetBetweenFiles(videoFile: Blob, audioFile: Blob, maxLagSeconds = 30): Promise<OffsetGuess> {
  const fps = 50
  const [video, audio] = await Promise.all([
    decodeMonoPcm(videoFile),
    decodeMonoPcm(audioFile),
  ])
  // Resample envelopes to a shared fps based on each buffer's native rate.
  const videoEnv = onsetEnvelope(video.samples, video.sampleRate, fps)
  const audioEnv = onsetEnvelope(audio.samples, audio.sampleRate, fps)
  return estimateAudioOffset(videoEnv, audioEnv, fps, maxLagSeconds)
}

/** Map video media time → external media time for a given offset. */
export function externalTimeAt(videoTime: number, offsetSeconds: number): number {
  return videoTime - offsetSeconds
}
