import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  beatDuration,
  beatPointAtStep,
  buildLearningSegments,
  getPreparationRange,
  getPracticeRange,
  nearestBeatPoint,
  PracticeRangeMode,
  videoStorageKey,
} from './practice/beatTimeline'

const ALLOWED_EXTENSIONS = ['mp4', 'mov', 'webm']
const SPEEDS = [0.5, 0.65, 0.8, 1] as const
type VideoOrientation = 'landscape' | 'portrait' | 'square'
type DisplayMode = 'contain' | 'cover'
type PlaybackMode = 'loop' | 'continuous'
type SidebarSide = 'left' | 'right'
type TeacherFraming = { zoom: number; panX: number; panY: number }
type UiLanguage = 'zh' | 'en'

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
const DEFAULT_TEACHER_FRAMING: TeacherFraming = { zoom: 1, panX: 0, panY: 0 }
const MIN_TEACHER_ZOOM = 1
const MAX_TEACHER_ZOOM = 3
const TEACHER_ZOOM_STEP = 0.25

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

function LandingPage({ onStart, language, setLanguage }: { onStart: () => void; language: UiLanguage; setLanguage: (language: UiLanguage) => void }) {
  const [guideOpen, setGuideOpen] = useState(false)
  const text = (zh: string, en: string) => language === 'zh' ? zh : en

  useEffect(() => {
    if (!guideOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGuideOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [guideOpen])

  const guideSteps = language === 'zh' ? [
    ['上传舞蹈视频', '选择本地 MP4、MOV 或 WebM。视频只在浏览器中打开，不会上传。'],
    ['设置节拍与起点', '输入 BPM，拖动进度条标记音乐第一拍，再标记并确认正式编舞起点。'],
    ['选择分段练习方式', '练习预备段＋第1段、当前段、前一段＋当前段、从起点到当前或完整舞蹈；可循环停 2 秒或连续播放。'],
    ['控制播放', '使用播放、暂停、回看 2 秒、前进 2 秒、四档速度、教师镜像和全屏。'],
    ['与摄像头对比', '打开摄像头后，教师与自己同时显示。自己的画面默认镜像；摄像头只在本机显示，不上传、不录制。点击“关闭摄像头”即可结束并关闭设备。'],
    ['调整教师画面', '使用“适应、−、＋、重置”缩放教师视频。放大后可向左、右、上、下拖动；普通/全屏、单画面/摄像头分屏均可使用，只有教师视频移动。'],
  ] : [
    ['Upload a dance video', 'Choose a local MP4, MOV, or WebM file. The video opens only in your browser and is not uploaded.'],
    ['Set the beat and start point', 'Enter the BPM, drag the timeline to mark beat one, then mark and confirm the choreography start.'],
    ['Choose how to practise sections', 'Practise the preparation lead-in plus section 1, current section, previous plus current, start to current, or full dance. Use a two-second loop pause or continuous playback.'],
    ['Control playback', 'Play, pause, go back 2 seconds, go forward 2 seconds, choose a speed, mirror the teacher, or enter fullscreen.'],
    ['Compare with your camera', 'Show the teacher and yourself together. Your self-view is mirrored by default. Camera video stays on this device and is never uploaded or recorded. Select “Turn camera off” to stop the camera.'],
    ['Reframe the teacher video', 'Use Fit, −, +, and Reset. After zooming, drag left, right, up, or down in normal or fullscreen, in single or camera comparison mode. Only the teacher video moves.'],
  ]

  return (
    <main className="landing-shell">
      <section className="cover-hero">
        <img className="cover-artwork" src={`${import.meta.env.BASE_URL}image/branding/frametune-hero-streetdance.png`} alt={text('帧琢 FrameTune 街舞练习品牌主视觉，展现舞者连续动作轨迹', 'FrameTune brand artwork showing a street dancer through a sequence of movement trails')} />
        <div className="cover-controls">
          <span className="cover-beta">{text('测试版', 'Beta')}</span>
          <div className="language-switch" aria-label="Language">
            <button type="button" className={language === 'zh' ? 'active' : ''} aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
            <span aria-hidden="true">/</span>
            <button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
          </div>
          <button type="button" className="guide-button" onClick={() => setGuideOpen(true)}>{language === 'zh' ? '使用说明' : 'How it works'}</button>
        </div>
        <button type="button" className="cover-start-button" onClick={onStart}>{language === 'zh' ? '开始练习' : 'Start practicing'}<span aria-hidden="true">→</span></button>
      </section>

      {guideOpen && <div className="guide-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGuideOpen(false) }}>
        <section className="usage-guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
          <header><div><p>FRAMETUNE GUIDE</p><h2 id="guide-title">{language === 'zh' ? '如何使用帧琢' : 'How to use FrameTune'}</h2></div><button type="button" className="guide-close" aria-label={language === 'zh' ? '关闭' : 'Close'} onClick={() => setGuideOpen(false)}>×<span>{language === 'zh' ? '关闭' : 'Close'}</span></button></header>
          <ol>{guideSteps.map(([title, description], index) => <li key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol>
        </section>
      </div>}
    </main>
  )
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraVideoRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const cameraRequestRef = useRef(0)
  const videoStageRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const practiceControlsRef = useRef<HTMLDivElement>(null)
  const settingsDrawerRef = useRef<HTMLElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null)
  const loopTimerRef = useRef<number | null>(null)
  const loopPendingRef = useRef(false)
  const [showLanding, setShowLanding] = useState(true)
  const [language, setLanguage] = useState<UiLanguage>(() => localStorage.getItem('frametune-language') === 'en' ? 'en' : 'zh')
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
  const [singleTeacherFraming, setSingleTeacherFraming] = useState<TeacherFraming>(DEFAULT_TEACHER_FRAMING)
  const [splitTeacherFraming, setSplitTeacherFraming] = useState<TeacherFraming>(DEFAULT_TEACHER_FRAMING)
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
  const [compareMode, setCompareMode] = useState(false)
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'loading' | 'active' | 'error'>('idle')
  const [cameraMessage, setCameraMessage] = useState('')
  const [mirrorSelfView, setMirrorSelfView] = useState(true)
  const [, setTeacherViewportRevision] = useState(0)
  const text = (zh: string, en: string) => language === 'zh' ? zh : en

  const renderDisplayMode: DisplayMode = compareMode || (isFullscreen && orientation === 'portrait') ? 'contain' : displayMode
  const teacherFraming = compareMode ? splitTeacherFraming : singleTeacherFraming
  const canPanTeacher = teacherFraming.zoom > MIN_TEACHER_ZOOM || (!compareMode && renderDisplayMode === 'cover')
  const learningSegments = useMemo(() => (
    firstBeatTime === null || formalStartTime === null || !duration
      ? [] : buildLearningSegments(duration, formalStartTime, firstBeatTime, bpm)
  ), [bpm, duration, firstBeatTime, formalStartTime])
  const safeSegmentIndex = Math.min(currentSegmentIndex, Math.max(0, learningSegments.length - 1))
  const preparationRange = useMemo(() => getPreparationRange(learningSegments, bpm), [bpm, learningSegments])
  const practiceRange = useMemo(() => getPracticeRange(rangeMode, learningSegments, safeSegmentIndex, duration, bpm), [bpm, duration, learningSegments, rangeMode, safeSegmentIndex])

  const cancelPendingLoop = useCallback(() => {
    if (loopTimerRef.current !== null) window.clearTimeout(loopTimerRef.current)
    loopTimerRef.current = null
    loopPendingRef.current = false
    setIsLoopWaiting(false)
  }, [])

  useEffect(() => {
    localStorage.setItem('frametune-language', language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    setError('')
    setBpmError('')
    if (cameraStatus === 'loading') setCameraMessage(language === 'zh' ? '正在启动摄像头…' : 'Starting camera…')
    else if (cameraStatus === 'error') setCameraMessage(language === 'zh' ? '摄像头不可用。请关闭后重试。' : 'Camera unavailable. Turn it off and try again.')
  }, [language])

  useEffect(() => () => {
    cancelPendingLoop()
    cameraRequestRef.current += 1
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [cancelPendingLoop])

  useEffect(() => {
    const cameraVideo = cameraVideoRef.current
    const stream = cameraStreamRef.current
    if (!cameraVideo || !stream || cameraStatus !== 'active') return
    cameraVideo.srcObject = stream
    void cameraVideo.play().catch(() => setCameraMessage(text('摄像头已连接，但画面无法自动播放。', 'The camera is connected, but the self-view could not start automatically.')))
  }, [cameraStatus, compareMode, language])

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === playerRef.current)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    if (!settingsDrawerOpen) return
    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsDrawerOpen(false)
    }
    const closeOnUnrelatedClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (settingsDrawerRef.current?.contains(target)) return
      if (playerRef.current?.contains(target)) return
      if (practiceControlsRef.current?.contains(target)) return
      setSettingsDrawerOpen(false)
    }
    window.addEventListener('keydown', handleDrawerKeyDown)
    document.addEventListener('mousedown', closeOnUnrelatedClick)
    return () => {
      window.removeEventListener('keydown', handleDrawerKeyDown)
      document.removeEventListener('mousedown', closeOnUnrelatedClick)
    }
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
    const nextTime = Math.min(video.duration, Math.max(0, video.currentTime + seconds))
    video.currentTime = nextTime
    setCurrentTime(nextTime)
  }, [cancelPendingLoop])

  const pauseAndSeek = (time: number) => {
    const video = videoRef.current
    const nextTime = Math.min(duration, Math.max(0, time))
    cancelPendingLoop()
    if (video) {
      video.pause()
      video.currentTime = nextTime
    }
    setCurrentTime(nextTime)
  }

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
      setError(text('无法播放此视频。请确认文件格式受浏览器支持。', 'This video could not be played. Check that its format is supported by your browser.'))
    }
  }, [cancelPendingLoop, isLoopWaiting, language, practiceRange.endTime, practiceRange.startTime, videoUrl])

  const changeSegment = useCallback((index: number) => {
    if (!learningSegments.length) return
    cancelPendingLoop()
    const nextIndex = Math.min(Math.max(0, index), learningSegments.length - 1)
    setCurrentSegmentIndex(nextIndex)
    const nextRange = getPracticeRange(rangeMode, learningSegments, nextIndex, duration, bpm)
    if (videoRef.current) videoRef.current.currentTime = nextRange.startTime
    setCurrentTime(nextRange.startTime)
  }, [bpm, cancelPendingLoop, duration, learningSegments, rangeMode])

  const changePlaybackMode = useCallback((mode: PlaybackMode) => {
    cancelPendingLoop()
    setPlaybackMode(mode)
  }, [cancelPendingLoop])

  const handleTimeUpdate = (video: HTMLVideoElement) => {
    setCurrentTime(video.currentTime)
    if (!learningSegments.length || video.paused || loopPendingRef.current || video.currentTime < practiceRange.endTime - 0.04) return
    if (playbackMode === 'continuous') {
      if ((rangeMode === 'current' || (rangeMode === 'preparation-first' && safeSegmentIndex === 0)) && safeSegmentIndex < learningSegments.length - 1) {
        const nextIndex = safeSegmentIndex + 1
        setCurrentSegmentIndex(nextIndex)
        if (rangeMode === 'preparation-first') setRangeMode('current')
        video.currentTime = learningSegments[nextIndex].startTime
        setCurrentTime(learningSegments[nextIndex].startTime)
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
      void video.play().catch(() => setError(text('循环播放无法自动继续，请点击播放。', 'Loop playback could not resume automatically. Select Play to continue.')))
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
      setError(text('浏览器无法切换全屏模式。', 'The browser could not switch fullscreen mode.'))
    }
  }, [language])

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
      setError(text('不支持此文件格式。请选择 MP4、MOV 或 WebM 视频。', 'This file format is not supported. Choose an MP4, MOV, or WebM video.'))
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
    setSingleTeacherFraming(DEFAULT_TEACHER_FRAMING); setSplitTeacherFraming(DEFAULT_TEACHER_FRAMING); setDisplayMode('contain')
    setSetupExpanded(saved.formalStartTime === null); setSettingsDrawerOpen(saved.formalStartTime === null); setDuration(0); setCurrentTime(0); setIsPlaying(false); setOrientation('landscape'); setError('')
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = speed; video.volume = volume
    setOrientation(video.videoWidth === video.videoHeight ? 'square' : video.videoWidth > video.videoHeight ? 'landscape' : 'portrait')
    setDisplayMode('contain'); setSingleTeacherFraming(DEFAULT_TEACHER_FRAMING); setSplitTeacherFraming(DEFAULT_TEACHER_FRAMING)
    setDuration(video.duration)
    setError('')
  }

  const changeDisplayMode = (mode: DisplayMode) => {
    setDisplayMode(mode)
    setSingleTeacherFraming(DEFAULT_TEACHER_FRAMING)
  }

  const getTeacherPanBounds = (zoom: number, mode = renderDisplayMode) => {
    const video = videoRef.current
    const stage = videoStageRef.current
    if (!video?.videoWidth || !video.videoHeight || !stage?.clientWidth || !stage.clientHeight) return { x: 0, y: 0 }
    const fitScale = mode === 'cover'
      ? Math.max(stage.clientWidth / video.videoWidth, stage.clientHeight / video.videoHeight)
      : Math.min(stage.clientWidth / video.videoWidth, stage.clientHeight / video.videoHeight)
    const renderedWidth = video.videoWidth * fitScale * zoom
    const renderedHeight = video.videoHeight * fitScale * zoom
    return {
      x: Math.max(0, (renderedWidth - stage.clientWidth) / 2),
      y: Math.max(0, (renderedHeight - stage.clientHeight) / 2),
    }
  }

  const clampTeacherFraming = (framing: TeacherFraming, mode = renderDisplayMode) => {
    const zoom = Math.min(MAX_TEACHER_ZOOM, Math.max(MIN_TEACHER_ZOOM, framing.zoom))
    const bounds = getTeacherPanBounds(zoom, mode)
    return {
      zoom,
      panX: bounds.x ? Math.min(bounds.x, Math.max(-bounds.x, framing.panX)) : 0,
      panY: bounds.y ? Math.min(bounds.y, Math.max(-bounds.y, framing.panY)) : 0,
    }
  }

  const setCurrentTeacherFraming = (updater: (current: TeacherFraming) => TeacherFraming) => {
    if (compareMode) setSplitTeacherFraming((current) => clampTeacherFraming(updater(current), 'contain'))
    else setSingleTeacherFraming((current) => clampTeacherFraming(updater(current), displayMode))
  }

  const changeTeacherZoom = (delta: number) => {
    setCurrentTeacherFraming((current) => ({ ...current, zoom: Number((current.zoom + delta).toFixed(2)) }))
  }

  const fitTeacherVideo = () => {
    if (!compareMode) setDisplayMode('contain')
    setCurrentTeacherFraming(() => DEFAULT_TEACHER_FRAMING)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canPanTeacher) return
    const bounds = getTeacherPanBounds(teacherFraming.zoom)
    if (!bounds.x && !bounds.y) return
    const visibleFraming = clampTeacherFraming(teacherFraming)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: visibleFraming.panX, panY: visibleFraming.panY }
  }
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!canPanTeacher || !drag || drag.pointerId !== event.pointerId) return
    setCurrentTeacherFraming((current) => ({
      ...current,
      panX: drag.panX + event.clientX - drag.startX,
      panY: drag.panY + event.clientY - drag.startY,
    }))
  }
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  useEffect(() => {
    const stage = videoStageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setTeacherViewportRevision((revision) => revision + 1))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [compareMode, isFullscreen, videoUrl])

  const resnapFormalStart = (nextBpm: number, nextFirstBeat: number) => {
    if (rawFormalStartTime === null) return
    const snapped = nearestBeatPoint(rawFormalStartTime, nextFirstBeat, nextBpm)
    setFormalCandidate({ time: snapped.time, label: snapped.label, delta: snapped.time - rawFormalStartTime })
    if (formalStartTime !== null) { setFormalStartTime(Math.min(duration, Math.max(0, snapped.time))); setFormalStartLabel(snapped.label) }
  }
  const applyBpm = () => {
    const next = Number(bpmInput)
    if (!Number.isFinite(next) || next < 40 || next > 240) { setBpmError(text('请输入 40–240 之间的 BPM。', 'Enter a BPM between 40 and 240.')); return }
    setBpm(next); setBpmError(''); if (firstBeatTime !== null) resnapFormalStart(next, firstBeatTime)
  }
  const markFirstBeat = () => {
    const time = videoRef.current?.currentTime ?? 0
    setFirstBeatTime(time); setCurrentTime(time); resnapFormalStart(bpm, time)
  }
  const adjustFirstBeat = (beats: number) => {
    if (firstBeatTime === null) return
    const next = Math.min(duration, Math.max(0, firstBeatTime + beatDuration(bpm) * beats))
    setFirstBeatTime(next); resnapFormalStart(bpm, next); pauseAndSeek(next)
  }
  const markFormalStart = () => {
    if (firstBeatTime === null) { setError(text('请先标记音乐第一拍。', 'Mark the first musical beat before setting the choreography start.')); return }
    const raw = videoRef.current?.currentTime ?? 0
    const snapped = nearestBeatPoint(raw, firstBeatTime, bpm)
    const candidateTime = Math.min(duration, Math.max(0, snapped.time))
    setRawFormalStartTime(raw); setFormalCandidate({ time: candidateTime, label: snapped.label, delta: snapped.time - raw }); pauseAndSeek(candidateTime)
  }
  const adjustFormalCandidate = (halfSteps: number) => {
    if (!formalCandidate || firstBeatTime === null) return
    const current = nearestBeatPoint(formalCandidate.time, firstBeatTime, bpm)
    const next = beatPointAtStep(firstBeatTime, bpm, current.halfStep + halfSteps)
    const candidateTime = Math.min(duration, Math.max(0, next.time))
    setFormalCandidate({ time: candidateTime, label: next.label, delta: rawFormalStartTime === null ? 0 : next.time - rawFormalStartTime })
    pauseAndSeek(candidateTime)
  }
  const confirmFormalStart = () => {
    if (!formalCandidate) return
    cancelPendingLoop(); setFormalStartTime(formalCandidate.time); setFormalStartLabel(formalCandidate.label)
    setCurrentSegmentIndex(0); setRangeMode('current'); setSetupExpanded(false)
    pauseAndSeek(formalCandidate.time)
  }
  const selectPracticeRange = (mode: PracticeRangeMode) => {
    cancelPendingLoop(); setRangeMode(mode)
    const nextIndex = mode === 'preparation-first' ? 0 : safeSegmentIndex
    if (mode === 'preparation-first') setCurrentSegmentIndex(0)
    const nextStart = getPracticeRange(mode, learningSegments, nextIndex, duration, bpm).startTime
    if (videoRef.current) videoRef.current.currentTime = nextStart
    setCurrentTime(nextStart)
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
  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null
    setCompareMode(false)
    setCameraStatus('idle')
    setCameraMessage('')
  }, [])
  const startCamera = useCallback(async () => {
    const requestId = cameraRequestRef.current + 1
    cameraRequestRef.current = requestId
    setCompareMode(true)
    setCameraStatus('loading')
    setCameraMessage(text('正在启动摄像头…', 'Starting camera…'))
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('error')
      setCameraMessage(text('当前浏览器不支持摄像头访问。', 'This browser does not support camera access.'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      if (cameraRequestRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = stream
      setCameraStatus('active')
      setCameraMessage('')
    } catch (cameraError) {
      if (cameraRequestRef.current !== requestId) return
      const name = cameraError instanceof DOMException ? cameraError.name : ''
      setCameraStatus('error')
      setCameraMessage(name === 'NotAllowedError' || name === 'SecurityError'
        ? text('摄像头访问被拒绝。请在浏览器设置中允许摄像头权限。', 'Camera access was denied. Allow camera permission in your browser settings.')
        : name === 'NotFoundError' || name === 'DevicesNotFoundError'
          ? text('未检测到可用摄像头。', 'No available camera was detected.')
          : text('无法启动摄像头，请检查设备是否被其他程序占用。', 'The camera could not start. Check whether another app is using it.'))
    }
  }, [language])
  const toggleCompareMode = useCallback(() => {
    if (compareMode) stopCamera()
    else void startCamera()
  }, [compareMode, startCamera, stopCamera])
  const setSide = (side: SidebarSide) => { setSidebarSide(side); localStorage.setItem('adl-fullscreen-sidebar-side', side) }
  const resetPicture = () => {
    fitTeacherVideo()
  }

  const teacherFramingControls = (compact = false) => (
    <div className={`teacher-framing-controls${compact ? ' compact' : ''}`} aria-label={text('教师视频缩放与定位', 'Teacher video zoom and position')}>
      <button type="button" title={text('完整显示教师视频', 'Fit the full teacher video')} onClick={fitTeacherVideo}>{text('适应', 'Fit')}</button>
      <button type="button" title={text('缩小教师视频', 'Zoom out of the teacher video')} aria-label={text('缩小教师视频', 'Zoom out of the teacher video')} disabled={teacherFraming.zoom <= MIN_TEACHER_ZOOM} onClick={() => changeTeacherZoom(-TEACHER_ZOOM_STEP)}>−</button>
      <output aria-label={text('教师视频缩放比例', 'Teacher video zoom level')}>{teacherFraming.zoom.toFixed(2)}×</output>
      <button type="button" title={text('放大教师视频', 'Zoom in on the teacher video')} aria-label={text('放大教师视频', 'Zoom in on the teacher video')} disabled={teacherFraming.zoom >= MAX_TEACHER_ZOOM} onClick={() => changeTeacherZoom(TEACHER_ZOOM_STEP)}>＋</button>
      <button type="button" title={text('恢复完整居中画面', 'Restore the full centered view')} onClick={resetPicture}>{text('重置', 'Reset')}</button>
    </div>
  )

  const rangeButtons = (compact = false) => (
    <div className={compact ? 'sidebar-range-buttons' : 'practice-range-buttons'}>
      {preparationRange && <button type="button" className={rangeMode === 'preparation-first' ? 'active' : ''} onClick={() => selectPracticeRange('preparation-first')}>{text('预备段＋第1段', 'Lead-in + section 1')}</button>}
      <button type="button" className={rangeMode === 'current' ? 'active' : ''} onClick={() => selectPracticeRange('current')}>{text('当前段', 'Current section')}</button>
      <button type="button" disabled={safeSegmentIndex === 0} className={rangeMode === 'previous-current' ? 'active' : ''} onClick={() => selectPracticeRange('previous-current')}>{text('前一段＋当前段', 'Previous + current')}</button>
      <button type="button" className={rangeMode === 'from-start' ? 'active' : ''} onClick={() => selectPracticeRange('from-start')}>{text('从起点到当前', 'Start to current')}</button>
      <button type="button" className={rangeMode === 'full' ? 'active' : ''} onClick={() => selectPracticeRange('full')}>{text('完整舞蹈', 'Full dance')}</button>
    </div>
  )

  const visibleTeacherFraming = clampTeacherFraming(teacherFraming)

  if (showLanding) return <LandingPage onStart={() => setShowLanding(false)} language={language} setLanguage={setLanguage} />

  return (
    <main className="app-shell">
      <header className="app-header">
        <button type="button" className="workspace-brand" onClick={() => { stopCamera(); setShowLanding(true) }} aria-label={text('返回帧琢首页', 'Return to the FrameTune home page')}><strong>帧琢</strong><span>FrameTune</span><small>{text('测试版', 'Beta')}</small></button>
        <div className="workspace-header-tools"><p className="workspace-tagline">{text('逐帧精练，雕琢姿态', 'Refine every move, frame by frame.')}</p><div className="workspace-language" aria-label="Language"><button type="button" className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>中文</button><span>/</span><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button></div></div>
      </header>
      <section className="workspace">
        {!videoUrl ? (
          <label className="upload-panel"><span className="upload-icon">＋</span><strong>{text('选择舞蹈视频', 'Choose a dance video')}</strong><span>{text('MP4、MOV 或 WebM · 文件保留在本机', 'MP4, MOV, or WebM · stays on this device')}</span><input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={handleFileChange} /></label>
        ) : <>
          <div ref={playerRef} className={`player-frame ${orientation}${compareMode ? ' comparing' : ''}`}>
            <div className={`video-stage${compareMode ? ' compare-mode' : ''}`}>
              <div ref={videoStageRef} className={`teacher-video-panel${canPanTeacher ? ' draggable-stage' : ''}`}
                onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd}>
                <video key={videoUrl} ref={videoRef} className={`${orientation}${canPanTeacher ? ' draggable-video' : ''}`}
                  style={{
                    objectFit: renderDisplayMode,
                    objectPosition: '50% 50%',
                    transform: `translate3d(${visibleTeacherFraming.panX}px, ${visibleTeacherFraming.panY}px, 0) scale(${visibleTeacherFraming.zoom}) scaleX(${isMirrored ? -1 : 1})`,
                  }} src={videoUrl} preload="metadata" playsInline draggable={false}
                  onLoadedMetadata={handleLoadedMetadata} onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} onError={() => setError(text('视频加载失败。此文件可能损坏，或编码不受当前浏览器支持。', 'The video could not be loaded. It may be damaged or use a codec that this browser does not support.'))}
                />
                {compareMode && <span className="panel-label">{text('教师视频', 'Teacher video')}</span>}
              </div>
              {compareMode && <div className="camera-panel">
                {cameraStatus === 'active' && <video ref={cameraVideoRef} className="camera-video" style={{ objectFit: 'contain', objectPosition: '50% 50%', transform: mirrorSelfView ? 'scaleX(-1)' : 'scaleX(1)' }} autoPlay muted playsInline />}
                {cameraStatus !== 'active' && <div className={`camera-state ${cameraStatus}`} role={cameraStatus === 'error' ? 'alert' : 'status'}><span className="camera-state-icon" aria-hidden="true">◉</span><strong>{cameraStatus === 'loading' ? text('正在启动摄像头…', 'Starting camera…') : cameraStatus === 'error' ? text('摄像头不可用', 'Camera unavailable') : text('摄像头已停止', 'Camera stopped')}</strong>{cameraMessage && <p>{cameraMessage}</p>}</div>}
                <span className="panel-label">{text('我的画面', 'My camera')}</span>
                {cameraStatus === 'active' && <button type="button" title={text('只改变自己的预览方向', 'Changes only your self-view')} className={`self-mirror-button ${mirrorSelfView ? 'active' : ''}`} onClick={() => setMirrorSelfView((value) => !value)}>{text('镜像自己', 'Mirror self-view')}</button>}
              </div>}
            </div>
            <div className="video-quick-controls" aria-label={text('常用画面控制', 'Quick video controls')}>
              <button type="button" title={text('水平翻转教师视频', 'Mirror the teacher video')} className={isMirrored ? 'active' : ''} onClick={toggleMirror}>{text('镜像', 'Mirror')}</button>
              <button type="button" title={text('同时显示本机摄像头，不录制或上传', 'Show your local camera without recording or uploading')} className={compareMode ? 'active' : ''} onClick={toggleCompareMode}>{compareMode ? text('关闭摄像头', 'Turn camera off') : text('摄像头对比', 'Compare with camera')}</button>
              <button type="button" onClick={() => setSettingsDrawerOpen(true)}>{text('练习设置', 'Practice settings')}</button>
              <button type="button" onClick={() => void toggleFullscreen()}>{text('全屏', 'Fullscreen')}</button>
            </div>
            <div className="timeline-row"><span>{formatTime(currentTime)}</span><input aria-label={text('视频进度', 'Video timeline')} type="range" min="0" max={duration || 0} step="0.01" value={Math.min(currentTime, duration || 0)} onChange={(event) => { const nextTime = Number(event.target.value); cancelPendingLoop(); if (videoRef.current) videoRef.current.currentTime = nextTime; setCurrentTime(nextTime) }} /><span>{formatTime(duration)}</span></div>
            <div className="fullscreen-status">{text(`第 ${safeSegmentIndex + 1} 段`, `Section ${safeSegmentIndex + 1}`)} · {playbackMode === 'loop' ? text('循环练习', 'Loop practice') : text('连续播放', 'Continuous play')} · {speed}×</div>
            <aside className={`fullscreen-sidebar ${sidebarSide} ${sidebarExpanded ? 'expanded' : 'collapsed'}`}>
              <button type="button" title={text('展开或收起控制栏', 'Expand or collapse controls')} aria-label={text('展开或收起控制栏', 'Expand or collapse controls')} onClick={() => setSidebarExpanded((value) => !value)}>{sidebarExpanded ? text('收起', 'Collapse') : '☰'}</button>
              <button type="button" onClick={() => void togglePlayback()}>{isLoopWaiting ? text('取消等待', 'Cancel wait') : isPlaying ? text('暂停', 'Pause') : text('播放', 'Play')}</button>
              <button type="button" disabled={safeSegmentIndex === 0} onClick={() => changeSegment(safeSegmentIndex - 1)}>{text('上一段', 'Previous')}</button>
              <button type="button" disabled={safeSegmentIndex === learningSegments.length - 1} onClick={() => changeSegment(safeSegmentIndex + 1)}>{text('下一段', 'Next')}</button>
              <button type="button" className={playbackMode === 'loop' ? 'active' : ''} onClick={() => changePlaybackMode(playbackMode === 'loop' ? 'continuous' : 'loop')}>{playbackMode === 'loop' ? text('循环', 'Loop') : text('连续', 'Continuous')}</button>
              <button type="button" className={compareMode ? 'active' : ''} onClick={toggleCompareMode}>{compareMode ? text('关闭摄像头', 'Camera off') : text('摄像头对比', 'Camera compare')}</button>
              {sidebarExpanded && <div className="sidebar-expanded-controls">
                {learningSegments.length > 0 && <div className="fullscreen-segment-selector" aria-label={text('直接选择学习段', 'Choose a practice section')}>
                  {learningSegments.map((segment, index) => <button type="button" key={segment.segmentIndex} className={safeSegmentIndex === index ? 'active' : ''} onClick={() => changeSegment(index)}>{segment.segmentIndex}</button>)}
                </div>}
                {rangeButtons(true)}
                <div className="sidebar-speed-buttons">{SPEEDS.map((value) => <button type="button" key={value} className={speed === value ? 'active' : ''} onClick={() => changeSpeed(value)}>{value}×</button>)}</div>
                {teacherFramingControls(true)}
                <button type="button" className={isMirrored ? 'active' : ''} onClick={toggleMirror}>{text('镜像', 'Mirror')}</button>
                <button type="button" disabled={compareMode} className={renderDisplayMode === 'contain' ? 'active' : ''} onClick={() => changeDisplayMode('contain')}>{text('完整画面', 'Fit entire video')}</button>
                <button type="button" disabled={compareMode} className={renderDisplayMode === 'cover' ? 'active' : ''} onClick={() => changeDisplayMode('cover')}>{text('放大填充', 'Fill viewport')}</button>
                <button type="button" onClick={resetPicture}>{text('重置画面', 'Reset view')}</button>
                <button type="button" onClick={() => setSide(sidebarSide === 'left' ? 'right' : 'left')}>{sidebarSide === 'left' ? text('移到右侧', 'Move right') : text('移到左侧', 'Move left')}</button>
              </div>}
              <button type="button" onClick={() => void toggleFullscreen()}>{text('退出全屏', 'Exit fullscreen')}</button>
            </aside>
          </div>

          <div ref={practiceControlsRef} className="practice-controls">
            <button type="button" onClick={() => seekBy(-2)}>{text('回看 2 秒', 'Back 2 seconds')}</button>
            <button type="button" disabled={!learningSegments.length || safeSegmentIndex === 0} onClick={() => changeSegment(safeSegmentIndex - 1)}>{text('上一段', 'Previous section')}</button>
            <button type="button" className="play-button" onClick={() => void togglePlayback()}>{isLoopWaiting ? text('取消循环等待', 'Cancel loop wait') : isPlaying ? text('暂停', 'Pause') : text('播放', 'Play')}</button>
            <button type="button" disabled={!learningSegments.length || safeSegmentIndex === learningSegments.length - 1} onClick={() => changeSegment(safeSegmentIndex + 1)}>{text('下一段', 'Next section')}</button>
            <button type="button" onClick={() => seekBy(2)}>{text('前进 2 秒', 'Forward 2 seconds')}</button>
          </div>

          <div className="file-row"><div><strong>{fileName}</strong><span>{formatFileSize(fileSize)} · {formatTime(duration)}</span></div><label className="replace-button">{text('更换视频', 'Replace video')}<input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={handleFileChange} /></label></div>

          {settingsDrawerOpen && <div className="drawer-backdrop">
            <aside ref={settingsDrawerRef} className="settings-drawer" role="dialog" aria-modal="true" aria-label={text('练习设置', 'Practice settings')}>
              <div className="drawer-header"><div><p className="panel-kicker">PRACTICE</p><h2>{text('练习设置', 'Practice settings')}</h2></div><button type="button" className="drawer-close" aria-label={text('关闭练习设置', 'Close practice settings')} onClick={() => setSettingsDrawerOpen(false)}>×</button></div>

              {learningSegments.length > 0 ? <section className="drawer-section">
                <h3>{text('学习段', 'Practice sections')}</h3>
                <strong>{text(`第 ${safeSegmentIndex + 1} 段`, `Section ${safeSegmentIndex + 1}`)} · {learningSegments[safeSegmentIndex].startBeat} → {learningSegments[safeSegmentIndex].endBeat}</strong>
                <div className="segment-list">{learningSegments.map((segment, index) => <button type="button" key={segment.segmentIndex} className={safeSegmentIndex === index ? 'active' : ''} onClick={() => changeSegment(index)}>{text(`第 ${segment.segmentIndex} 段`, `Section ${segment.segmentIndex}`)}{segment.incomplete ? text(' · 不足 8 拍', ' · under 8 beats') : ''}</button>)}</div>
              </section> : <p className="drawer-empty">{text('完成节拍与正式起点设置后，将在这里生成学习段。', 'Practice sections appear here after you set the beat and choreography start.')}</p>}

              {learningSegments.length > 0 && <>
                <section className="drawer-section"><h3>{text('练习范围', 'Practice range')}</h3>{rangeButtons()}</section>
                <section className="drawer-section"><h3>{text('播放模式', 'Playback mode')}</h3><div className="playback-mode-buttons"><button type="button" className={playbackMode === 'loop' ? 'active' : ''} onClick={() => changePlaybackMode('loop')}>{text('循环练习 · 停 2 秒', 'Loop · pause 2 seconds')}</button><button type="button" className={playbackMode === 'continuous' ? 'active' : ''} onClick={() => changePlaybackMode('continuous')}>{text('连续播放', 'Continuous play')}</button></div></section>
              </>}

              <section className="drawer-section"><h3>{text('播放速度', 'Playback speed')}</h3><div className="segmented">{SPEEDS.map((value) => <button type="button" key={value} className={speed === value ? 'active' : ''} onClick={() => changeSpeed(value)}>{value}×</button>)}</div></section>
              <section className="drawer-section"><h3>{text('教师画面构图', 'Teacher framing')}</h3>{teacherFramingControls()}<p className="framing-hint">{text('放大后可直接拖动教师画面；单画面与摄像头分屏会分别记住位置。', 'After zooming, drag the teacher video in any direction. Single and camera comparison views remember separate positions.')}</p></section>
              <section className="drawer-section"><h3>{text('画面与声音', 'Picture and sound')}</h3><div className="drawer-control-grid">
                <button type="button" className={isMirrored ? 'active' : ''} onClick={toggleMirror}>{text('镜像教师', 'Mirror teacher')}</button>
                <button type="button" disabled={compareMode} className={renderDisplayMode === 'contain' ? 'active' : ''} onClick={() => changeDisplayMode('contain')}>{text('完整画面', 'Fit entire video')}</button>
                <button type="button" disabled={compareMode} className={renderDisplayMode === 'cover' ? 'active' : ''} onClick={() => changeDisplayMode('cover')}>{text('放大填充', 'Fill viewport')}</button>
                <button type="button" onClick={resetPicture}>{text('重置画面', 'Reset view')}</button>
                <button type="button" onClick={toggleMute}>{isMuted || volume === 0 ? text('取消静音', 'Unmute') : text('静音', 'Mute')}</button>
              </div><input aria-label={text('音量', 'Volume')} type="range" min="0" max="1" step="0.05" value={volume} onChange={changeVolume} /></section>

              <section className={`setup-panel drawer-setup ${setupExpanded ? 'open' : ''}`}>
                <button type="button" className="setup-toggle" onClick={() => setSetupExpanded((value) => !value)}>{formalStartTime === null ? text('设置节拍与分段', 'Set beat and sections') : text('重新设置分段', 'Reset section setup')} <span>{setupExpanded ? text('收起', 'Collapse') : text('展开', 'Expand')}</span></button>
                {setupExpanded && <div className="setup-grid">
                  <p className="setup-current-time">{text('当前视频位置：', 'Current video position: ')}<strong>{currentTime.toFixed(3)} {text('秒', 'seconds')}</strong></p>
                  <div className="setup-block"><label htmlFor="bpm-input">BPM</label><div className="inline-controls"><input id="bpm-input" aria-label={text('每分钟节拍数', 'Beats per minute')} type="number" min="40" max="240" value={bpmInput} onChange={(event) => setBpmInput(event.target.value)} /><button type="button" onClick={applyBpm}>{text('应用', 'Apply')}</button></div>{bpmError && <span className="field-error">{bpmError}</span>}</div>
                  <div className="setup-block"><strong>{text('音乐第一拍', 'First musical beat')}</strong><button type="button" className="accent-button" onClick={markFirstBeat}>{text('将当前位置设为音乐第 1 拍', 'Set current position as beat one')}</button>{firstBeatTime !== null && <span className="setting-result">{text('音乐 1：', 'Beat one: ')}{formatTime(firstBeatTime)} ({firstBeatTime.toFixed(3)}s)</span>}<div className="mini-buttons"><button type="button" disabled={firstBeatTime === null} onClick={() => adjustFirstBeat(-0.5)}>{text('前半拍', 'Back ½ beat')}</button><button type="button" disabled={firstBeatTime === null} onClick={() => adjustFirstBeat(.5)}>{text('后半拍', 'Forward ½ beat')}</button><button type="button" disabled={firstBeatTime === null} onClick={() => adjustFirstBeat(-1)}>{text('前一拍', 'Back 1 beat')}</button><button type="button" disabled={firstBeatTime === null} onClick={() => adjustFirstBeat(1)}>{text('后一拍', 'Forward 1 beat')}</button></div></div>
                  <div className="setup-block"><strong>{text('正式编舞起点', 'Choreography start')}</strong><button type="button" className="accent-button" onClick={markFormalStart}>{text('将当前位置设为正式编舞起点', 'Set current position as choreography start')}</button>{formalCandidate && <div className="candidate-result"><b>{text('吸附到', 'Snapped to')} {formalCandidate.label}</b><span>{formalCandidate.time.toFixed(3)}s · {text('相差', 'difference')} {formalCandidate.delta >= 0 ? '+' : ''}{formalCandidate.delta.toFixed(3)}s</span></div>}<div className="mini-buttons"><button type="button" disabled={!formalCandidate} onClick={() => adjustFormalCandidate(-1)}>{text('前半拍', 'Back ½ beat')}</button><button type="button" disabled={!formalCandidate} onClick={() => adjustFormalCandidate(1)}>{text('后半拍', 'Forward ½ beat')}</button><button type="button" disabled={!formalCandidate} onClick={markFormalStart}>{text('重标', 'Remark')}</button><button type="button" className="confirm-button" disabled={!formalCandidate} onClick={confirmFormalStart}>{text('确认', 'Confirm')}</button></div>{formalStartTime !== null && <span className="setting-result">{text('已确认：', 'Confirmed: ')}{formalStartLabel} · {formalStartTime.toFixed(3)}s</span>}</div>
                </div>}
              </section>
            </aside>
          </div>}
        </>}
        {error && <p className="error-message" role="alert">{error}</p>}
        <p className="shortcut-hint"><strong>{text('快捷键', 'Shortcuts')}</strong>{text('Space 播放/暂停 · ←/→ 2 秒 · ↑/↓ 切段 · M 镜像 · L 循环/连续 · F 全屏', 'Space play/pause · ←/→ 2 seconds · ↑/↓ change section · M mirror · L loop/continuous · F fullscreen')}</p>
      </section>
    </main>
  )
}

export default App
