import { useState, type ReactNode } from 'react'
import type { LearningSegment, PracticeRangeMode } from './beatTimeline'

interface Props {
  language: 'zh' | 'en'
  expanded: boolean
  onExpanded: (value: boolean) => void
  speed: number
  speeds: readonly number[]
  onSpeed: (value: number) => void
  sections: LearningSegment[]
  selected: number
  rangeMode: PracticeRangeMode
  onRange: (value: PracticeRangeMode) => void
  /** true = loop current range with 2s rest; false = play the section once */
  loop: boolean
  onLoop: (value: boolean) => void
  onSection: (value: number) => void
  playing: boolean
  waiting: boolean
  onPlay: () => void
  timeline: ReactNode
  /** Legacy slot: panels now float over the video (App renders them there). */
  menu?: ReactNode
  hint: boolean
  onDismissHint: () => void
}

export function PracticeDock(props: Props) {
  const [speedOpen, setSpeedOpen] = useState(false)
  const text = (zh: string, en: string) => props.language === 'zh' ? zh : en
  return <div className="practice-dock" aria-label={text('练习控制条', 'Practice controls')}>
    {props.menu}
    {props.timeline}
    {speedOpen && <div className="dock-speed-options" aria-label={text('选择速度', 'Choose speed')}>
      {props.speeds.map(value => <button type="button" aria-pressed={props.speed === value} className={props.speed === value ? 'active' : ''} key={value} onClick={() => { props.onSpeed(value); setSpeedOpen(false) }}>{value}×</button>)}
    </div>}
    <div className="dock-main-row">
      <button type="button" className="dock-play" aria-label={props.waiting ? text('取消等待', 'Cancel wait') : props.playing ? text('暂停', 'Pause') : text('播放', 'Play')} onClick={props.onPlay}>
        {props.playing ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" /></svg>}
      </button>
      <button type="button" className="dock-speed-trigger" aria-expanded={speedOpen} onClick={() => setSpeedOpen(value => !value)}>{text('速度', 'Speed')} {props.speed}×</button>
      <div className="dock-range-toggle">
        <div className="seg-pill range-pill" role="group" aria-label={text('选段方式', 'Section selection')} data-v={props.rangeMode === 'current' ? 0 : 1}>
          <span className="seg-thumb" aria-hidden="true" />
          <button type="button" aria-pressed={props.rangeMode === 'current'} className={props.rangeMode === 'current' ? 'active' : ''} onClick={() => props.onRange('current')}>{text('单段', 'Single')}</button>
          <button type="button" aria-pressed={props.rangeMode === 'from-start'} className={props.rangeMode === 'from-start' ? 'active' : ''} onClick={() => props.onRange('from-start')}>{text('累加', 'Build-up')}</button>
        </div>
        <button type="button" aria-pressed={props.loop} className={`dock-loop${props.loop ? ' active' : ''}`} title={text('循环当前段，段末停 2 秒再播', 'Loop current section with a 2s rest')} onClick={() => props.onLoop(!props.loop)}>{props.loop ? text('循环 · 停2秒', 'Loop · 2s') : text('循环', 'Loop')}</button>
      </div>
      <button type="button" className="dock-collapse" aria-label={props.expanded ? text('收起段号', 'Collapse sections') : text('展开段号', 'Expand sections')} aria-expanded={props.expanded} onClick={() => props.onExpanded(!props.expanded)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={props.expanded ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} /></svg>
      </button>
    </div>
    {props.expanded ? <div className="dock-section-row" aria-label={text('选择练习段', 'Choose a practice section')}>
      {props.sections.length ? props.sections.map((section, index) => <button type="button" key={section.segmentIndex} aria-label={text(`第${index + 1}段`, `Section ${index + 1}`)} aria-pressed={props.selected === index} className={props.selected === index ? 'active' : props.rangeMode === 'from-start' && index < props.selected ? 'in-range' : ''} onClick={() => props.onSection(index)}>{index + 1}</button>) : <span className="dock-empty">{text('先点①音乐，再点②动作，标好两个起点。', 'Tap ① Music, then ② Dance, to mark both starts.')}</span>}
    </div> : props.sections.length > 0 && <p className="dock-range-summary" role="status">{props.rangeMode === 'current' ? text(`共 ${props.sections.length} 段 · 当前第 ${props.selected + 1} 段`, `${props.sections.length} sections · current ${props.selected + 1}`) : text(`共 ${props.sections.length} 段 · 第1–${props.selected + 1} 段`, `${props.sections.length} sections · 1–${props.selected + 1}`)}</p>}
    {props.hint && props.sections.length > 0 && <div className="dock-hint"><span>{text('点段号选范围，点箭头收起。', 'Choose a section. Use the arrow to fold the row.')}</span><button type="button" onClick={props.onDismissHint}>{text('知道了', 'Got it')}</button></div>}
  </div>
}
