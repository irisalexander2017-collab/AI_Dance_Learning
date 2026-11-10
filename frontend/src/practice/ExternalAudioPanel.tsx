import type { ChangeEvent, RefObject } from 'react'

export type AlignStatus = 'idle' | 'running' | 'done' | 'failed'

interface Props {
  language: 'zh' | 'en'
  fileName: string | null
  offsetSeconds: number
  alignStatus: AlignStatus
  alignScore: number | null
  inputRef: RefObject<HTMLInputElement | null>
  accept: string
  onPick: (event: ChangeEvent<HTMLInputElement>) => void
  onClear: () => void
  onOffset: (value: number) => void
  onRealign: () => void
}

export function ExternalAudioPanel(props: Props) {
  const t = (zh: string, en: string) => props.language === 'zh' ? zh : en
  return (
    <div className="compact-menu-body external-audio-panel">
      <p>{t('用本机音频文件替换视频原声（mp3 / aac / wav）。数拍 TTS 仍走原管线。', 'Replace the video soundtrack with a local audio file (mp3 / aac / wav). Count TTS keeps its existing path.')}</p>
      <div className="inline-controls">
        <label className="button-link">
          {props.fileName ? t('更换音频', 'Change audio') : t('上传外挂音频', 'Upload soundtrack')}
          <input ref={props.inputRef} type="file" accept={props.accept} onChange={props.onPick} />
        </label>
        {props.fileName && <button type="button" onClick={props.onClear}>{t('清除', 'Clear')}</button>}
      </div>
      {props.fileName && <p role="status">{t(`当前：${props.fileName}`, `Using: ${props.fileName}`)}</p>}
      {props.fileName && <>
        <div className="inline-controls">
          <label>{t('对齐偏移', 'Align offset')}
            <input
              aria-label={t('外挂音频偏移（秒）', 'External audio offset (seconds)')}
              type="range"
              min={-30}
              max={30}
              step={0.01}
              value={props.offsetSeconds}
              onChange={event => props.onOffset(Number(event.target.value))}
            />
            <input
              aria-label={t('外挂音频偏移数值（秒）', 'External audio offset value (seconds)')}
              type="number"
              min={-30}
              max={30}
              step={0.01}
              value={props.offsetSeconds}
              onChange={event => props.onOffset(Number(event.target.value))}
            />
            <span>s</span>
          </label>
        </div>
        <p className="external-audio-hint" role="note">
          {t('自动对齐是猜测，请用耳朵确认。正值：外挂文件比视频更早响起（播放时取更早位置）。', 'Auto-align is a guess — confirm by ear. Positive: the file starts earlier than the video (playback seeks earlier in the file).')}
        </p>
        <div className="inline-controls">
          <button type="button" disabled={props.alignStatus === 'running'} onClick={props.onRealign}>
            {props.alignStatus === 'running' ? t('对齐中…', 'Aligning…') : t('重新自动对齐', 'Re-run auto-align')}
          </button>
          {props.alignStatus === 'done' && props.alignScore !== null && (
            <span role="status">{t(`猜测 ${props.offsetSeconds.toFixed(2)}s（相关 ${props.alignScore.toFixed(2)}）`, `Guess ${props.offsetSeconds.toFixed(2)}s (corr ${props.alignScore.toFixed(2)})`)}</span>
          )}
          {props.alignStatus === 'failed' && <span role="alert">{t('自动对齐失败，请手调滑条。', 'Auto-align failed — adjust the slider by ear.')}</span>}
        </div>
      </>}
    </div>
  )
}
