import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const ALLOWED_EXTENSIONS = ['mp4', 'mov', 'webm']
const SPEEDS = [0.5, 0.65, 0.8, 1] as const
type VideoOrientation = 'landscape' | 'portrait' | 'square'
type DisplayMode = 'contain' | 'cover'
type PanPosition = { x: number; y: number }

const CENTER_PAN: PanPosition = { x: 50, y: 50 }

function readStoredNumber(key: string, fallback: number) {
  const stored = localStorage.getItem(key)
  if (stored === null) return fallback
  const value = Number(stored)
  return Number.isFinite(value) ? value : fallback
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.floor(seconds % 60)
  return `${minutes}:${remaining.toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function readStoredPan(): PanPosition {
  try {
    const value = JSON.parse(localStorage.getItem('adl-portrait-pan') ?? '') as Partial<PanPosition>
    const x = Number(value.x)
    const y = Number(value.y)
    return {
      x: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
      y: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
    }
  } catch {
    return CENTER_PAN
  }
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; pan: PanPosition } | null>(null)
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState('')
  const [speed, setSpeed] = useState(() => {
    const stored = readStoredNumber('adl-playback-speed', 1)
    return SPEEDS.includes(stored as (typeof SPEEDS)[number]) ? stored : 1
  })
  const [isMirrored, setIsMirrored] = useState(() => localStorage.getItem('adl-mirrored') === 'true')
  const [volume, setVolume] = useState(() => Math.min(1, Math.max(0, readStoredNumber('adl-volume', 1))))
  const [isMuted, setIsMuted] = useState(false)
  const [orientation, setOrientation] = useState<VideoOrientation>('landscape')
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => (
    localStorage.getItem('adl-display-mode') === 'cover' ? 'cover' : 'contain'
  ))
  const [portraitPan, setPortraitPan] = useState<PanPosition>(readStoredPan)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const effectiveDisplayMode: DisplayMode = orientation === 'portrait' && isFullscreen ? 'contain' : displayMode
  const canDragPortrait = orientation === 'portrait' && effectiveDisplayMode === 'cover'

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Health check failed')
        return response.json()
      })
      .then((data) => setBackendConnected(data.status === 'ok'))
      .catch(() => setBackendConnected(false))
    return () => controller.abort()
  }, [])

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === playerRef.current)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    localStorage.setItem('adl-portrait-pan', JSON.stringify(portraitPan))
  }, [portraitPan])

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current
    if (!videoUrl || !video) return
    if (video.paused) {
      try {
        await video.play()
        setError('')
      } catch {
        setError('无法播放此视频。请确认文件格式受浏览器支持。')
      }
    } else {
      video.pause()
    }
  }, [videoUrl])

  const seekBy = useCallback((seconds: number) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) return
    video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + seconds))
  }, [])

  const toggleMirror = useCallback(() => {
    setIsMirrored((current) => {
      const next = !current
      localStorage.setItem('adl-mirrored', String(next))
      return next
    })
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      if (isTyping) return

      if (event.code === 'Space') {
        event.preventDefault()
        void togglePlayback()
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault()
        seekBy(-2)
      } else if (event.code === 'ArrowRight') {
        event.preventDefault()
        seekBy(2)
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault()
        toggleMirror()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [seekBy, toggleMirror, togglePlayback])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setError('不支持此文件格式。请选择 MP4、MOV 或 WebM 视频。')
      event.target.value = ''
      return
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setVideoUrl(url)
    setFileName(file.name)
    setFileSize(file.size)
    setDuration(0)
    setCurrentTime(0)
    setIsPlaying(false)
    setOrientation('landscape')
    setError('')
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = speed
    video.volume = volume
    if (video.videoWidth === video.videoHeight) {
      setOrientation('square')
    } else if (video.videoWidth > video.videoHeight) {
      setOrientation('landscape')
    } else {
      setOrientation('portrait')
    }
    setDuration(video.duration)
    setError('')
  }

  const changeDisplayMode = (nextMode: DisplayMode) => {
    setDisplayMode(nextMode)
    localStorage.setItem('adl-display-mode', nextMode)
  }

  const getCoverOverflow = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return { x: 0, y: 0 }
    const scale = Math.max(video.clientWidth / video.videoWidth, video.clientHeight / video.videoHeight)
    return {
      x: Math.max(0, video.videoWidth * scale - video.clientWidth),
      y: Math.max(0, video.videoHeight * scale - video.clientHeight),
    }
  }

  const clampPanToCurrentVideo = (position: PanPosition) => {
    const overflow = getCoverOverflow()
    return {
      x: overflow.x > 0 ? Math.min(100, Math.max(0, position.x)) : 50,
      y: overflow.y > 0 ? Math.min(100, Math.max(0, position.y)) : 50,
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (!canDragPortrait) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pan: portraitPan,
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLVideoElement>) => {
    const drag = dragRef.current
    if (!canDragPortrait || !drag || drag.pointerId !== event.pointerId) return
    const overflow = getCoverOverflow()
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    setPortraitPan(clampPanToCurrentVideo({
      x: overflow.x > 0 ? drag.pan.x + (isMirrored ? deltaX : -deltaX) / overflow.x * 100 : 50,
      y: overflow.y > 0 ? drag.pan.y - deltaY / overflow.y * 100 : 50,
    }))
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const resetPicture = () => setPortraitPan(CENTER_PAN)

  const changeSpeed = (nextSpeed: number) => {
    const video = videoRef.current
    if (video) video.playbackRate = nextSpeed
    setSpeed(nextSpeed)
    localStorage.setItem('adl-playback-speed', String(nextSpeed))
  }

  const changeVolume = (event: ChangeEvent<HTMLInputElement>) => {
    const nextVolume = Number(event.target.value)
    const video = videoRef.current
    if (video) {
      video.volume = nextVolume
      if (nextVolume > 0) video.muted = false
    }
    setVolume(nextVolume)
    setIsMuted(nextVolume === 0)
    localStorage.setItem('adl-volume', String(nextVolume))
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setIsMuted(video.muted)
  }

  const enterFullscreen = async () => {
    try {
      await playerRef.current?.requestFullscreen()
    } catch {
      setError('浏览器无法进入全屏模式。')
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">LOCAL PRACTICE TOOL</p>
          <h1>AI Dance Learning</h1>
          <p className="tagline">Turn dance videos into simple 8-count practice sessions.</p>
        </div>
        <div className="service-status" aria-label="Service status">
          <span className="status"><span className="dot online" />Frontend running</span>
          <span className="status"><span className={`dot ${backendConnected ? 'online' : backendConnected === false ? 'offline' : 'checking'}`} />
            {backendConnected === null ? 'Checking backend…' : backendConnected ? 'Backend connected' : 'Backend unavailable'}
          </span>
        </div>
      </header>

      <section className="workspace">
        {!videoUrl ? (
          <label className="upload-panel">
            <span className="upload-icon" aria-hidden="true">＋</span>
            <strong>选择舞蹈视频</strong>
            <span>MP4、MOV 或 WebM</span>
            <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={handleFileChange} />
          </label>
        ) : (
          <>
            <div ref={playerRef} className={`player-frame ${orientation}`}>
              <video
                ref={videoRef}
                className={`${orientation} ${effectiveDisplayMode}${isMirrored ? ' mirrored' : ''}${canDragPortrait ? ' draggable-video' : ''}`}
                style={{ objectPosition: canDragPortrait ? `${portraitPan.x}% ${portraitPan.y}%` : '50% 50%' }}
                src={videoUrl}
                preload="metadata"
                playsInline
                draggable={false}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onError={() => setError('视频加载失败。此文件可能损坏，或编码不受当前浏览器支持。')}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerEnd}
                onPointerCancel={handlePointerEnd}
              />
              <div className="timeline-row">
                <span>{formatTime(currentTime)}</span>
                <input
                  aria-label="视频进度"
                  type="range"
                  min="0"
                  max={duration || 0}
                  step="0.01"
                  value={Math.min(currentTime, duration || 0)}
                  onChange={(event) => {
                    if (videoRef.current) videoRef.current.currentTime = Number(event.target.value)
                  }}
                />
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="file-row">
              <div><strong>{fileName}</strong><span>{formatFileSize(fileSize)} · {formatTime(duration)}</span></div>
              <label className="replace-button">更换视频<input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={handleFileChange} /></label>
            </div>

            <div className="primary-controls">
              <button type="button" onClick={() => seekBy(-2)}>↶ 回看 2 秒</button>
              <button type="button" className="play-button" onClick={() => void togglePlayback()}>{isPlaying ? '暂停' : '播放'}</button>
              <button type="button" onClick={() => seekBy(2)}>前进 2 秒 ↷</button>
            </div>

            <div className="control-grid">
              <div className="control-group">
                <span className="control-label">速度</span>
                <div className="segmented">
                  {SPEEDS.map((value) => <button type="button" key={value} className={speed === value ? 'active' : ''} onClick={() => changeSpeed(value)}>{value}×</button>)}
                </div>
              </div>
              <div className="control-group display-mode-group">
                <span className="control-label">画面</span>
                <div className="segmented display-mode-buttons">
                  <button type="button" className={displayMode === 'contain' ? 'active' : ''} aria-pressed={displayMode === 'contain'} onClick={() => changeDisplayMode('contain')}>完整画面</button>
                  <button type="button" className={displayMode === 'cover' ? 'active' : ''} aria-pressed={displayMode === 'cover'} onClick={() => changeDisplayMode('cover')}>放大填充</button>
                  <button type="button" onClick={resetPicture}>重置画面</button>
                </div>
              </div>
              <div className="control-group compact">
                <button type="button" className={isMirrored ? 'active mirror-button' : 'mirror-button'} aria-pressed={isMirrored} onClick={toggleMirror}>镜像</button>
                <button type="button" onClick={() => void enterFullscreen()}>全屏</button>
              </div>
              <div className="control-group volume-group">
                <button type="button" onClick={toggleMute}>{isMuted || volume === 0 ? '取消静音' : '静音'}</button>
                <input aria-label="音量" type="range" min="0" max="1" step="0.05" value={volume} onChange={changeVolume} />
              </div>
            </div>
            {canDragPortrait && <p className="drag-hint">拖动画面可查看不同身体部位</p>}
          </>
        )}

        {error && <p className="error-message" role="alert">{error}</p>}
        <p className="shortcut-hint"><strong>快捷键</strong> Space 播放/暂停 · ←/→ 回退或前进 2 秒 · M 镜像</p>
      </section>
    </main>
  )
}

export default App
