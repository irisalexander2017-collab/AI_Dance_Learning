import { useRef, useState } from 'react'
import { activePoint, beatInterval, beatOfIndex, maxAdjust, pointAt, type BeatGrid } from '../beats/grid.ts'

interface Props {
  language: 'zh' | 'en'
  grid: BeatGrid
  time: number
  onNudge: (index: number, deltaSeconds: number) => void
  onMove: (index: number, time: number) => void
  onReset: () => void
}

/** One 8-count bar as a strip. Each "&" can be dragged, or nudged by ±10 / ±20 ms; saved per video. */
export function BeatStrip({ language, grid, time, onNudge, onMove, onReset }: Props) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en
  const [selected, setSelected] = useState<number | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)
  const now = activePoint(grid, time)
  const barStartBeat = beatOfIndex(now.index) - (now.beat - 1)
  const barSeconds = beatInterval(grid.bpm) * 8
  const barStartTime = grid.anchor + barStartBeat * beatInterval(grid.bpm)
  const points = Array.from({ length: 32 }, (_, i) => pointAt(grid, barStartBeat * 4 + i)).filter((point): point is NonNullable<typeof point> => point !== null)
  const selectedPoint = selected !== null ? pointAt(grid, selected) : null
  const offsetMs = selectedPoint ? Math.round((grid.adjust[selectedPoint.index] ?? 0) * 1000) : 0
  const timeFromEvent = (clientX: number) => {
    const rect = stripRef.current!.getBoundingClientRect()
    return barStartTime + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * barSeconds
  }
  return <div className="beat-strip-wrap">
    <div className="beat-strip" ref={stripRef} role="group" aria-label={t('八拍与子拍', 'Eight-count bar')}
      onPointerMove={event => { if (dragging.current !== null) onMove(dragging.current, timeFromEvent(event.clientX)) }}
      onPointerUp={() => { dragging.current = null }} onPointerCancel={() => { dragging.current = null }}>
      {points.map(point => {
        const left = (point.time - barStartTime) / barSeconds * 100
        const playing = point.index === now.index
        return <button type="button" key={point.index} data-index={point.index} aria-label={point.half ? t(`半拍 ${point.beat} 和，偏移 ${Math.round((grid.adjust[point.index] ?? 0) * 1000)} 毫秒`, `And after ${point.beat}, offset ${Math.round((grid.adjust[point.index] ?? 0) * 1000)} ms`) : t(`第 ${point.beat} 拍`, `Beat ${point.beat}`)}
          className={`beat-cell${point.half ? ' half' : ''}${playing ? ' now' : ''}${selected === point.index ? ' selected' : ''}${point.adjusted ? ' adjusted' : ''}`}
          style={{ left: `${left}%` }}
          onPointerDown={event => { if (!point.half) return; setSelected(point.index); dragging.current = point.index; (event.currentTarget.parentElement as HTMLElement).setPointerCapture(event.pointerId) }}
          onClick={() => point.half && setSelected(point.index)}>{point.label}</button>
      })}
    </div>
    <div className="beat-nudge" aria-label={t('微调选中的“和”', 'Fine-tune the selected "and"')}>
      <span>{selectedPoint ? t(`第${selectedPoint.beat}拍之后的“和”：${offsetMs > 0 ? '+' : ''}${offsetMs} 毫秒`, `"and" after ${selectedPoint.beat}: ${offsetMs > 0 ? '+' : ''}${offsetMs} ms`) : t('点选或拖动一个“&”，再微调。', 'Select or drag an "&" to fine-tune.')}</span>
      <div className="inline-controls">
        {[-20, -10, 10, 20].map(delta => <button type="button" key={delta} disabled={selected === null} onClick={() => selected !== null && onNudge(selected, delta / 1000)}>{delta > 0 ? '+' : ''}{delta} ms</button>)}
        <button type="button" onClick={() => { onReset(); setSelected(null) }}>{t('全部还原', 'Reset all')}</button>
      </div>
      <small>{t(`范围 ±${Math.round(maxAdjust(grid.bpm) * 1000)} 毫秒`, `Range ±${Math.round(maxAdjust(grid.bpm) * 1000)} ms`)}</small>
    </div>
  </div>
}
