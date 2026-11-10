import { useState, type ReactNode } from 'react'
import type { CountPrefs, CountSettings } from '../beats/countSettings.ts'
import type { AnchorMode, AnchorResult, AlignBasis } from '../beats/anchor.ts'
import type { BeatGrid } from '../beats/grid.ts'
import type { PoseState } from '../pose/usePoseAccents.ts'
import { countHint, type CountInfo } from '../beats/countInfo.ts'
import { BeatStrip } from './BeatStrip.tsx'

export type SegmentModeUi = 'beats' | 'custom'

interface Props {
  language: 'zh' | 'en'
  prefs: CountPrefs
  settings: CountSettings
  grid: BeatGrid | null
  countInfo: CountInfo | null
  anchorInfo: AnchorResult | null
  pose: PoseState
  voiceState: 'idle' | 'loading' | 'ready' | 'failed'
  time: number
  tempoReady: boolean
  hasMusicStart: boolean
  hasDanceStart: boolean
  musicStartTime: number | null
  danceStartTime: number | null
  hasAudioOnsets: boolean
  setPrefs: (patch: Partial<CountPrefs>) => void
  updateSettings: (patch: Partial<CountSettings>) => void
  onToggleCount: () => void
  onMarkMusicStart: () => void
  onMarkDanceStart: () => void
  onBeginEvenCuts?: () => void
  onSetHere: () => void
  onNudge: (index: number, delta: number) => void
  onMove: (index: number, time: number) => void
  onResetAdjust: () => void
  onCancelPose: () => void
  onRetryPose: () => void
  onRequestPose: () => void
  onExport: () => void
  exporting: boolean
  /** Section mode + editor slotted from App (custom cuts / beat boundaries). */
  segmentMode: SegmentModeUi
  onSegmentMode: (mode: SegmentModeUi) => void
  sectionCount: number
  segmentsEditor: ReactNode
}

/** ⋯ → 数拍与分段 panel: starts + sections + common count prefs; advanced fold holds the rest. */
export function CountSettingsPanel(props: Props) {
  const { language, prefs, settings, grid, anchorInfo, pose, countInfo } = props
  const t = (zh: string, en: string) => language === 'zh' ? zh : en
  const [advanced, setAdvanced] = useState(false)
  const countOn = prefs.enabled || prefs.overlay
  const musicLabel = props.hasMusicStart && props.musicStartTime !== null
    ? `${props.musicStartTime.toFixed(2)}s`
    : t('未设置', 'Not set')
  const danceLabel = props.hasDanceStart && props.danceStartTime !== null
    ? `${props.danceStartTime.toFixed(2)}s`
    : t('未设置', 'Not set')
  const bothStarts = props.hasMusicStart && props.hasDanceStart
  const poseText = pose.status === 'running' ? t(`动作分析中 ${Math.round(pose.progress * 100)}%`, `Analyzing motion ${Math.round(pose.progress * 100)}%`)
    : pose.status === 'loading' ? t('读取动作缓存…', 'Reading motion cache…')
      : pose.status === 'ready' ? t(`动作分析完成（${pose.accents.length} 个重音${pose.fromCache ? '，来自缓存' : ''}）`, `Motion analysis done (${pose.accents.length} accents${pose.fromCache ? ', cached' : ''})`)
        : pose.status === 'failed' ? t('动作分析失败，仅按音乐对齐。', 'Motion analysis failed; aligning to music only.')
          : pose.status === 'cancelled' ? t('已取消动作分析。', 'Motion analysis cancelled.') : t('尚未分析动作。', 'Motion not analyzed yet.')
  const evidence = anchorInfo?.evidence === 'pose+audio' ? t('动作+音乐', 'motion + music') : anchorInfo?.evidence === 'pose' ? t('动作', 'motion') : anchorInfo?.evidence === 'audio' ? t('音乐', 'music') : t('无（仅用所选起点）', 'none (chosen start only)')
  const modes: [AnchorMode, string, boolean][] = [['auto', settings.follow ? t('自动（老师起动）', 'Auto (teacher starts)') : t('自动', 'Auto'), true], ['music', t('音乐起点', 'Music start'), props.hasMusicStart], ['dance', t('动作起点', 'Dance start'), props.hasDanceStart], ['manual', t('手动', 'Manual'), settings.manualAnchor !== null]]
  const voiceValue = prefs.voice === 'female' ? 'female' : 'male'
  return <div className="compact-menu-body count-settings">
    <section className="practice-starts" aria-label={t('两个起点', 'Two starts')}>
      <p className="count-auto-note">{t('主路径在底栏：点「音乐」→ 在进度条上点一下确认；再点「动作」→ 拖到动作开始处确认。此处可跳转同一流程。', 'Main path is the dock: Music → tap the bar; Dance → drag and confirm. Buttons here jump into the same flow.')}</p>
      <p role="status" className="practice-start-status">{t('音乐起点', 'Music start')}：{musicLabel} · {t('动作起点', 'Dance start')}：{danceLabel}</p>
      <div className="inline-controls">
        <button type="button" onClick={props.onMarkMusicStart}>{t('去标音乐', 'Mark music')}</button>
        <button type="button" disabled={!props.hasMusicStart} onClick={props.onMarkDanceStart}>{t('去标动作', 'Mark dance')}</button>
      </div>
      {bothStarts && props.segmentMode === 'beats' && props.sectionCount > 0 && <p role="status" className="segment-auto-note">{props.tempoReady ? t('已自动分好八拍', 'Eight-beat sections are ready') : t('已按临时曲速分好八拍（确认 BPM 后重算）', 'Eight-beat sections use a temporary song tempo (rebuild after BPM confirm)')}</p>}
    </section>

    <section className="practice-segments" aria-label={t('分段', 'Sections')}>
      <div className="segment-mode" role="group" aria-label={t('分段方式', 'Section mode')}>
        <button type="button" aria-pressed={props.segmentMode === 'beats'} className={props.segmentMode === 'beats' ? 'active' : ''} onClick={() => props.onSegmentMode('beats')}>{t('八拍分段', 'Eight-beat')}</button>
        <button type="button" aria-pressed={props.segmentMode === 'custom'} className={props.segmentMode === 'custom' ? 'active' : ''} onClick={() => props.onSegmentMode('custom')}>{t('自定义分段', 'Custom sections')}</button>
      </div>
      {props.segmentMode === 'custom' && <p className="cut-guide" role="status">{t('主路径：底栏「自定义」拖出第一小节再确认。下方可再微调。', 'Main path: dock Custom → drag first section → confirm. Fine-tune below if needed.')}</p>}
      {props.segmentsEditor}
    </section>

    <section className="count-common" aria-label={t('数拍常用', 'Count essentials')}>
      <div className="inline-controls">
        <button type="button" aria-pressed={countOn} className={countOn ? 'active' : ''} disabled={!props.tempoReady} onClick={props.onToggleCount}>{countOn ? t('数拍：开', 'Count: on') : t('数拍：关', 'Count: off')}</button>
      </div>
      {countOn && props.voiceState === 'loading' && <p role="status">{t('正在载入数拍声音…', 'Loading count voice…')}</p>}
      {props.voiceState === 'failed' && <p role="alert">{t('数拍声音载入失败。', 'Count voice failed to load.')}</p>}
    </section>

    <button type="button" className="count-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}>{t('高级', 'Advanced')} {advanced ? '▴' : '▾'}</button>
    {advanced && <div className="count-advanced">
      <div className="inline-controls"><label>{t('音色', 'Voice')} <select aria-label={t('数拍声音', 'Count voice')} value={voiceValue} onChange={event => props.setPrefs({ voice: event.target.value === 'female' ? 'female' : 'male' })}><option value="male">{t('温和男声 A', 'Warm male A')}</option><option value="female">{t('女声 B', 'Female B')}</option></select></label>
        <label><input type="checkbox" checked={prefs.andWords} onChange={event => props.setPrefs({ andWords: event.target.checked })} /> {t('念“and”', 'Say "and"')}</label></div>
      <div className="inline-controls"><label>{t('数拍时原声', 'Original sound while counting')} <select aria-label={t('数拍时原声', 'Original sound while counting')} value={prefs.nativeAudio} onChange={event => props.setPrefs({ nativeAudio: event.target.value === 'duck' || event.target.value === 'keep' ? event.target.value : 'mute' })}><option value="mute">{t('静音（默认）', 'Mute (default)')}</option><option value="duck">{t('压低', 'Lower')}</option><option value="keep">{t('保持', 'Keep')}</option></select></label></div>
      <div className="inline-controls"><label>{t('数拍方式', 'Count style')} <select aria-label={t('数拍方式', 'Count style')} value={settings.follow ? 'follow' : 'fixed'} onChange={event => props.updateSettings({ follow: event.target.value === 'follow' })}><option value="follow">{t('跟随老师动作（默认）', 'Follow the teacher (default)')}</option><option value="fixed">{t('固定 1&2&', 'Fixed 1 & 2 &')}</option></select></label></div>
      <div className="inline-controls">
        <button type="button" aria-pressed={prefs.enabled} className={prefs.enabled ? 'active' : ''} disabled={!props.tempoReady} onClick={() => props.setPrefs({ enabled: !prefs.enabled })}>{prefs.enabled ? t('数拍声：开', 'Count sound: on') : t('数拍声：关', 'Count sound: off')}</button>
        <button type="button" aria-pressed={prefs.overlay} className={prefs.overlay ? 'active' : ''} onClick={() => props.setPrefs({ overlay: !prefs.overlay })}>{prefs.overlay ? t('显示拍号：开', 'Beat number: on') : t('显示拍号：关', 'Beat number: off')}</button>
      </div>
      <div className="inline-controls"><label>{t('数拍音量', 'Count volume')} <input aria-label={t('数拍音量', 'Count volume')} type="range" min="0" max="1" step=".05" value={prefs.volume} onChange={event => props.setPrefs({ volume: Number(event.target.value) })} /></label></div>
      <div className="inline-controls"><label>{t('第一拍', 'First beat')} <select aria-label={t('第一拍来源', 'First beat source')} value={settings.anchorMode} onChange={event => props.updateSettings({ anchorMode: event.target.value as AnchorMode })}>{modes.map(([value, label, enabled]) => <option key={value} value={value} disabled={!enabled}>{label}</option>)}</select></label>
        <button type="button" onClick={props.onSetHere}>{t('当前位置设为“1”', 'Set "1" here')}</button></div>
      <div className="inline-controls"><label>{t('对齐依据', 'Align to')} <select aria-label={t('对齐依据', 'Align to')} value={settings.alignBasis} onChange={event => props.updateSettings({ alignBasis: event.target.value as AlignBasis })}><option value="both">{t('动作+音乐', 'Motion + music')}</option><option value="pose">{t('仅动作', 'Motion only')}</option><option value="audio" disabled={!props.hasAudioOnsets}>{t('仅音乐', 'Music only')}</option></select></label></div>
      <div className="inline-controls"><label>{t('声音延迟', 'Sound offset')} <input aria-label={t('数拍声音偏移（毫秒）', 'Count sound offset (ms)')} type="number" step="10" min="-300" max="300" value={prefs.delayMs} onChange={event => props.setPrefs({ delayMs: Number(event.target.value) })} /> ms</label></div>
      {countInfo && <p className="count-mode-info" data-testid="count-mode-info">{countHint(countInfo, language)}{countInfo.danceStart !== null ? t(` · 老师动作起点 ${countInfo.danceStart.toFixed(2)}s`, ` · motion starts ${countInfo.danceStart.toFixed(2)}s`) : ''}{countInfo.subCounts ? t(` · 每拍额外动作数 0/1/2/3 = ${countInfo.subCounts.join('/')}`, ` · extra hits per beat 0/1/2/3 = ${countInfo.subCounts.join('/')}`) : ''}</p>}
      {anchorInfo && grid && <p className="anchor-info">{t(`第一拍 ${grid.anchor.toFixed(2)}s · 依据：${evidence}${anchorInfo.shiftMs ? ` · 相对起点 ${anchorInfo.shiftMs > 0 ? '+' : ''}${anchorInfo.shiftMs} ms` : ''}`, `First beat ${grid.anchor.toFixed(2)}s · from ${evidence}${anchorInfo.shiftMs ? ` · ${anchorInfo.shiftMs > 0 ? '+' : ''}${anchorInfo.shiftMs} ms from marker` : ''}`)}{anchorInfo.concentration.pose !== null ? t(` · 动作集中度 ${anchorInfo.concentration.pose.toFixed(2)}`, ` · motion lock ${anchorInfo.concentration.pose.toFixed(2)}`) : ''}{anchorInfo.concentration.audio !== null ? t(` · 音乐集中度 ${anchorInfo.concentration.audio.toFixed(2)}`, ` · music lock ${anchorInfo.concentration.audio.toFixed(2)}`) : ''}</p>}
      {grid && <BeatStrip language={language} grid={grid} time={props.time} onNudge={props.onNudge} onMove={props.onMove} onReset={props.onResetAdjust} />}
      <div className="inline-controls"><button type="button" disabled={!grid || props.exporting} onClick={props.onExport}>{props.exporting ? t('导出中…', 'Exporting…') : t('导出数拍 WAV', 'Export count WAV')}</button></div>
      <p role="status" className="pose-status">{pose.status === 'running' ? <progress aria-label={t('动作分析进度', 'Motion analysis progress')} max={1} value={pose.progress} /> : null} {poseText}{pose.status === 'running' && <button type="button" onClick={props.onCancelPose}>{t('取消', 'Cancel')}</button>}{(pose.status === 'failed' || pose.status === 'cancelled') && <button type="button" onClick={props.onRetryPose}>{t('重试', 'Retry')}</button>}{pose.status === 'idle' && <button type="button" onClick={props.onRequestPose}>{t('分析动作', 'Analyze motion')}</button>}</p>
    </div>}
  </div>
}
