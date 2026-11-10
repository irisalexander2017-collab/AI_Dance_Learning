import { MIN_SEGMENT_SECONDS } from './customSegments.ts'

type Language = 'zh' | 'en'

interface EditorProps {
  language: Language
  cuts: number[]
  duration: number
  currentTime: number
  /** Live section under the playhead (1-based) and its [start,end]. */
  liveRange?: { index: number; start: number; end: number } | null
  onAdd: () => void
  onMove: (index: number, time: number) => void
  onRemove: (index: number) => void
  onSeek: (time: number) => void
}

export function CustomCutsEditor({ language, cuts, duration, currentTime, liveRange, onAdd, onMove, onRemove, onSeek }: EditorProps) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en
  return <div className="custom-cuts">
    <div className="inline-controls">
      <button type="button" className="cut-add" aria-label={t('在当前位置添加分界（微调）', 'Add cut at playhead (fine-tune)')} title={t('微调：在当前位置添加分界', 'Fine-tune: add cut at playhead')} onClick={onAdd}>＋</button>
      <span>{currentTime.toFixed(2)}s</span>
      {liveRange && <span role="status" className="cut-live-range">{t(`第 ${liveRange.index} 段 ${liveRange.start.toFixed(2)}–${liveRange.end.toFixed(2)}s`, `Section ${liveRange.index} ${liveRange.start.toFixed(2)}–${liveRange.end.toFixed(2)}s`)}</span>}
    </div>
    <p className="cut-guide">{t('再微调：在列表里移分界或点 ＋。主路径请用底栏「自定义」均分。', 'Fine-tune: move cuts in the list or tap +. Prefer dock Custom for even cuts.')}</p>
    <p>{t(`每段至少 ${MIN_SEGMENT_SECONDS} 秒；进度条保持干净，分界在下方列表调整。`, `Min ${MIN_SEGMENT_SECONDS}s per section. Keep the bar clean; adjust cuts in the list below.`)}</p>
    {cuts.length === 0 && <p>{t('还没有分界：整段视频一起播放。', 'No cuts yet: the whole video plays.')}</p>}
    <ul className="cut-list">
      {cuts.map((cut, index) => <li key={`${index}-${cut}`}>
        <button type="button" onClick={() => onSeek(cut)} aria-label={t(`跳到分界 ${index + 1}`, `Go to cut ${index + 1}`)}>{t('分界', 'Cut')} {index + 1} · {cut.toFixed(2)}s</button>
        <button type="button" aria-label={t(`分界 ${index + 1} 前移 0.1 秒`, `Move cut ${index + 1} earlier by 0.1 s`)} onClick={() => onMove(index, cut - 0.1)}>−0.1</button>
        <button type="button" aria-label={t(`分界 ${index + 1} 后移 0.1 秒`, `Move cut ${index + 1} later by 0.1 s`)} onClick={() => onMove(index, cut + 0.1)}>+0.1</button>
        <button type="button" aria-label={t(`分界 ${index + 1} 移到当前位置`, `Move cut ${index + 1} to playhead`)} onClick={() => onMove(index, currentTime)}>{t('移到此处', 'Here')}</button>
        <button type="button" aria-label={t(`删除分界 ${index + 1}`, `Delete cut ${index + 1}`)} onClick={() => onRemove(index)}>{t('删除', 'Delete')}</button>
      </li>)}
    </ul>
    {duration > 0 && cuts.length > 0 && <p>{t(`共 ${cuts.length + 1} 段`, `${cuts.length + 1} sections`)}</p>}
  </div>
}
