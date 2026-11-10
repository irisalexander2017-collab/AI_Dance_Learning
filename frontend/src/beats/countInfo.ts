import type { FirstBeat } from './motionTempo.ts'

/** What the BPM panel shows about how the number beats were derived. */
export interface CountInfo {
  /** 'motion' = level / first beat / extra hits come from the teacher's pose; 'music' = audio BPM only (pose not ready or not usable). */
  basis: 'motion' | 'music'
  follow: boolean
  musicBpm: number
  numberBpm: number
  /** number-beat tempo ÷ music tempo before the user's ×2/÷2 steps */
  ratio: number
  levelShift: number
  /** true when the level came from motion evidence */
  reliable: boolean
  /** cost gap between the chosen level and the runner-up; < 0.25 means the choice is tentative */
  margin: number
  danceStart: number | null
  firstBeat: FirstBeat | null
  /** beats with 0 / 1 / 2 / 3 extra hits */
  subCounts: [number, number, number, number] | null
}

const trim = (value: number) => String(Math.round(value * 10) / 10)

/** Short hint such as "动作锁定 · 71.2 BPM 数字拍". */
export function countHint(info: CountInfo, language: 'zh' | 'en'): string {
  const zh = language === 'zh'
  const bpm = trim(info.numberBpm)
  if (!info.follow) return zh ? `固定 1&2& · ${bpm} BPM 数字拍` : `Fixed 1&2& · ${bpm} BPM numbers`
  if (info.basis === 'music') return zh ? `临时仅整拍 · ${bpm} BPM（分析完成后按动作插 and/e/a）` : `Temp numbers-only · ${bpm} BPM (subs follow motion once analyzed)`
  const tentative = !info.reliable || info.margin < 0.25
  return zh ? `动作锁定 · ${bpm} BPM 数字拍${tentative ? '（层级不确定，可用 ×2/÷2）' : ''}` : `Motion lock · ${bpm} BPM numbers${tentative ? ' (level uncertain, use ×2/÷2)' : ''}`
}
