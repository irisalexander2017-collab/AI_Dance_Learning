import { useCallback, useEffect, useState } from 'react'
import { clearDances, deleteDance, listDances, type DanceRecord } from './danceStore.ts'

function summary(record: DanceRecord) {
  try {
    const practice = record.practice ? JSON.parse(record.practice) as { bpm?: number; tempoMode?: string; firstBeatTime?: number | null } : null
    const parts: string[] = []
    if (practice && practice.tempoMode && practice.tempoMode !== 'unset' && typeof practice.bpm === 'number') parts.push(`${Math.round(practice.bpm * 10) / 10} BPM`)
    if (practice && typeof practice.firstBeatTime === 'number') parts.push(`1: ${practice.firstBeatTime.toFixed(2)}s`)
    if (record.analysis) parts.push('✓')
    return parts.join(' · ')
  } catch { return '' }
}

/** Folded list of saved alignments (IndexedDB). Only numbers are kept, never the video. */
export function SavedDances({ language, refresh = 0, onPick }: { language: 'zh' | 'en'; refresh?: number; onPick?: (record: DanceRecord) => void }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en
  const [items, setItems] = useState<DanceRecord[] | null>(null)
  const load = useCallback(() => { void listDances().then(setItems) }, [])
  useEffect(load, [load, refresh])
  return <div className="saved-dances">
    <p>{t('只保存对齐数据（BPM、第 1 拍、手动修正、自定义分段、分析结果），视频需要重新选择。同一视频再次打开会自动恢复。', 'Only alignment data is saved (BPM, beat 1, manual fixes, custom cuts, analysis); pick the video again. The same video restores automatically.')}</p>
    {items === null ? null : items.length === 0
      ? <p role="status">{t('还没有保存的舞。', 'Nothing saved yet.')}</p>
      : <ul aria-label={t('已保存的舞', 'Saved dances')}>{items.map(item => <li key={item.id}>
        <span title={item.name}>{item.name}<small> · {summary(item)} · {new Date(item.savedAt).toLocaleDateString()}</small></span>
        {onPick && <button type="button" aria-label={`${t('切换到', 'Switch to')} ${item.name}`} title={t('需重新选择该视频文件；文件一致则自动恢复对齐', 'Pick this video file again; alignment is restored if it matches')} onClick={() => onPick(item)}>{t('切换', 'Switch')}</button>}
        <button type="button" aria-label={`${t('清除', 'Clear')} ${item.name}`} onClick={() => { void deleteDance(item.id).then(load) }}>{t('清除', 'Clear')}</button>
      </li>)}</ul>}
    {items !== null && items.length > 0 && <button type="button" className="saved-clear-all" onClick={() => { void clearDances().then(load) }}>{t('全部清除', 'Clear all')}</button>}
  </div>
}
