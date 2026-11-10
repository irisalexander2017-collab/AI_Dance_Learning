import { useEffect, useRef, useState, type RefObject } from 'react'
import { activePoint, type BeatGrid } from '../beats/grid.ts'

/** Current count on screen (1–8, "&" for the half beat). Frame-accurate through requestVideoFrameCallback, rAF otherwise. */
export function BeatOverlay({ videoRef, grid, active, delayMs }: { videoRef: RefObject<HTMLVideoElement | null>; grid: BeatGrid | null; active: boolean; delayMs: number }) {
  const [label, setLabel] = useState<{ text: string; half: boolean } | null>(null)
  const gridRef = useRef(grid)
  gridRef.current = grid
  useEffect(() => {
    const video = videoRef.current
    if (!active || !video) { setLabel(null); return }
    let stopped = false, handle = 0
    const show = (time: number) => {
      const current = gridRef.current
      if (!current || time < current.anchor - 60 / current.bpm * 2) { setLabel(previous => previous === null ? previous : null); return }
      const point = activePoint(current, time - delayMs / 1000)
      setLabel(previous => previous && previous.text === point.label && previous.half === point.half ? previous : { text: point.label, half: point.half })
    }
    const hasVfc = typeof (video as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === 'function'
    const loop = () => {
      if (stopped) return
      if (hasVfc) handle = video.requestVideoFrameCallback((_now, meta) => { show(meta.mediaTime); loop() })
      else handle = requestAnimationFrame(() => { show(video.currentTime); loop() })
    }
    show(video.currentTime)
    loop()
    const onSeek = () => show(video.currentTime)
    video.addEventListener('seeked', onSeek); video.addEventListener('timeupdate', onSeek)
    return () => { stopped = true; video.removeEventListener('seeked', onSeek); video.removeEventListener('timeupdate', onSeek); if (hasVfc) video.cancelVideoFrameCallback(handle); else cancelAnimationFrame(handle) }
  }, [active, delayMs, videoRef])
  if (!active || !label) return null
  return <div className={`beat-overlay${label.half ? ' half' : ''}`} data-testid="beat-overlay" data-beat={label.text} aria-hidden="true"><span key={`${label.text}${label.half ? '&' : ''}`} className={`beat-pop${label.text === '1' && !label.half ? ' is-one' : ''}`}>{label.text}</span></div>
}
