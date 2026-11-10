import { COUNT_WORDS, type CountWord } from '../beats/grid.ts'

export type VoiceName = 'male' | 'female' | 'male2'
export const VOICE_NAMES: VoiceName[] = ['male', 'female', 'male2']
export const parseVoiceName = (value: unknown): VoiceName => VOICE_NAMES.includes(value as VoiceName) ? value as VoiceName : 'male'
export interface VoiceSample { buffer: AudioBuffer; onset: number }
export type VoiceSet = Record<CountWord, VoiceSample>
const WORDS: CountWord[] = [...COUNT_WORDS, 'and']

/** Pre-rendered offline-TTS samples (public/count-voice). Nothing is synthesised at runtime. */
export async function loadCountVoice(context: BaseAudioContext, voice: VoiceName, base = import.meta.env.BASE_URL): Promise<VoiceSet> {
  const root = `${base}count-voice`
  const manifest = await (await fetch(`${root}/manifest.json`)).json() as Record<VoiceName, Record<CountWord, { duration: number; anchor: number }>>
  const entries = await Promise.all(WORDS.map(async word => {
    const response = await fetch(`${root}/${voice}/${word}.wav`)
    if (!response.ok) throw new Error(`count-voice-${word}`)
    const buffer = await context.decodeAudioData(await response.arrayBuffer())
    return [word, { buffer, onset: manifest[voice]?.[word]?.anchor ?? 0 }] as const
  }))
  return Object.fromEntries(entries) as VoiceSet
}

export const onsetTable = (voice: VoiceSet) => Object.fromEntries(Object.entries(voice).map(([word, sample]) => [word, sample.onset])) as Record<CountWord, number>
