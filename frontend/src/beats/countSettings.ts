import type { AlignBasis, AnchorMode } from './anchor.ts'

export interface CountSettings {
  version: 2
  anchorMode: AnchorMode
  manualAnchor: number | null
  alignBasis: AlignBasis
  /** true = 跟随老师动作 (number level + extra hits from the teacher's motion), false = fixed "1 & 2 &" at the music tempo. */
  follow: boolean
  /** User ×2/÷2 steps applied to the number-beat level (each step doubles or halves the number tempo). */
  levelShift: number
  /** Manual fine-tuning of "and" points (seconds), keyed by point index (beat·4 + sub). */
  adjust: Record<number, number>
  /** Tempo the adjustments were made for; they are dropped when it changes. */
  adjustBpm: number | null
}
/** Device-wide preferences (not per video). */
export type NativeAudio = 'mute' | 'duck' | 'keep'
export interface CountPrefs { enabled: boolean; overlay: boolean; voice: 'male' | 'female'; volume: number; andWords: boolean; delayMs: number; nativeAudio: NativeAudio }
/** Gain applied to the video's own sound while the count is audible. */
export const NATIVE_AUDIO_GAIN: Record<NativeAudio, number> = { mute: 0, duck: 0.12, keep: 1 }

export const DEFAULT_COUNT_SETTINGS: CountSettings = { version: 2, anchorMode: 'auto', manualAnchor: null, alignBasis: 'both', follow: true, levelShift: 0, adjust: {}, adjustBpm: null }
export const DEFAULT_COUNT_PREFS: CountPrefs = { enabled: false, overlay: false, voice: 'male', volume: 0.9, andWords: true, delayMs: 0, nativeAudio: 'mute' }

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

export function normalizeCountSettings(value: unknown): CountSettings {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const adjust: Record<number, number> = {}
  // v1 keyed "and" fine-tunes by half-beat index; those keys mean something else now, so they are not carried over.
  if (stored.version === 2 && stored.adjust && typeof stored.adjust === 'object') for (const [key, raw] of Object.entries(stored.adjust as Record<string, unknown>)) {
    const index = Number(key), seconds = num(raw)
    if (Number.isInteger(index) && index % 4 !== 0 && seconds !== null && Math.abs(seconds) <= 0.25) adjust[index] = seconds
  }
  const manual = num(stored.manualAnchor)
  const mode: AnchorMode = stored.anchorMode === 'music' || stored.anchorMode === 'dance' || (stored.anchorMode === 'manual' && manual !== null) ? stored.anchorMode : 'auto'
  return {
    version: 2, anchorMode: mode, manualAnchor: manual !== null && manual >= 0 ? manual : null, follow: stored.follow !== false,
    levelShift: Number.isInteger(stored.levelShift) ? Math.min(2, Math.max(-2, stored.levelShift as number)) : 0,
    alignBasis: stored.alignBasis === 'pose' || stored.alignBasis === 'audio' ? stored.alignBasis : 'both',
    adjust, adjustBpm: num(stored.adjustBpm),
  }
}

export function normalizeCountPrefs(value: unknown): CountPrefs {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const volume = num(stored.volume), delay = num(stored.delayMs)
  return {
    enabled: stored.enabled === true, overlay: stored.overlay === true, voice: stored.voice === 'female' ? 'female' : 'male', // male2 (legacy) → male (A)
    volume: volume === null ? DEFAULT_COUNT_PREFS.volume : Math.min(1, Math.max(0, volume)),
    andWords: stored.andWords !== false, nativeAudio: stored.nativeAudio === 'duck' || stored.nativeAudio === 'keep' ? stored.nativeAudio : 'mute', delayMs: delay === null ? 0 : Math.min(300, Math.max(-300, Math.round(delay))),
  }
}
