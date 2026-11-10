import type { CountWord } from '../beats/grid.ts'
import type { VoiceSet } from './countVoice.ts'

export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const frames = channels[0]?.length ?? 0, count = channels.length
  const out = new DataView(new ArrayBuffer(44 + frames * count * 2))
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) out.setUint8(offset + i, text.charCodeAt(i)) }
  write(0, 'RIFF'); out.setUint32(4, 36 + frames * count * 2, true); write(8, 'WAVEfmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, count, true); out.setUint32(24, sampleRate, true)
  out.setUint32(28, sampleRate * count * 2, true); out.setUint16(32, count * 2, true); out.setUint16(34, 16, true); write(36, 'data'); out.setUint32(40, frames * count * 2, true)
  let offset = 44
  for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) {
    const sample = Math.max(-1, Math.min(1, channels[c][i]))
    out.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2
  }
  return new Uint8Array(out.buffer)
}

export interface RenderEntry { /** Seconds on the output timeline when the *sample starts*. */ start: number; word: CountWord }

/** Renders count samples at their start times with an OfflineAudioContext (same voices as live playback). */
export async function renderCountTrack(entries: RenderEntry[], voice: VoiceSet, seconds: number, volume = 1, sampleRate = 44100): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate)
  const master = offline.createGain(); master.gain.value = volume; master.connect(offline.destination)
  entries.forEach((entry, i) => {
    if (entry.start < 0 || entry.start >= seconds) return
    const source = offline.createBufferSource(); source.buffer = voice[entry.word].buffer
    const gain = offline.createGain(); source.connect(gain); gain.connect(master)
    // Same short fade-out as live playback so a count never rings into the next one.
    const next = entries[i + 1]
    if (next && next.start - entry.start < voice[entry.word].buffer.duration) { gain.gain.setValueAtTime(1, next.start); gain.gain.linearRampToValueAtTime(0, next.start + 0.015) }
    source.start(entry.start)
  })
  return offline.startRendering()
}

export const wavBlob = (buffer: AudioBuffer) => new Blob([encodeWav([buffer.getChannelData(0)], buffer.sampleRate) as BlobPart], { type: 'audio/wav' })
