import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  beatDuration,
  beatPointAtStep,
  applyBoundaryOffsets,
  buildLearningSegments,
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
type TeacherFraming = { zoom: number; panX: number; panY: number }
type UiLanguage = 'zh' | 'en'
type RecordingStatus = 'idle' | 'countdown' | 'recording' | 'processing' | 'ready' | 'error'

interface SavedPracticeState {
  bpm: number
  firstBeatTime: number | null
  firstBeatConfirmed: boolean
  rawFormalStartTime: number | null
  formalStartTime: number | null
  formalStartLabel: string
  currentSegmentIndex: number
  rangeMode: PracticeRangeMode
  playbackMode: PlaybackMode
  boundaryOffsets: number[]
}

const DEFAULT_PRACTICE_STATE: SavedPracticeState = {
  bpm: 100,
  firstBeatTime: null,
  firstBeatConfirmed: false,
  rawFormalStartTime: null,
  formalStartTime: null,
  formalStartLabel: '',
  currentSegmentIndex: 0,
  rangeMode: 'current',
  playbackMode: 'loop',
  boundaryOffsets: [],
}
const DEFAULT_TEACHER_FRAMING: TeacherFraming = { zoom: 1, panX: 0, panY: 0 }
const MIN_TEACHER_ZOOM = 1
const MAX_TEACHER_ZOOM = 3
const TEACHER_ZOOM_STEP = 0.25
const RECORDING_WIDTH = 1280
const RECORDING_HEIGHT = 720
const RECORDING_FPS = 30

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
      rangeMode: ['current', 'previous-current', 'from-start'].includes(stored.rangeMode ?? '') ? stored.rangeMode as PracticeRangeMode : 'current',
      boundaryOffsets: Array.isArray(stored.boundaryOffsets) ? stored.boundaryOffsets.filter(Number.isFinite) : [],
      firstBeatConfirmed: stored.firstBeatConfirmed ?? stored.firstBeatTime !== null,
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
    ['确认两个起点', '先把播放位置设为音乐起点并确认，再设为舞蹈起点并确认。系统会自动生成分段，第1段自动带上预备拍。'],
    ['检查分段', '系统会自动按八拍分段。如有需要，可打开“自定义分段”，拖动视频进度条并确认新的分界。'],
    ['控制播放', '使用播放、暂停、回看 2 秒、前进 2 秒、四档速度、教师镜像和全屏。'],
    ['与摄像头对比', '打开摄像头后，教师与自己同时显示。自己的画面默认镜像；摄像头画面保留在本机，不会上传。点击“关闭摄像头”即可结束并关闭设备。'],
    ['调整教师画面', '使用镜像、缩小、放大、重置和全屏。重置会恢复完整显示、默认大小和居中位置；放大后可直接拖动教师画面。'],
    ['录制并回看练习', '在摄像头对比中选择 3、5 或 10 秒倒计时，从当前练习段起点录制干净的左右分屏。练习录像包含老师视频的声音，不会录制麦克风或环境声音；录像只在浏览器本地生成。'],
  ] : [
    ['Upload a dance video', 'Choose a local MP4, MOV, or WebM file. The video opens only in your browser and is not uploaded.'],
    ['Confirm two start points', 'Move to the music start and confirm it, then move to the choreography start and confirm it. Sections are generated automatically, and section 1 includes a preparation lead-in.'],
    ['Check the sections', 'Sections are created automatically in eight-counts. If needed, open Custom sections, move the video timeline, and confirm a new boundary.'],
    ['Control playback', 'Play, pause, go back 2 seconds, go forward 2 seconds, choose a speed, mirror the teacher, or enter fullscreen.'],
    ['Compare with your camera', 'Show the teacher and yourself together. Your self-view is mirrored by default. Camera video stays on this device and is never uploaded. Select “Turn camera off” to stop the camera.'],
    ['Reframe the teacher video', 'Use Mirror, Zoom out, Zoom in, Reset, and Fullscreen. Reset restores the full view, default size, and centered position. Drag the teacher video after zooming in.'],
    ['Record and review practice', 'In camera comparison, choose a 3, 5, or 10 second countdown and record a clean split view from the current practice-range start. Practice recordings include the teacher video audio. Microphone and room audio are not recorded.'],
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
  const recordingCanvasRef = useRef<HTMLCanvasElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const teacherCaptureStreamRef = useRef<MediaStream | null>(null)
  const recordingAudioContextRef = useRef<AudioContext | null>(null)
  const recordingAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const recordingAudioGainRef = useRef<GainNode | null>(null)
  const recordingAudioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const recordingFrameRef = useRef<number | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingSessionRef = useRef(0)
  const recordingStartedAtRef = useRef(0)
  const recordingUrlRef = useRef<string | null>(null)
  const recordingStatusRef = useRef<RecordingStatus>('idle')
  const pendingCameraStopRef = useRef(false)
  const countdownRestoreRef = useRef<{ time: number; wasPlaying: boolean } | null>(null)
  const videoStageRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const practiceControlsRef = useRef<HTMLDivElement>(null)
  const settingsDrawerRef = useRef<HTMLElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null)
  const clickStartRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null)
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
  const [setupExpanded, setSetupExpanded] = useState(true)
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
  const [bpmInput, setBpmInput] = useState('100')
  const [bpm, setBpm] = useState(100)
  const [bpmError, setBpmError] = useState('')
  const [firstBeatTime, setFirstBeatTime] = useState<number | null>(null)
  const [firstBeatConfirmed, setFirstBeatConfirmed] = useState(false)
  const [rawFormalStartTime, setRawFormalStartTime] = useState<number | null>(null)
  const [formalCandidate, setFormalCandidate] = useState<{ time: number; label: string; delta: number } | null>(null)
  const [formalStartTime, setFormalStartTime] = useState<number | null>(null)
  const [formalStartLabel, setFormalStartLabel] = useState('')
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0)
  const [rangeMode, setRangeMode] = useState<PracticeRangeMode>('current')
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop')
  const [boundaryOffsets, setBoundaryOffsets] = useState<number[]>([])
  const [customSectionsOpen, setCustomSectionsOpen] = useState(false)
  const [selectedBoundaryIndex, setSelectedBoundaryIndex] = useState(0)
  const [isLoopWaiting, setIsLoopWaiting] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'loading' | 'active' | 'error'>('idle')
  const [cameraMessage, setCameraMessage] = useState('')
  const [mirrorSelfView, setMirrorSelfView] = useState(true)
  const [countdownSeconds, setCountdownSeconds] = useState<3 | 5 | 10>(5)
  const [countdownValue, setCountdownValue] = useState<number | null>(null)
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle')
  const [recordingElapsed, setRecordingElapsed] = useState(0)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [recordingMimeType, setRecordingMimeType] = useState('')
  const [recordingError, setRecordingError] = useState('')
  const [recordingAudioNotice, setRecordingAudioNotice] = useState('')
  const [recordingHasTeacherAudio, setRecordingHasTeacherAudio] = useState(false)
  const [reviewSpeed, setReviewSpeed] = useState(1)
  const [, setTeacherViewportRevision] = useState(0)
  const text = (zh: string, en: string) => language === 'zh' ? zh : en

  const renderDisplayMode: DisplayMode = compareMode || (isFullscreen && orientation === 'portrait') ? 'contain' : displayMode
  const teacherFraming = compareMode ? splitTeacherFraming : singleTeacherFraming
  const canPanTeacher = teacherFraming.zoom > MIN_TEACHER_ZOOM || (!compareMode && renderDisplayMode === 'cover')
  const naturalLearningSegments = useMemo(() => (
    firstBeatTime === null || !firstBeatConfirmed || formalStartTime === null || !duration
      ? [] : buildLearningSegments(duration, formalStartTime, firstBeatTime, bpm)
  ), [bpm, duration, firstBeatConfirmed, firstBeatTime, formalStartTime])
  const learningSegments = useMemo(() => (
    firstBeatTime === null ? naturalLearningSegments : applyBoundaryOffsets(naturalLearningSegments, boundaryOffsets, firstBeatTime, bpm)
  ), [boundaryOffsets, bpm, firstBeatTime, naturalLearningSegments])
  const safeSegmentIndex = Math.min(currentSegmentIndex, Math.max(0, learningSegments.length - 1))
  const practiceRange = useMemo(() => getPracticeRange(rangeMode, learningSegments, safeSegmentIndex, duration, bpm), [bpm, duration, learningSegments, rangeMode, safeSegmentIndex])

  const cancelPendingLoop = useCallback(() => {
    if (loopTimerRef.current !== null) window.clearTimeout(loopTimerRef.current)
    loopTimerRef.current = null
    loopPendingRef.current = false
    setIsLoopWaiting(false)
  }, [])

  const updateRecordingStatus = useCallback((status: RecordingStatus) => {
    recordingStatusRef.current = status
    setRecordingStatus(status)
  }, [])

  const resetToPracticeIdle = useCallback(() => {
    cancelPendingLoop()
    countdownRestoreRef.current = null
    const video = videoRef.current
    if (video) {
      video.pause()
      video.currentTime = practiceRange.startTime
    }
    setCurrentTime(practiceRange.startTime)
    setIsPlaying(false)
    setIsLoopWaiting(false)
    setCountdownValue(null)
    setRecordingElapsed(0)
  }, [cancelPendingLoop, practiceRange.startTime])

  const closeReviewToPractice = useCallback(() => {
    setReviewOpen(false)
    resetToPracticeIdle()
    updateRecordingStatus('idle')
  }, [resetToPracticeIdle, updateRecordingStatus])

  const cleanupRecordingAudio = useCallback(() => {
    recordingAudioSourceRef.current?.disconnect()
    recordingAudioGainRef.current?.disconnect()
    recordingAudioDestinationRef.current?.disconnect()
    recordingAudioDestinationRef.current?.stream.getTracks().forEach((track) => track.stop())
    teacherCaptureStreamRef.current?.getTracks().forEach((track) => track.stop())
    recordingAudioSourceRef.current = null
    recordingAudioGainRef.current = null
    recordingAudioDestinationRef.current = null
    teacherCaptureStreamRef.current = null
    const context = recordingAudioContextRef.current
    recordingAudioContextRef.current = null
    if (context && context.state !== 'closed') void context.close()
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
    recordingSessionRef.current += 1
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current)
    if (recordingFrameRef.current !== null) cancelAnimationFrame(recordingFrameRef.current)
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop()
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    cleanupRecordingAudio()
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
    cameraRequestRef.current += 1
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [cancelPendingLoop, cleanupRecordingAudio])

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
    if (!reviewOpen) return
    const closeReviewOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeReviewToPractice()
    }
    window.addEventListener('keydown', closeReviewOnEscape)
    return () => window.removeEventListener('keydown', closeReviewOnEscape)
  }, [closeReviewToPractice, reviewOpen])

  useEffect(() => {
    if (!practiceStorageKey) return
    localStorage.setItem(practiceStorageKey, JSON.stringify({
      bpm, firstBeatTime, firstBeatConfirmed, rawFormalStartTime, formalStartTime, formalStartLabel,
      currentSegmentIndex: safeSegmentIndex, rangeMode, playbackMode, boundaryOffsets,
    } satisfies SavedPracticeState))
  }, [boundaryOffsets, bpm, firstBeatConfirmed, firstBeatTime, formalStartLabel, formalStartTime, playbackMode, practiceStorageKey, rangeMode, rawFormalStartTime, safeSegmentIndex])

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
    const nextStart = nextIndex === 0 && rangeMode === 'current'
      ? getPracticeRange('current', learningSegments, 0, duration, bpm).startTime
      : learningSegments[nextIndex].startTime
    if (videoRef.current) videoRef.current.currentTime = nextStart
    setCurrentTime(nextStart)
  }, [bpm, cancelPendingLoop, duration, learningSegments, rangeMode])

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
    setBpm(saved.bpm); setBpmInput(String(saved.bpm)); setFirstBeatTime(saved.firstBeatTime); setFirstBeatConfirmed(saved.firstBeatConfirmed)
    setRawFormalStartTime(saved.rawFormalStartTime); setFormalStartTime(saved.formalStartTime); setFormalStartLabel(saved.formalStartLabel)
    setFormalCandidate(null); setCurrentSegmentIndex(saved.currentSegmentIndex); setRangeMode(saved.rangeMode); setPlaybackMode(saved.playbackMode); setBoundaryOffsets(saved.boundaryOffsets); setCustomSectionsOpen(false); setSelectedBoundaryIndex(0)
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
    clickStartRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY }
    if (!canPanTeacher) return
    const bounds = getTeacherPanBounds(teacherFraming.zoom)
    if (!bounds.x && !bounds.y) return
    const visibleFraming = clampTeacherFraming(teacherFraming)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: visibleFraming.panX, panY: visibleFraming.panY, moved: false }
  }
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!canPanTeacher || !drag || drag.pointerId !== event.pointerId) return
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6
    if (moved) drag.moved = true
    setCurrentTeacherFraming((current) => ({
      ...current,
      panX: drag.panX + event.clientX - drag.startX,
      panY: drag.panY + event.clientY - drag.startY,
    }))
  }
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const clickStart = clickStartRef.current
    dragRef.current = null
    clickStartRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const moved = drag?.moved || (clickStart ? Math.hypot(event.clientX - clickStart.startX, event.clientY - clickStart.startY) > 6 : true)
    if (!moved) void togglePlayback()
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
    setFirstBeatTime(time); setFirstBeatConfirmed(false); setCurrentTime(time)
  }
  const adjustFirstBeat = (beats: number) => {
    if (firstBeatTime === null) return
    const next = Math.min(duration, Math.max(0, firstBeatTime + beatDuration(bpm) * beats))
    setFirstBeatTime(next); setFirstBeatConfirmed(false); pauseAndSeek(next)
  }
  const confirmFirstBeat = () => {
    if (firstBeatTime === null) return
    setFirstBeatConfirmed(true); resnapFormalStart(bpm, firstBeatTime)
  }
  const markFormalStart = () => {
    if (firstBeatTime === null || !firstBeatConfirmed) { setError(text('请先标记并确认音乐起点。', 'Mark and confirm the music start first.')); return }
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
    cancelPendingLoop(); setFormalStartTime(formalCandidate.time); setFormalStartLabel(formalCandidate.label); setBoundaryOffsets([])
    setCurrentSegmentIndex(0); setRangeMode('current'); setSetupExpanded(false)
    pauseAndSeek(formalCandidate.time)
  }
  const selectPracticeRange = (mode: PracticeRangeMode) => {
    cancelPendingLoop(); setRangeMode(mode)
    const nextStart = getPracticeRange(mode, learningSegments, safeSegmentIndex, duration, bpm).startTime
    if (videoRef.current) videoRef.current.currentTime = nextStart
    setCurrentTime(nextStart)
  }
  const confirmSelectedBoundary = () => {
    const naturalBoundary = naturalLearningSegments[selectedBoundaryIndex]?.endTime
    if (naturalBoundary === undefined) return
    setBoundaryOffsets((current) => {
      const next = [...current]
      next[selectedBoundaryIndex] = currentTime - naturalBoundary
      return next
    })
  }
  const changeSpeed = (next: number) => {
    if (videoRef.current) videoRef.current.playbackRate = next
    setSpeed(next); localStorage.setItem('adl-playback-speed', String(next))
  }
  const changeVolume = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value)
    if (videoRef.current) { videoRef.current.volume = next; if (next > 0) videoRef.current.muted = false }
    if (recordingAudioGainRef.current) recordingAudioGainRef.current.gain.value = videoRef.current?.muted ? 0 : next
    setVolume(next); setIsMuted(next === 0); localStorage.setItem('adl-volume', String(next))
  }
  const toggleMute = () => {
    if (!videoRef.current) return
    videoRef.current.muted = !videoRef.current.muted
    if (recordingAudioGainRef.current) recordingAudioGainRef.current.gain.value = videoRef.current.muted ? 0 : videoRef.current.volume
    setIsMuted(videoRef.current.muted)
  }

  const releaseCamera = useCallback(() => {
    cameraRequestRef.current += 1
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null
    setCompareMode(false)
    setCameraStatus('idle')
    setCameraMessage('')
  }, [])

  const drawRecordingFrame = useCallback(() => {
    const canvas = recordingCanvasRef.current
    const teacher = videoRef.current
    const learner = cameraVideoRef.current
    const stage = videoStageRef.current
    if (!canvas || !teacher?.videoWidth || !teacher.videoHeight || !learner?.videoWidth || !learner.videoHeight || !stage) return
    const context = canvas.getContext('2d')
    if (!context) return
    const panelWidth = RECORDING_WIDTH / 2
    context.fillStyle = '#050505'
    context.fillRect(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT)

    const viewportScale = Math.min(panelWidth / stage.clientWidth, RECORDING_HEIGHT / stage.clientHeight)
    const viewportWidth = stage.clientWidth * viewportScale
    const viewportHeight = stage.clientHeight * viewportScale
    const viewportX = (panelWidth - viewportWidth) / 2
    const viewportY = (RECORDING_HEIGHT - viewportHeight) / 2
    const fitScale = renderDisplayMode === 'cover'
      ? Math.max(stage.clientWidth / teacher.videoWidth, stage.clientHeight / teacher.videoHeight)
      : Math.min(stage.clientWidth / teacher.videoWidth, stage.clientHeight / teacher.videoHeight)
    const framing = clampTeacherFraming(teacherFraming)
    const teacherWidth = teacher.videoWidth * fitScale * framing.zoom * viewportScale
    const teacherHeight = teacher.videoHeight * fitScale * framing.zoom * viewportScale
    const teacherX = viewportX + viewportWidth / 2 + framing.panX * viewportScale
    const teacherY = viewportY + viewportHeight / 2 + framing.panY * viewportScale
    context.save()
    context.beginPath()
    context.rect(viewportX, viewportY, viewportWidth, viewportHeight)
    context.clip()
    context.translate(teacherX, teacherY)
    context.scale(isMirrored ? -1 : 1, 1)
    context.drawImage(teacher, -teacherWidth / 2, -teacherHeight / 2, teacherWidth, teacherHeight)
    context.restore()

    const learnerScale = Math.min(panelWidth / learner.videoWidth, RECORDING_HEIGHT / learner.videoHeight)
    const learnerWidth = learner.videoWidth * learnerScale
    const learnerHeight = learner.videoHeight * learnerScale
    context.save()
    context.beginPath()
    context.rect(panelWidth, 0, panelWidth, RECORDING_HEIGHT)
    context.clip()
    context.translate(panelWidth + panelWidth / 2, RECORDING_HEIGHT / 2)
    context.scale(mirrorSelfView ? -1 : 1, 1)
    context.drawImage(learner, -learnerWidth / 2, -learnerHeight / 2, learnerWidth, learnerHeight)
    context.restore()
  }, [isMirrored, mirrorSelfView, renderDisplayMode, teacherFraming])

  const stopRecording = useCallback(() => {
    recordingSessionRef.current += 1
    setCountdownValue(null)
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current)
    recordingTimerRef.current = null
    if (recordingFrameRef.current !== null) cancelAnimationFrame(recordingFrameRef.current)
    recordingFrameRef.current = null
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      updateRecordingStatus('processing')
      recorder.stop()
    }
    resetToPracticeIdle()
  }, [resetToPracticeIdle, updateRecordingStatus])

  const cancelCountdown = useCallback(() => {
    if (recordingStatusRef.current !== 'countdown') return
    recordingSessionRef.current += 1
    setCountdownValue(null)
    updateRecordingStatus('idle')
    const restore = countdownRestoreRef.current
    const video = videoRef.current
    countdownRestoreRef.current = null
    if (restore && video) {
      video.currentTime = restore.time
      setCurrentTime(restore.time)
      if (restore.wasPlaying) void video.play().catch(() => undefined)
    }
  }, [updateRecordingStatus])

  const stopCamera = useCallback(() => {
    if (recordingStatusRef.current === 'countdown') cancelCountdown()
    if (recordingStatusRef.current === 'recording' || recordingStatusRef.current === 'processing') {
      pendingCameraStopRef.current = true
      stopRecording()
      return
    }
    releaseCamera()
  }, [cancelCountdown, releaseCamera, stopRecording])

  const beginMediaRecording = useCallback(async () => {
    const canvas = recordingCanvasRef.current
    const teacher = videoRef.current
    const camera = cameraStreamRef.current
    if (!canvas || !teacher || !camera || camera.getVideoTracks().every((track) => track.readyState !== 'live')) throw new Error('camera-unavailable')
    canvas.width = RECORDING_WIDTH
    canvas.height = RECORDING_HEIGHT
    drawRecordingFrame()
    cleanupRecordingAudio()
    setRecordingAudioNotice('')
    setRecordingHasTeacherAudio(false)
    const canvasStream = canvas.captureStream(RECORDING_FPS)
    let recordingAudioTracks: MediaStreamTrack[] = []
    try {
      const capturableTeacher = teacher as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }
      const captureTeacherStream = capturableTeacher.captureStream?.() ?? capturableTeacher.mozCaptureStream?.()
      if (!captureTeacherStream?.getAudioTracks().length || typeof AudioContext === 'undefined') throw new Error('teacher-audio-unavailable')
      const audioContext = new AudioContext()
      teacherCaptureStreamRef.current = captureTeacherStream
      recordingAudioContextRef.current = audioContext
      await audioContext.resume()
      if (audioContext.state !== 'running') throw new Error('teacher-audio-context-suspended')
      const audioSource = audioContext.createMediaStreamSource(captureTeacherStream)
      const audioGain = audioContext.createGain()
      const audioDestination = audioContext.createMediaStreamDestination()
      audioGain.gain.value = teacher.muted ? 0 : teacher.volume
      audioSource.connect(audioGain)
      audioGain.connect(audioDestination)
      recordingAudioSourceRef.current = audioSource
      recordingAudioGainRef.current = audioGain
      recordingAudioDestinationRef.current = audioDestination
      recordingAudioTracks = audioDestination.stream.getAudioTracks()
      setRecordingHasTeacherAudio(true)
    } catch {
      cleanupRecordingAudio()
      setRecordingAudioNotice(text('当前浏览器无法录制老师视频声音，本次录像将仅包含画面。', 'This browser cannot capture the teacher video audio. This recording will be video-only.'))
    }
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...recordingAudioTracks])
    recordingStreamRef.current = stream
    const mimeType = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRecorderRef.current = recorder
    recordingChunksRef.current = []
    setRecordingMimeType(mimeType || recorder.mimeType || 'video/webm')
    recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data) }
    recorder.onerror = () => {
      setRecordingError(text('录制过程中发生错误，请重试。', 'Recording failed. Please try again.'))
      updateRecordingStatus('error')
      if (recorder.state !== 'inactive') recorder.stop()
      else {
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
        recordingStreamRef.current = null
        cleanupRecordingAudio()
      }
    }
    recorder.onstop = () => {
      resetToPracticeIdle()
      if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
      cleanupRecordingAudio()
      mediaRecorderRef.current = null
      const type = recorder.mimeType || mimeType || 'video/webm'
      const blob = new Blob(recordingChunksRef.current, { type })
      recordingChunksRef.current = []
      if (blob.size) {
        if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
        const url = URL.createObjectURL(blob)
        recordingUrlRef.current = url
        setRecordingUrl(url)
        setReviewOpen(true)
        setReviewSpeed(1)
        updateRecordingStatus('ready')
      } else {
        setRecordingError(text('没有生成可回看的录像，请重试。', 'No reviewable recording was created. Please try again.'))
        updateRecordingStatus('error')
      }
      if (pendingCameraStopRef.current) {
        pendingCameraStopRef.current = false
        releaseCamera()
      }
    }
    const render = () => {
      if (recorder.state === 'inactive') return
      drawRecordingFrame()
      recordingFrameRef.current = requestAnimationFrame(render)
    }
    recorder.start(1000)
    recordingStartedAtRef.current = performance.now()
    setRecordingElapsed(0)
    updateRecordingStatus('recording')
    render()
    recordingTimerRef.current = window.setInterval(() => setRecordingElapsed((performance.now() - recordingStartedAtRef.current) / 1000), 200)
    await teacher.play()
  }, [cleanupRecordingAudio, drawRecordingFrame, language, releaseCamera, resetToPracticeIdle, updateRecordingStatus])

  const startRecordingCountdown = useCallback(async () => {
    const video = videoRef.current
    const camera = cameraStreamRef.current
    if (!videoUrl || !video || !compareMode || cameraStatus !== 'active' || !camera || !window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      setRecordingError(text('请先载入视频并开启可用的摄像头对比。', 'Load a video and start camera comparison before recording.'))
      updateRecordingStatus('error')
      return
    }
    setRecordingError('')
    cancelPendingLoop()
    countdownRestoreRef.current = { time: video.currentTime, wasPlaying: !video.paused }
    video.pause()
    const session = ++recordingSessionRef.current
    updateRecordingStatus('countdown')
    for (let value = countdownSeconds; value > 0; value -= 1) {
      if (recordingSessionRef.current !== session) return
      setCountdownValue(value)
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }
    if (recordingSessionRef.current !== session) return
    setCountdownValue(null)
    video.currentTime = practiceRange.startTime
    setCurrentTime(practiceRange.startTime)
    if (Math.abs(video.currentTime - practiceRange.startTime) > 0.01 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => {
        const finish = () => { video.removeEventListener('seeked', finish); resolve() }
        video.addEventListener('seeked', finish, { once: true })
        window.setTimeout(finish, 1500)
      })
    }
    if (recordingSessionRef.current !== session) return
    try {
      await beginMediaRecording()
    } catch {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
      cleanupRecordingAudio()
      setRecordingError(text('无法开始本地录像。请检查浏览器支持和摄像头状态。', 'Could not start local recording. Check browser support and camera status.'))
      updateRecordingStatus('error')
    }
  }, [beginMediaRecording, cameraStatus, cancelPendingLoop, cleanupRecordingAudio, compareMode, countdownSeconds, language, practiceRange.startTime, updateRecordingStatus, videoUrl])

  const deleteRecording = () => {
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
    recordingUrlRef.current = null
    setRecordingUrl(null)
    setReviewOpen(false)
    setRecordingElapsed(0)
    setRecordingError('')
    resetToPracticeIdle()
    updateRecordingStatus('idle')
  }
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
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
        if (recordingStatusRef.current === 'countdown') cancelCountdown()
        if (recordingStatusRef.current === 'recording') stopRecording()
        setCameraStatus('error')
        setCameraMessage(text('摄像头已停止。', 'Camera stopped.'))
      }, { once: true }))
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
  }, [cancelCountdown, language, stopRecording])
  const toggleCompareMode = useCallback(() => {
    if (compareMode) stopCamera()
    else void startCamera()
  }, [compareMode, startCamera, stopCamera])
  const resetPicture = () => {
    fitTeacherVideo()
  }

  const teacherFramingControls = () => (
    <div className="teacher-framing-controls" aria-label={text('教师画面控制', 'Teacher view controls')}>
      <button type="button" title={text('水平翻转教师视频', 'Mirror the teacher video')} className={isMirrored ? 'active' : ''} onClick={toggleMirror}>{text('镜像', 'Mirror')}</button>
      <button type="button" title={text('缩小教师视频', 'Zoom out of the teacher video')} aria-label={text('缩小教师视频', 'Zoom out of the teacher video')} disabled={teacherFraming.zoom <= MIN_TEACHER_ZOOM} onClick={() => changeTeacherZoom(-TEACHER_ZOOM_STEP)}>−</button>
      <button type="button" title={text('放大教师视频', 'Zoom in on the teacher video')} aria-label={text('放大教师视频', 'Zoom in on the teacher video')} disabled={teacherFraming.zoom >= MAX_TEACHER_ZOOM} onClick={() => changeTeacherZoom(TEACHER_ZOOM_STEP)}>＋</button>
      <button type="button" title={text('恢复完整显示、默认大小和居中位置', 'Restore the full view, default size, and centered position')} onClick={resetPicture}>{text('重置', 'Reset')}</button>
      <button type="button" title={text('进入全屏', 'Enter fullscreen')} aria-label={text('进入全屏', 'Enter fullscreen')} onClick={() => void toggleFullscreen()}>⛶</button>
    </div>
  )

  const rangeControl = (label = true) => (
    <label className="practice-range-select">{label && text('练习范围', 'Practice range')}
      <select value={rangeMode} onChange={(event) => selectPracticeRange(event.target.value as PracticeRangeMode)}>
        <option value="current">{text('当前段', 'Current section')}</option>
        <option value="previous-current" disabled={safeSegmentIndex === 0}>{text('上一段＋当前段', 'Previous + current')}</option>
        <option value="from-start">{text('第1段到当前段', 'Section 1 to current')}</option>
      </select>
    </label>
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
              {recordingStatus === 'countdown' && countdownValue !== null && <div className="recording-countdown" role="status" aria-live="assertive"><strong>{countdownValue}</strong><span>{text('准备开始', 'Get ready')}</span><button type="button" onClick={cancelCountdown}>{text('取消', 'Cancel')}</button></div>}
              {recordingStatus === 'recording' && <div className="recording-live-status" role="status"><span aria-hidden="true" />{text('录制中', 'Recording')} {formatTime(recordingElapsed)}</div>}
            </div>
            <canvas ref={recordingCanvasRef} className="recording-canvas" aria-hidden="true" />
            <div className="video-quick-controls" aria-label={text('练习准备', 'Practice preparation')}>
              {teacherFramingControls()}
              <button type="button" title={text('同时显示本机摄像头，不录制或上传', 'Show your local camera without recording or uploading')} className={compareMode ? 'active' : ''} onClick={toggleCompareMode}>{compareMode ? text('关闭摄像头', 'Turn camera off') : text('摄像头对比', 'Compare with camera')}</button>
              {compareMode && cameraStatus === 'active' && recordingStatus !== 'recording' && recordingStatus !== 'processing' && <button type="button" className="record-button" disabled={recordingStatus === 'countdown'} onClick={() => void startRecordingCountdown()}>{recordingStatus === 'countdown' ? text('倒计时中', 'Counting down') : text('开始录制', 'Record')}</button>}
              {recordingStatus === 'recording' && <button type="button" className="stop-record-button" onClick={stopRecording}>{text('停止录制', 'Stop')}</button>}
              {recordingUrl && !reviewOpen && <button type="button" onClick={() => setReviewOpen(true)}>{text('查看录像', 'Review recording')}</button>}
              <button type="button" onClick={() => setSettingsDrawerOpen(true)}>{text('准备设置', 'Practice setup')}</button>
            </div>
            <div className="timeline-row"><span>{formatTime(currentTime)}</span><input aria-label={text('视频进度', 'Video timeline')} type="range" min="0" max={duration || 0} step="0.01" value={Math.min(currentTime, duration || 0)} onChange={(event) => { const nextTime = Number(event.target.value); cancelPendingLoop(); if (videoRef.current) videoRef.current.currentTime = nextTime; setCurrentTime(nextTime) }} /><span>{formatTime(duration)}</span></div>
            <div className="fullscreen-status">{text(`第 ${safeSegmentIndex + 1} 段`, `Section ${safeSegmentIndex + 1}`)} · {playbackMode === 'loop' ? text('循环练习', 'Loop practice') : text('连续播放', 'Continuous play')} · {speed}×</div>
            <aside className="fullscreen-sidebar right practice-only">
              <label>{text('速度', 'Speed')}<select value={speed} onChange={(event) => changeSpeed(Number(event.target.value))}>{SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
              <button type="button" disabled={safeSegmentIndex === 0} onClick={() => changeSegment(safeSegmentIndex - 1)}>{text('上一段', 'Previous')}</button>
              <button type="button" disabled={safeSegmentIndex === learningSegments.length - 1} onClick={() => changeSegment(safeSegmentIndex + 1)}>{text('下一段', 'Next')}</button>
              {rangeControl(false)}
              <button type="button" onClick={() => void togglePlayback()}>{isLoopWaiting ? text('取消等待', 'Cancel wait') : isPlaying ? text('暂停', 'Pause') : text('播放', 'Play')}</button>
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
              <div className="drawer-header"><div><p className="panel-kicker">PREPARE</p><h2>{text('练习准备', 'Practice setup')}</h2></div><button type="button" className="drawer-close" aria-label={text('关闭练习准备', 'Close practice setup')} onClick={() => setSettingsDrawerOpen(false)}>×</button></div>

              <section className={`setup-panel drawer-setup ${setupExpanded ? 'open' : ''}`}>
                <button type="button" className="setup-toggle" onClick={() => setSetupExpanded((value) => !value)}>{text('1. 音乐与动作起点', '1. Music and dance starts')} <span>{setupExpanded ? text('收起', 'Collapse') : text('展开', 'Expand')}</span></button>
                {setupExpanded && <div className="setup-grid">
                  <p className="setup-current-time">{text('视频位置：', 'Video position: ')}<strong>{currentTime.toFixed(2)}s</strong></p>
                  <div className="setup-block"><strong>{text('音乐起点', 'Music start')}</strong><p>{text('到音乐第一拍时标记并确认。', 'At the first music beat, mark and confirm.')}</p><div className="inline-controls"><input id="bpm-input" aria-label={text('每分钟节拍数', 'Beats per minute')} type="number" min="40" max="240" value={bpmInput} onChange={(event) => setBpmInput(event.target.value)} /><button type="button" onClick={applyBpm}>{text('应用 BPM', 'Apply BPM')}</button></div>{bpmError && <span className="field-error">{bpmError}</span>}<button type="button" className="accent-button" onClick={markFirstBeat}>{text('标记当前位置', 'Mark position')}</button>{firstBeatTime !== null && <span className="setting-result">{firstBeatConfirmed ? text('已确认：', 'Confirmed: ') : text('待确认：', 'Ready: ')}{firstBeatTime.toFixed(2)}s</span>}<div className="mini-buttons"><button type="button" disabled={firstBeatTime === null} onClick={() => adjustFirstBeat(-0.5)}>{text('前半拍', 'Back ½')}</button><button type="button" disabled={firstBeatTime === null} onClick={() => adjustFirstBeat(.5)}>{text('后半拍', 'Forward ½')}</button><button type="button" className="confirm-button" disabled={firstBeatTime === null || firstBeatConfirmed} onClick={confirmFirstBeat}>{text('确认', 'Confirm')}</button></div></div>
                  <div className="setup-block"><strong>{text('动作起点', 'Dance start')}</strong><p>{text('到正式动作开始时标记并确认。', 'At the first dance move, mark and confirm.')}</p><button type="button" className="accent-button" disabled={!firstBeatConfirmed} onClick={markFormalStart}>{text('标记当前位置', 'Mark position')}</button>{formalCandidate && <div className="candidate-result"><b>{text('吸附到', 'Snapped to')} {formalCandidate.label}</b><span>{formalCandidate.time.toFixed(2)}s</span></div>}<div className="mini-buttons"><button type="button" disabled={!formalCandidate} onClick={() => adjustFormalCandidate(-1)}>{text('前半拍', 'Back ½')}</button><button type="button" disabled={!formalCandidate} onClick={() => adjustFormalCandidate(1)}>{text('后半拍', 'Forward ½')}</button><button type="button" className="confirm-button" disabled={!formalCandidate} onClick={confirmFormalStart}>{text('确认', 'Confirm')}</button></div>{formalStartTime !== null && <span className="setting-result">{text('已确认：', 'Confirmed: ')}{formalStartTime.toFixed(2)}s</span>}</div>
                </div>}
              </section>

              <section className={`drawer-section custom-sections ${customSectionsOpen ? 'open' : ''}`}><button type="button" className="custom-sections-toggle" onClick={() => setCustomSectionsOpen((value) => !value)}>{text('自定义分段', 'Custom sections')}<span>{customSectionsOpen ? text('收起', 'Collapse') : text('展开', 'Expand')}</span></button>{customSectionsOpen && (learningSegments.length > 1 ? <div className="custom-sections-body"><p>{text('选择分界，拖动视频进度条，再确认当前位置。', 'Choose a boundary, move the video timeline, then confirm the current position.')}</p><label>{text('要调整的分界', 'Boundary')}<select value={selectedBoundaryIndex} onChange={(event) => { const index = Number(event.target.value); setSelectedBoundaryIndex(index); pauseAndSeek(learningSegments[index].endTime) }}>{naturalLearningSegments.slice(0, -1).map((segment, index) => <option key={segment.segmentIndex} value={index}>{text(`第 ${index + 1}／${index + 2} 段`, `Sections ${index + 1}/${index + 2}`)}</option>)}</select></label><strong>{text('当前位置：', 'Current position: ')}{currentTime.toFixed(2)}s</strong><button type="button" className="confirm-button" onClick={confirmSelectedBoundary}>{text('确认此处分段', 'Confirm boundary here')}</button><button type="button" onClick={() => setBoundaryOffsets((current) => { const next = [...current]; next[selectedBoundaryIndex] = 0; return next })}>{text('恢复自动分界', 'Restore automatic boundary')}</button></div> : <div className="custom-sections-body"><p>{text('请先确认音乐起点和动作起点，系统生成至少两段后即可自定义。', 'Confirm the music and dance starts first. Custom boundaries are available after at least two sections are created.')}</p></div>)}</section>

              {learningSegments.length > 0 ? <section className="drawer-section">
                <h3>{text('学习段', 'Practice sections')}</h3>
                <strong>{text(`第 ${safeSegmentIndex + 1} 段`, `Section ${safeSegmentIndex + 1}`)} · {learningSegments[safeSegmentIndex].startBeat} → {learningSegments[safeSegmentIndex].endBeat}</strong>
                <div className="segment-list">{learningSegments.map((segment, index) => <button type="button" key={segment.segmentIndex} className={safeSegmentIndex === index ? 'active' : ''} onClick={() => changeSegment(index)}>{text(`第 ${segment.segmentIndex} 段`, `Section ${segment.segmentIndex}`)}{segment.incomplete ? text(' · 不足 8 拍', ' · under 8 beats') : ''}</button>)}</div>
                <p className="framing-hint">{text('第1段会自动带上系统计算出的预备拍。', 'Section 1 automatically includes the calculated preparation lead-in.')}</p>
              </section> : <p className="drawer-empty">{text('完成节拍与正式起点设置后，将在这里生成学习段。', 'Practice sections appear here after you set the beat and choreography start.')}</p>}

              {learningSegments.length > 0 && <>
                <section className="drawer-section">{rangeControl()}</section>
                <section className="drawer-section"><h3>{text('播放模式', 'Playback mode')}</h3><div className="playback-mode-buttons"><button type="button" className={playbackMode === 'loop' ? 'active' : ''} onClick={() => changePlaybackMode('loop')}>{text('循环练习 · 停 2 秒', 'Loop · pause 2 seconds')}</button><button type="button" className={playbackMode === 'continuous' ? 'active' : ''} onClick={() => changePlaybackMode('continuous')}>{text('连续播放', 'Continuous play')}</button></div></section>
              </>}

              <section className="drawer-section"><h3>{text('播放速度', 'Playback speed')}</h3><div className="segmented">{SPEEDS.map((value) => <button type="button" key={value} className={speed === value ? 'active' : ''} onClick={() => changeSpeed(value)}>{value}×</button>)}</div></section>
              <section className="drawer-section"><h3>{text('教师画面', 'Teacher view')}</h3>{teacherFramingControls()}<p className="framing-hint">{text('重置会恢复完整显示、默认大小和居中位置。放大后可直接拖动教师画面；拖动不会误触播放或暂停。', 'Reset restores the full view, default size, and centered position. Drag the teacher video after zooming; dragging will not toggle playback.')}</p></section>
              <section className="drawer-section"><h3>{text('声音', 'Sound')}</h3><div className="drawer-control-grid">
                <button type="button" onClick={toggleMute}>{isMuted || volume === 0 ? text('取消静音', 'Unmute') : text('静音', 'Mute')}</button>
              </div><input aria-label={text('音量', 'Volume')} type="range" min="0" max="1" step="0.05" value={volume} onChange={changeVolume} /></section>

              <section className="drawer-section recording-setup"><h3>{text('本地练习录像', 'Local practice recording')}</h3>
                <p>{text('练习录像包含老师视频的声音，不会录制麦克风或环境声音。录像不会上传。', 'Practice recordings include the teacher video audio. Microphone and room audio are not recorded. Recordings are not uploaded.')}</p>
                {recordingAudioNotice && <span className="recording-audio-notice" role="status">{recordingAudioNotice}</span>}
                <label>{text('开始前倒计时', 'Countdown before recording')}<select value={countdownSeconds} onChange={(event) => setCountdownSeconds(Number(event.target.value) as 3 | 5 | 10)} disabled={recordingStatus === 'countdown' || recordingStatus === 'recording' || recordingStatus === 'processing'}><option value="3">3 {text('秒', 'seconds')}</option><option value="5">5 {text('秒', 'seconds')}</option><option value="10">10 {text('秒', 'seconds')}</option></select></label>
                <div className="recording-actions">
                  {recordingStatus !== 'recording' && <button type="button" disabled={!videoUrl || !compareMode || cameraStatus !== 'active' || recordingStatus === 'countdown' || recordingStatus === 'processing'} onClick={() => void startRecordingCountdown()}>{recordingStatus === 'processing' ? text('正在生成回看…', 'Preparing review…') : text('开始录制', 'Start recording')}</button>}
                  {recordingStatus === 'recording' && <button type="button" className="stop-record-button" onClick={stopRecording}>{text('停止录制', 'Stop recording')}</button>}
                  {recordingStatus === 'countdown' && <button type="button" onClick={cancelCountdown}>{text('取消倒计时', 'Cancel countdown')}</button>}
                  {recordingUrl && !reviewOpen && <button type="button" onClick={() => setReviewOpen(true)}>{text('查看录像', 'Review recording')}</button>}
                </div>
                {recordingStatus === 'recording' && <strong className="recording-time">● {text('录制中', 'Recording')} {formatTime(recordingElapsed)}</strong>}
                {recordingError && <span className="field-error">{recordingError}</span>}
              </section>

            </aside>
          </div>}
          {recordingUrl && reviewOpen && <div className="recording-review-backdrop" role="presentation">
            <section className="recording-review" role="dialog" aria-modal="true" aria-labelledby="recording-review-title">
              <header><div><p className="panel-kicker">LOCAL REVIEW</p><h2 id="recording-review-title">{text('练习录像回看', 'Practice recording review')}</h2></div><button type="button" className="review-close" aria-label={text('关闭回放', 'Close Review')} onClick={closeReviewToPractice}>×</button></header>
              <video src={recordingUrl} controls loop playsInline onLoadedMetadata={(event) => { event.currentTarget.playbackRate = reviewSpeed }} />
              <div className="review-speed" aria-label={text('回看速度', 'Review speed')}>{([0.5, 0.75, 1] as const).map((value) => <button type="button" key={value} className={reviewSpeed === value ? 'active' : ''} onClick={(event) => { setReviewSpeed(value); const reviewVideo = event.currentTarget.closest('.recording-review')?.querySelector('video'); if (reviewVideo) reviewVideo.playbackRate = value }}>{value}×</button>)}</div>
              <div className="review-actions"><button type="button" className="back-to-practice" onClick={closeReviewToPractice}>{text('返回练习', 'Back to Practice')}</button><a className="button-link" href={recordingUrl} download={`frametune-practice-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`}>{text('下载 WebM', 'Download WebM')}</a><button type="button" onClick={deleteRecording}>{text('删除录像', 'Delete recording')}</button><button type="button" disabled={cameraStatus !== 'active'} onClick={() => { closeReviewToPractice(); setRecordingError(''); void startRecordingCountdown() }}>{text('再录一次', 'Record another')}</button></div>
              <p>{text(`本地生成 · ${recordingHasTeacherAudio ? '包含老师视频声音' : '仅画面'} · ${recordingMimeType || 'video/webm'}`, `Created locally · ${recordingHasTeacherAudio ? 'teacher video audio included' : 'video only'} · ${recordingMimeType || 'video/webm'}`)}</p>
              {recordingAudioNotice && <p className="recording-audio-notice" role="status">{recordingAudioNotice}</p>}
            </section>
          </div>}
        </>}
        {error && <p className="error-message" role="alert">{error}</p>}
        <p className="shortcut-hint"><strong>{text('快捷键', 'Shortcuts')}</strong>{text('Space 播放/暂停 · ←/→ 2 秒 · ↑/↓ 切段 · M 镜像 · L 循环/连续 · F 全屏', 'Space play/pause · ←/→ 2 seconds · ↑/↓ change section · M mirror · L loop/continuous · F fullscreen')}</p>
      </section>
    </main>
  )
}

export default App
