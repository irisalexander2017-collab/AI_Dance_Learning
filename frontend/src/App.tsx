import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  beatDuration,
  beatPointAtStep,
  buildLearningSegments,
  getPracticeRange,
  nearestBeatPoint,
  PracticeRangeMode,
  videoStorageKey,
} from './practice/beatTimeline'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const ALLOWED_EXTENSIONS = ['mp4', 'mov', 'webm']
const SPEEDS = [0.5, 0.65, 0.8, 1] as const
type VideoOrientation = 'landscape' | 'portrait' | 'square'
type DisplayMode = 'contain' | 'cover'
type PlaybackMode = 'loop' | 'continuous'
type SidebarSide = 'left' | 'right'
type PanPosition = { x: number; y: number }

interface SavedPracticeState {
  bpm: number
  firstBeatTime: number | null
  rawFormalStartTime: number | null
  formalStartTime: number | null
  formalStartLabel: string
  currentSegmentIndex: number
  rangeMode: PracticeRangeMode
  playbackMode: PlaybackMode
}

const DEFAULT_PRACTICE_STATE: SavedPracticeState = {
  bpm: 100,
  firstBeatTime: null,
  rawFormalStartTime: null,
  formalStartTime: null,
  formalStartLabel: '',
  currentSegmentIndex: 0,
  rangeMode: 'current',
  playbackMode: 'loop',
}
const CENTER_PAN: PanPosition = { x: 50, y: 50 }

function readStoredNumber(key: string, fallback: number) {
  const stored = localStorage.getItem(key)
  const value = stored === null ? NaN : Number(stored)
  return Number.isFinite(value) ? value : fallback
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function readPracticeState(key: string): SavedPracticeState {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '') as Partial<SavedPracticeState>
    return {
      ...DEFAULT_PRACTICE_STATE,
      ...stored,
      playbackMode: stored.playbackMode === 'continuous' ? 'continuous' : 'loop',
    }
  } catch {
    return DEFAULT_PRACTICE_STATE
  }
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoStageRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; pan: PanPosition } | null>(null)
  const loopTimerRef = useRef<number | null>(null)
  const loopPendingRef = useRef(false)
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [practiceStorageKey, setPracticeStorageKey] = useState('')
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
  const [displayMode, setDisplayMode] = useState<DisplayMode>('contain')
  const [portraitPan, setPortraitPan] = useState<PanPosition>(CENTER_PAN)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [sidebarSide, setSidebarSide] = useState<SidebarSide>(() => localStorage.getItem('adl-fullscreen-sidebar-side') === 'left' ? 'left' : 'right')
  const [setupExpanded, setSetupExpanded] = useState(true)
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
  const [bpmInput, setBpmInput] = useState('100')
  const [bpm, setBpm] = useState(100)
  const [bpmError, setBpmError] = useState('')
  const [firstBeatTime, setFirstBeatTime] = useState<number | null>(null)
  const [rawFormalStartTime, setRawFormalStartTime] = useState<number | null>(null)
  const [formalCandidate, setFormalCandidate] = useState<{ time: number; label: string; delta: number } | null>(null)
  const [formalStartTime, setFormalStartTime] = useState<number | null>(null)
  const [formalStartLabel, setFormalStartLabel] = useState('')
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0)
  const [rangeMode, setRangeMode] = useState<PracticeRangeMode>('current')
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop')
  const [isLoopWaiting, setIsLoopWaiting] = useState(false)

  const renderDisplayMode: DisplayMode = isFullscreen && orientation === 'portrait' ? 'contain' : displayMode
  const canDragPortrait = orientation === 'portrait' && displayMode === 'cover' && !isFullscreen
  const learningSegments = useMemo(() => (
    firstBeatTime === null || formalStartTime === null || !duration
      ? [] : buildLearningSegments(duration, formalStartTime, firstBeatTime, bpm)
  ), [bpm, duration, firstBeatTime, formalStartTime])
  const safeSegmentIndex = Math.min(currentSegmentIndex, Math.max(0, learningSegments.length - 1))
  const practiceRange = useMemo(() => getPracticeRange(rangeMode, learningSegments, safeSegmentIndex, duration), [duration, learningSegments, rangeMode, safeSegmentIndex])

  const cancelPendingLoop = useCallback(() => {
    if (loopTimerRef.current !== null) window.clearTimeout(loopTimerRef.current)
    loopTimerRef.current = null
    loopPendingRef.current = false
    setIsLoopWaiting(false)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(); return response.json() })
      .then((data) => setBackendConnected(data.status === 'ok'))
      .catch(() => setBackendConnected(false))
    return () => controller.abort()
  }, [])

  useEffect(() => () => {
    cancelPendingLoop()
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [cancelPendingLoop])

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === playerRef.current)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    if (!settingsDrawerOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsDrawerOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [settingsDrawerOpen])

  useEffect(() => {
    if (!practiceStorageKey) return
    localStorage.setItem(practiceStorageKey, JSON.stringify({
      bpm, firstBeatTime, rawFormalStartTime, formalStartTime, formalStartLabel,
      currentSegmentIndex: safeSegmentIndex, rangeMode, playbackMode,
    } satisfies SavedPracticeState))
  }, [bpm, firstBeatTime, formalStartLabel, formalStartTime, playbackMode, practiceStorageKey, rangeMode, rawFormalStartTime, safeSegmentIndex])

  const seekBy = useCallback((seconds: number) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) return
    cancelPendingLoop()
    video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + seconds))
  }, [cancelPendingLoop])

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current
    if (!videoUrl || !video) return
    if (!video.paused || isLoopWaiting) {
      cancelPendingLoop()
      video.pause()
      return
    }
    try {
      if (video.currentTime >= practiceRange.endTime - 0.04 || video.currentTime < practiceRange.startTime) video.currentTime = practiceRange.startTime
      await video.play()
      setError('')
    } catch {
      setError('无法播放此视频。请确认文件格式受浏览器支持。')
    }
  }, [cancelPendingLoop, isLoopWaiting, practiceRange.endTime, practiceRange.startTime, videoUrl])

  const changeSegment = useCallback((index: number) => {
    if (!learningSegments.length) return
    cancelPendingLoop()
    const nextIndex = Math.min(Math.max(0, index), learningSegments.length - 1)
    setCurrentSegmentIndex(nextIndex)
    const nextRange = getPracticeRange(rangeMode, learningSegments, nextIndex, duration)
    if (videoRef.current) videoRef.current.currentTime = nextRange.startTime
  }, [cancelPendingLoop, duration, learningSegments, rangeMode])

  const changePlaybackMode = useCallback((mode: PlaybackMode) => {
    cancelPendingLoop()
    setPlaybackMode(mode)
  }, [cancelPendingLoop])

  const handleTimeUpdate = (video: HTMLVideoElement) => {
    setCurrentTime(video.currentTime)
    if (!learningSegments.length || video.paused || loopPendingRef.current || video.currentTime < practiceRange.endTime - 0.04) return
    if (playbackMode === 'continuous') {
      if (rangeMode === 'current' && safeSegmentIndex < learningSegments.length - 1) {
        const nextIndex = safeSegmentIndex + 1
        setCurrentSegmentIndex(nextIndex)
        video.currentTime = learningSegments[nextIndex].startTime
      } else {
        video.pause()
        video.currentTime = practiceRange.endTime
      }
      return
    }
    loopPendingRef.current = true
    video.pause()
    setIsLoopWaiting(true)
    loopTimerRef.current = window.setTimeout(() => {
      loopTimerRef.current = null
      loopPendingRef.current = false
      setIsLoopWaiting(false)
      video.currentTime = practiceRange.startTime
      void video.play().catch(() => setError('循环播放无法自动继续，请点击播放。'))
    }, 2000)
  }

  const toggleMirror = useCallback(() => {
    setIsMirrored((current) => {
      localStorage.setItem('adl-mirrored', String(!current))
      return !current
    })
  }, [])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement === playerRef.current) await document.exitFullscreen()
      else await playerRef.current?.requestFullscreen()
    } catch {
      setError('浏览器无法切换全屏模式。')
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return
      const key = event.key.toLowerCase()
      if (event.code === 'Space') { event.preventDefault(); void togglePlayback() }
      else if (event.code === 'ArrowLeft') { event.preventDefault(); seekBy(-2) }
      else if (event.code === 'ArrowRight') { event.preventDefault(); seekBy(2) }
      else if (event.code === 'ArrowUp') { event.preventDefault(); changeSegment(safeSegmentIndex - 1) }
      else if (event.code === 'ArrowDown') { event.preventDefault(); changeSegment(safeSegmentIndex + 1) }
      else if (key === 'm') { event.preventDefault(); toggleMirror() }
      else if (key === 'l') { event.preventDefault(); changePlaybackMode(playbackMode === 'loop' ? 'continuous' : 'loop') }
      else if (key === 'f') { event.preventDefault(); void toggleFullscreen() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [changePlaybackMode, changeSegment, playbackMode, safeSegmentIndex, seekBy, toggleFullscreen, toggleMirror, togglePlayback])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setError('不支持此文件格式。请选择 MP4、MOV 或 WebM 视频。')
      event.target.value = ''
      return
    }
    cancelPendingLoop()
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const storageKey = videoStorageKey(file)
    const saved = readPracticeState(storageKey)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setVideoUrl(url); setFileName(file.name); setFileSize(file.size); setPracticeStorageKey(storageKey)
    setBpm(saved.bpm); setBpmInput(String(saved.bpm)); setFirstBeatTime(saved.firstBeatTime)
    setRawFormalStartTime(saved.rawFormalStartTime); setFormalStartTime(saved.formalStartTime); setFormalStartLabel(saved.formalStartLabel)
    setFormalCandidate(null); setCurrentSegmentIndex(saved.currentSegmentIndex); setRangeMode(saved.rangeMode); setPlaybackMode(saved.playbackMode)
    setPortraitPan(CENTER_PAN); setDisplayMode('contain')
    setSetupExpanded(saved.formalStartTime === null); setSettingsDrawerOpen(saved.formalStartTime === null); setDuration(0); setCurrentTime(0); setIsPlaying(false); setOrientation('landscape'); setError('')
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = speed; video.volume = volume
    setOrientation(video.videoWidth === video.videoHeight ? 'square' : video.videoWidth > video.videoHeight ? 'landscape' : 'portrait')
    setDisplayMode('contain'); setPortraitPan(CENTER_PAN)
    setDuration(video.duration)
    setError('')
  }

  const changeDisplayMode = (mode: DisplayMode) => {
    setDisplayMode(mode)
    setPortraitPan(CENTER_PAN)
  }

  const getCoverOverflow = () => {
    const video = videoRef.current
    const stage = videoStageRef.current
    if (!video?.videoWidth || !video.videoHeight || !stage) return { x: 0, y: 0 }
    const scale = Math.max(stage.clientWidth / video.videoWidth, stage.clientHeight / video.videoHeight)
    return { x: Math.max(0, video.videoWidth * scale - stage.clientWidth), y: Math.max(0, video.videoHeight * scale - stage.clientHeight) }
  }

  const clampPan = (position: PanPosition) => {
    const overflow = getCoverOverflow()
    return { x: overflow.x ? Math.min(100, Math.max(0, position.x)) : 50, y: overflow.y ? Math.min(100, Math.max(0, position.y)) : 50 }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canDragPortrait) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, pan: portraitPan }
  }
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!canDragPortrait || !drag || drag.pointerId !== event.pointerId) return
    const overflow = getCoverOverflow()
    const nextPan = clampPan({
      x: overflow.x ? drag.pan.x + (isMirrored ? event.clientX - drag.startX : drag.startX - event.clientX) / overflow.x * 100 : 50,
      y: overflow.y ? drag.pan.y + (drag.startY - event.clientY) / overflow.y * 100 : 50,
    })
    setPortraitPan(nextPan)
  }
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const resnapFormalStart = (nextBpm: number, nextFirstBeat: number) => {
    if (rawFormalStartTime === null) return
    const snapped = nearestBeatPoint(rawFormalStartTime, nextFirstBeat, nextBpm)
    setFormalCandidate({ time: snapped.time, label: snapped.label, delta: snapped.time - rawFormalStartTime })
    if (formalStartTime !== null) { setFormalStartTime(Math.min(duration, Math.max(0, snapped.time))); setFormalStartLabel(snapped.label) }
  }
  const applyBpm = () => {
    const next = Number(bpmInput)
    if (!Number.isFinite(next) || next < 40 || next > 240) { setBpmError('请输入 40–240 之间的 BPM。'); return }
    setBpm(next); setBpmError(''); if (firstBeatTime !== null) resnapFormalStart(next, firstBeatTime)
  }
  const markFirstBeat = () => {
    const time = videoRef.current?.currentTime ?? 0
    setFirstBeatTime(time); resnapFormalStart(bpm, time)
  }
  const adjustFirstBeat = (beats: number) => {
    if (firstBeatTime === null) return
    const next = Math.min(duration, Math.max(0, firstBeatTime + beatDuration(bpm) * beats))
    setFirstBeatTime(next); resnapFormalStart(bpm, next)
  }
  const markFormalStart = () => {
    if (firstBeatTime === null) { setError('请先标记音乐第一拍。'); return }
    const raw = videoRef.current?.currentTime ?? 0
    const snapped = nearestBeatPoint(raw, firstBeatTime, bpm)
    setRawFormalStartTime(raw); setFormalCandidate({ time: Math.min(duration, Math.max(0, snapped.time)), label: snapped.label, delta: snapped.time - raw })
  }
  const adjustFormalCandidate = (halfSteps: number) => {
    if (!formalCandidate || firstBeatTime === null) return
    const current = nearestBeatPoint(formalCandidate.time, firstBeatTime, bpm)
    const next = beatPointAtStep(firstBeatTime, bpm, current.halfStep + halfSteps)
    setFormalCandidate({ time: Math.min(duration, Math.max(0, next.time)), label: next.label, delta: rawFormalStartTime === null ? 0 : next.time - rawFormalStartTime })
  }
  const confirmFormalStart = () => {
    if (!formalCandidate) return
    cancelPendingLoop(); setFormalStartTime(formalCandidate.time); setFormalStartLabel(formalCandidate.label)
    setCurrentSegmentIndex(0); setRangeMode('current'); setSetupExpanded(false)
    if (videoRef.current) videoRef.current.currentTime = formalCandidate.time
  }
  const selectPracticeRange = (mode: PracticeRangeMode) => {
    cancelPendingLoop(); setRangeMode(mode)
    if (videoRef.current) videoRef.current.currentTime = getPracticeRange(mode, learningSegments, safeSegmentIndex, duration).startTime
  }
  const changeSpeed = (next: number) => {
    if (videoRef.current) videoRef.current.playbackRate = next
    setSpeed(next); localStorage.setItem('adl-playback-speed', String(next))
  }
  const changeVolume = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value)
    if (videoRef.current) { videoRef.current.volume = next; if (next > 0) videoRef.current.muted = false }
    setVolume(next); setIsMuted(next === 0); localStorage.setItem('adl-volume', String(next))
  }
  const toggleMute = () => {
    if (!videoRef.current) return
    videoRef.current.muted = !videoRef.current.muted; setIsMuted(videoRef.current.muted)
  }
  const setSide = (side: SidebarSide) => { setSidebarSide(side); localStorage.setItem('adl-fullscreen-sidebar-side', side) }
  const resetPicture = () => {
    setDisplayMode('contain')
    setPortraitPan(CENTER_PAN)
  }

  const rangeButtons = (compact = false) => (
    <div className={compact ? 'sidebar-range-buttons' : 'practice-range-buttons'}>
      <button type="button" className={rangeMode === 'current' ? 'active' : ''} onClick={() => selectPracticeRange('current')}>当前段</button>
      <button type="button" disabled={safeSegmentIndex === 0} className={rangeMode === 'previous-current' ? 'active' : ''} onClick={() => selectPracticeRange('previous-current')}>前一段＋当前段</button>
      <button type="button" className={rangeMode === 'from-start' ? 'active' : ''} onClick={() => selectPracticeRange('from-start')}>从起点到当前</button>
      <button type="button" className={rangeMode === 'full' ? 'active' : ''} onClick={() => selectPracticeRange('full')}>完整舞蹈</button>
    </div>
  )

  return (
    <main className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">LOCAL PRACTICE TOOL</p><h1>AI Dance Learning</h1><p className="tagline">Turn dance videos into simple 8-count practice sessions.</p></div>
        <div className="service-status"><span className="status"><span className="dot online" />Frontend running</span><span className="status"><span className={`dot ${backendConnected ? 'online' : backendConnected === false ? 'offline' : 'checking'}`} />{backendConnected === null ? 'Checking backend…' : backendConnected ? 'Backend connected' : 'Backend unavailable'}</span></div>
      </header>
      <section className="workspace">
        {!videoUrl ? (
          <label className="upload-panel"><span className="upload-icon">＋</span><strong>选择舞蹈视频</strong><span>MP4、MOV 或 WebM</span><input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={handleFileChange} /></label>
        ) : <>
          <div ref={playerRef} className={`player-frame ${orientation}`}>
            <div ref={videoStageRef} className={`video-stage${canDragPortrait ? ' draggable-stage' : ''}`}
              onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd}>
              <video key={videoUrl} ref={videoRef} className={`${orientation}${canDragPortrait ? ' draggable-video' : ''}`}
                style={{
                  objectFit: renderDisplayMode,
                  objectPosition: canDragPortrait ? `${portraitPan.x}% ${portraitPan.y}%` : '50% 50%',
                  transform: isMirrored ? 'scaleX(-1)' : 'scaleX(1)',
                }} src={videoUrl} preload="metadata" playsInline draggable={false}
                onLoadedMetadata={handleLoadedMetadata} onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} onError={() => setError('视频加载失败。此文件可能损坏，或编码不受当前浏览器支持。')}
              />
            </div>
            <div className="video-quick-controls" aria-label="常用画面控制">
              <button type="button" className={isMirrored ? 'active' : ''} onClick={toggleMirror}>镜像</button>
              <button type="button" onClick={() => setSettingsDrawerOpen(true)}>练习设置</button>
              <button type="button" onClick={() => void toggleFullscreen()}>全屏</button>
            </div>
            <div className="timeline-row"><span>{formatTime(currentTime)}</span><input aria-label="视频进度" type="range" min="0" max={duration || 0} step="0.01" value={Math.min(currentTime, duration || 0)} onChange={(event) => { cancelPendingLoop(); if (videoRef.current) videoRef.current.currentTime = Number(event.target.value) }} /><span>{formatTime(duration)}</span></div>
            <div className="fullscreen-status">第 {safeSegmentIndex + 1} 段 · {playbackMode === 'loop' ? '循环练习' : '连续播放'} · {speed}×</div>
            <aside className={`fullscreen-sidebar ${sidebarSide} ${sidebarExpanded ? 'expanded' : 'collapsed'}`}>
              <button type="button" aria-label="展开或收起控制栏" onClick={() => setSidebarExpanded((value) => !value)}>{sidebarExpanded ? '收起' : '☰'}</button>
              <button type="button" onClick={() => void togglePlayback()}>{isLoopWaiting ? '取消等待' : isPlaying ? '暂停' : '播放'}</button>
              <button type="button" disabled={safeSegmentIndex === 0} onClick={() => changeSegment(safeSegmentIndex - 1)}>上一段</button>
              <button type="button" disabled={safeSegmentIndex === learningSegments.length - 1} onClick={() => changeSegment(safeSegmentIndex + 1)}>下一段</button>
              <button type="button" className={playbackMode === 'loop' ? 'active' : ''} onClick={() => changePlaybackMode(playbackMode === 'loop' ? 'continuous' : 'loop')}>{playbackMode === 'loop' ? '循环' : '连续'}</button>
              {sidebarExpanded && <div className="sidebar-expanded-controls">
                {rangeButtons(true)}
                <div className="sidebar-speed-buttons">{SPEEDS.map((value) => <button type="button" key={value} className={speed === value ? 'active' : ''} onClick={() => changeSpeed(value)}>{value}×</button>)}</div>
                <button type="button" className={isMirrored ? 'active' : ''} onClick={toggleMirror}>镜像</button>
                <button type="button" className={renderDisplayMode === 'contain' ? 'active' : ''} onClick={() => changeDisplayMode('contain')}>完整画面</button>
                <button type="button" className={renderDisplayMode === 'cover' ? 'active' : ''} onClick={() => changeDisplayMode('cover')}>放大填充</button>
                <button type="button" onClick={resetPicture}>重置画面</button>
                <button type="button" onClick={() => setSide(sidebarSide === 'left' ? 'right' : 'left')}>移到{sidebarSide === 'left' ? '右' : '左'}侧</button>
              </div>}
              <button type="button" onClick={() => void toggleFullscreen()}>退出全屏</button>
            </aside>
          </div>

          <div className="practice-controls">
            <button type="button" onClick={() => seekBy(-2)}>回看 2 秒</button>
            <button type="button" disabled={!learningSegments.length || safeSegmentIndex === 0} onClick={() => changeSegment(safeSegmentIndex - 1)}>上一段</button>
            <button type="button" className="play-button" onClick={() => void togglePlayback()}>{isLoopWaiting ? '取消循环等待' : isPlaying ? '暂停' : '播放'}</button>
            <button type="button" disabled={!learningSegments.length || safeSegmentIndex === learningSegments.length - 1} onClick={() => changeSegment(safeSegmentIndex + 1)}>下一段</button>
            <button type="button" onClick={() => seekBy(2)}>前进 2 秒</button>
          </div>

          <div className="file-row"><div><strong>{fileName}</strong><span>{formatFileSize(fileSize)} · {formatTime(duration)}</span></div><label className="replace-button">更换视频<input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={handleFileChange} /></label></div>

          {settingsDrawerOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsDrawerOpen(false) }}>
            <aside className="settings-drawer" role="dialog" aria-modal="true" aria-label="练习设置">
              <div className="drawer-header"><div><p className="panel-kicker">PRACTICE</p><h2>练习设置</h2></div><button type="button" className="drawer-close" aria-label="关闭练习设置" onClick={() => setSettingsDrawerOpen(false)}>×</button></div>

              {learningSegments.length > 0 ? <section className="drawer-section">
                <h3>学习段</h3>
                <strong>第 {safeSegmentIndex + 1} 段 · {learningSegments[safeSegmentIndex].startBeat} → {learningSegments[safeSegmentIndex].endBeat}</strong>
                <div className="segment-list">{learningSegments.map((segment, index) => <button type="button" key={segment.segmentIndex} className={safeSegmentIndex === index ? 'active' : ''} onClick={() => changeSegment(index)}>第 {segment.segmentIndex} 段{segment.incomplete ? ' · 不足 8 拍' : ''}</button>)}</div>
              </section> : <p className="drawer-empty">完成节拍与正式起点设置后，将在这里生成学习段。</p>}

              {learningSegments.length > 0 && <>
                <section className="drawer-section"><h3>练习范围</h3>{rangeButtons()}</section>
                <section className="drawer-section"><h3>播放模式</h3><div className="playback-mode-buttons"><button type="button" className={playbackMode === 'loop' ? 'active' : ''} onClick={() => changePlaybackMode('loop')}>循环练习 · 停 2 秒</button><button type="button" className={playbackMode === 'continuous' ? 'active' : ''} onClick={() => changePlaybackMode('continuous')}>连续播放</button></div></section>
              </>}

              <section className="drawer-section"><h3>播放速度</h3><div className="segmented">{SPEEDS.map((value) => <button type="button" key={value} className={speed === value ? 'active' : ''} onClick={() => changeSpeed(value)}>{value}×</button>)}</div></section>
              <section className="drawer-section"><h3>画面与声音</h3><div className="drawer-control-grid">
                <button type="button" className={isMirrored ? 'active' : ''} onClick={toggleMirror}>镜像</button>
                <button type="button" className={displayMode === 'contain' ? 'active' : ''} onClick={() => changeDisplayMode('contain')}>完整画面</button>
                <button type="button" className={displayMode === 'cover' ? 'active' : ''} onClick={() => changeDisplayMode('cover')}>放大填充</button>
                <button type="button" onClick={resetPicture}>重置画面</button>
                <button type="button" onClick={toggleMute}>{isMuted || volume === 0 ? '取消静音' : '静音'}</button>
              </div><input aria-label="音量" type="range" min="0" max="1" step="0.05" value={volume} onChange={changeVolume} /></section>

              <section className={`setup-panel drawer-setup ${setupExpanded ? 'open' : ''}`}>
                <button type="button" className="setup-toggle" onClick={() => setSetupExpanded((value) => !value)}>{formalStartTime === null ? '设置节拍与分段' : '重新设置分段'} <span>{setupExpanded ? '收起' : '展开'}</span></button>
                {setupExpanded && <div className="setup-grid">
                  <div className="setup-block"><label htmlFor="bpm-input">BPM</label><div className="inline-controls"><input id="bpm-input" type="number" min="40" max="240" value={bpmInput} onChange={(event) => setBpmInput(event.target.value)} /><button type="button" onClick={applyBpm}>应用</button></div>{bpmError && <span className="field-error">{bpmError}</span>}</div>
                  <div className="setup-block"><strong>音乐第一拍</strong><button type="button" className="accent-button" onClick={markFirstBeat}>{firstBeatTime === null ? '这里是音乐的 1' : '重新标记音乐的 1'}</button>{firstBeatTime !== null && <span className="setting-result">音乐 1：{formatTime(firstBeatTime)} ({firstBeatTime.toFixed(3)}s)</span>}<div className="mini-buttons"><button type="button" disabled={firstBeatTime === null} onClick={() => adjustFirstBeat(-0.5)}>前半拍</button><button type="button" disabled={firstBeatTime === null} onClick={() => adjustFirstBeat(.5)}>后半拍</button><button type="button" disabled={firstBeatTime === null} onClick={() => adjustFirstBeat(-1)}>前一拍</button><button type="button" disabled={firstBeatTime === null} onClick={() => adjustFirstBeat(1)}>后一拍</button></div></div>
                  <div className="setup-block"><strong>正式编舞起点</strong><button type="button" className="accent-button" onClick={markFormalStart}>正式编舞从这里开始</button>{formalCandidate && <div className="candidate-result"><b>吸附到 {formalCandidate.label}</b><span>{formalCandidate.time.toFixed(3)}s · 相差 {formalCandidate.delta >= 0 ? '+' : ''}{formalCandidate.delta.toFixed(3)}s</span></div>}<div className="mini-buttons"><button type="button" disabled={!formalCandidate} onClick={() => adjustFormalCandidate(-1)}>前半拍</button><button type="button" disabled={!formalCandidate} onClick={() => adjustFormalCandidate(1)}>后半拍</button><button type="button" disabled={!formalCandidate} onClick={markFormalStart}>重标</button><button type="button" className="confirm-button" disabled={!formalCandidate} onClick={confirmFormalStart}>确认</button></div>{formalStartTime !== null && <span className="setting-result">已确认：{formalStartLabel} · {formalStartTime.toFixed(3)}s</span>}</div>
                </div>}
              </section>
            </aside>
          </div>}
        </>}
        {error && <p className="error-message" role="alert">{error}</p>}
        <p className="shortcut-hint"><strong>快捷键</strong> Space 播放/暂停 · ←/→ 2 秒 · ↑/↓ 切段 · M 镜像 · L 循环/连续 · F 全屏</p>
      </section>
    </main>
  )
}

export default App
