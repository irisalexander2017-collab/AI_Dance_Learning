import { useEffect, useState } from 'react'
import type { TempoSource } from '../practice/savedPractice.ts'
import { inTempoRange, roundBpm } from './tempoCandidates.ts'
import { countHint, type CountInfo } from './countInfo.ts'

export type TempoStatus = 'analyzing' | 'auto' | 'manual' | 'editing' | 'unavailable'
/** Sub-step while status === 'analyzing' — catalog → tag → onset. */
export type TempoPhase = 'catalog' | 'tag' | 'onset' | ''
type Language = 'zh' | 'en'

export function tempoPhaseLabel(phase: TempoPhase, language: Language): string {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en
  switch (phase) {
    case 'catalog': return t('正在匹配曲库', 'Matching catalog…')
    case 'tag': return t('正在读取标签', 'Reading tags…')
    case 'onset': return t('正在检测节拍', 'Detecting beats…')
    default: return t('识别BPM中…', 'Detecting BPM…')
  }
}

/** Alias used by App status lines. */
export const analyzingPhaseLabel = tempoPhaseLabel

/** Short human label for a tempoFailure code (chip + alerts). */
export function tempoFailureLabel(code: string, language: Language): string {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en
  switch (code) {
    case 'large-file': return t('视频过大（>250MB）', 'File too large (>250MB)')
    case 'unsupported-audio': return t('无法解码音频', 'Cannot decode audio')
    case 'analysis-timeout': return t('分析超时', 'Analysis timed out')
    case 'unstable': return t('节拍不稳定', 'Unstable rhythm')
    case 'silent-audio': return t('几乎无声', 'Nearly silent')
    case 'too-short': return t('音频太短', 'Audio too short')
    case 'analysis-failed': return t('分析失败', 'Analysis failed')
    default: return code ? t('分析未完成', 'Analysis incomplete') : t('未识别', 'Not detected')
  }
}

interface ChipProps { language: Language; status: TempoStatus; bpm: number; source: TempoSource; open: boolean; onToggle: () => void; failure?: string; phase?: TempoPhase }

/** The small always-visible tempo read-out. Tapping the number (or failure label) opens the editor below. */
export function BpmChip({ language, status, bpm, source, open, onToggle, failure = '', phase = '' }: ChipProps) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en
  const trigger = (label: string) => <button type="button" className="bpm-number" aria-expanded={open} aria-controls="bpm-editor" title={t('点按修正 BPM', 'Tap to correct BPM')} onClick={onToggle}>{label}</button>
  const sourceLabel = source === 'matched' ? t('曲库', 'catalog') : source === 'tag' ? t('标签', 'tag') : source === 'onset' ? t('音频', 'audio') : ''
  const failShort = tempoFailureLabel(failure, language)
  return <span className="tempo-state" role="status">
    {status === 'editing' ? t('请确认BPM', 'Confirm BPM')
      : status === 'analyzing' ? tempoPhaseLabel(phase, language)
        : status === 'unavailable' ? <>{trigger(failShort)}{t(' · 点选候选或手动', ' · pick a candidate or type')}</>
          : <>{t(status === 'auto' ? '自动 ' : '手动 ', status === 'auto' ? 'Auto ' : 'Manual ')}{trigger(String(bpm))}{' BPM'}{status === 'auto' && sourceLabel ? <small className="bpm-source"> · {sourceLabel}</small> : null}</>}
  </span>
}

interface EditorProps {
  language: Language
  bpm: number | null
  alternatives: number[]
  /** How the number beats were derived (shown as a hint; ×2/÷2 live on the dock when counting). */
  countInfo?: CountInfo | null
  onLevelShift?: (delta: number) => void
  onCommit: (bpm: number) => void
  onClose: () => void
  onRetry?: () => void
  analyzing?: boolean
  failure?: string
  phase?: TempoPhase
}

/** Collapsed by default. On failure: candidate buttons first; typed number field only after「手动输入」. */
export function BpmEditor({ language, bpm, alternatives, countInfo, onLevelShift, onCommit, onClose, onRetry, analyzing, failure, phase = '' }: EditorProps) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en
  const failed = Boolean(failure && bpm === null)
  const [value, setValue] = useState(bpm === null ? '' : String(bpm))
  const [error, setError] = useState('')
  const [typing, setTyping] = useState(!failed) // success path keeps the field; failure starts with candidates only
  useEffect(() => { setValue(bpm === null ? '' : String(bpm)) }, [bpm])
  useEffect(() => { setTyping(!failed) }, [failed, failure])
  const commit = (next: number) => {
    if (!inTempoRange(next)) { setError(t('请输入 40–240 之间的曲速（BPM）。', 'Enter a song tempo (BPM) between 40 and 240.')); return }
    setError(''); onCommit(roundBpm(next))
  }
  const near = (a: number, b: number | null) => b !== null && Math.abs(a / b - 1) <= 0.02
  const candidates = alternatives.filter(candidate => !near(candidate, bpm)).slice(0, 5)
  return <div className="bpm-editor" id="bpm-editor" role="group" aria-label={t('修正曲速', 'Correct song tempo')}>
    {analyzing && <p role="status" className="bpm-phase-status">{tempoPhaseLabel(phase, language)}</p>}
    {failed && <p role="status" className="bpm-fail-reason">{tempoFailureLabel(failure!, language)}{candidates.length ? t(' — 可点候选采用', ' — tap a candidate') : ''}</p>}
    <p className="bpm-layer-label bpm-music-label" role="note">{t('曲速（音乐 BPM）— 改这里才会改分段与节拍网格', 'Song tempo (music BPM) — this changes sections and the beat grid')}</p>
    {candidates.map(candidate => <button type="button" key={`c-${candidate}`} className="bpm-candidate" title={t('识别候选曲速', 'Detected song-tempo candidate')} onClick={() => commit(candidate)}>{candidate}</button>)}
    {typing ? <>
      <input aria-label={t('曲速（音乐 BPM）', 'Song tempo (music BPM)')} inputMode="decimal" type="number" min="40" max="240" step="0.1" value={value} placeholder="BPM"
        onChange={event => { setValue(event.target.value); setError('') }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(Number(value)) } else if (event.key === 'Escape') onClose() }} />
      <button type="button" onClick={() => commit(Number(value))}>{t('确认曲速', 'Set tempo')}</button>
    </> : <button type="button" className="bpm-type-toggle" onClick={() => setTyping(true)}>{t('手动输入', 'Type BPM')}</button>}
    {onLevelShift && countInfo && <>
      <p className="bpm-layer-label" role="note">{t('数拍疏密（×2/÷2 只改念数字的快慢，不改曲速和播放速度）', 'Count density (×2/÷2 changes how often numbers are called, not song tempo or playback speed)')}</p>
      <button type="button" aria-label={t('数得更疏 ÷2（放慢数拍，曲速不变）', 'Count sparser ÷2 (slower counts, tempo unchanged)')} title={t('放慢：数字拍层级 ÷2（曲速不变）', 'Slower: number-beat level ÷2 (song tempo unchanged)')} disabled={!(countInfo.numberBpm * 0.5 >= 30 && countInfo.levelShift > -2)} onClick={() => onLevelShift(-1)}>{t('数得更疏 ÷2', 'Sparser ÷2')}</button>
      <button type="button" aria-label={t('数得更密 ×2（放快数拍，曲速不变）', 'Count denser ×2 (faster counts, tempo unchanged)')} title={t('放快：数字拍层级 ×2（曲速不变）', 'Faster: number-beat level ×2 (song tempo unchanged)')} disabled={!(countInfo.numberBpm * 2 <= 240 && countInfo.levelShift < 2)} onClick={() => onLevelShift(1)}>{t('数得更密 ×2', 'Denser ×2')}</button>
    </>}
    {onRetry && <button type="button" disabled={analyzing} onClick={onRetry}>{t('重新分析', 'Analyze again')}</button>}
    <button type="button" className="bpm-close" aria-label={t('收起', 'Collapse')} onClick={onClose}>{t('收起', 'Close')}</button>
    {countInfo && <small className="count-hint" data-testid="count-hint">{countHint(countInfo, language)}{countInfo.levelShift ? t(` · 已手动 ${countInfo.levelShift > 0 ? '×' + 2 ** countInfo.levelShift : '÷' + 2 ** -countInfo.levelShift}`, ` · manual ${countInfo.levelShift > 0 ? '×' + 2 ** countInfo.levelShift : '÷' + 2 ** -countInfo.levelShift}`) : ''}</small>}
    {error && <p role="alert">{error}</p>}
  </div>
}
