import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PracticeDock } from './practice/PracticeDock'
import { TeacherGesture } from './practice/teacherGesture'
import { analyzeVideoTempo } from './practice/tempoAnalysis'
import { normalizePracticeState, type SavedPracticeState } from './practice/savedPractice'
import { safeStorage } from './practice/safeStorage'
import {
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

const DEFAULT_TEACHER_FRAMING: TeacherFraming = { zoom: 1, panX: 0, panY: 0 }
const MIN_TEACHER_ZOOM = 1
const MAX_TEACHER_ZOOM = 3
const TEACHER_ZOOM_STEP = 0.25
const RECORDING_WIDTH = 1280
const RECORDING_HEIGHT = 720
const RECORDING_FPS = 30

function readStoredNumber(key: string, fallback: number) {
  const stored = safeStorage.getItem(key)
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
  try { return normalizePracticeState(JSON.parse(safeStorage.getItem(key) ?? 'null')) }
  catch { return normalizePracticeState(null) }
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
    ['选择视频', '打开本地 MP4、MOV 或 WebM。视频、摄像头和节拍分析均留在本机。'],
    ['设置两个起点', '菜单 → 练习设置。移动进度条，先确认“音乐起点”，再移动到动作开始处确认“动作起点”；不用重新打开菜单。完成后自动按八拍分段，第1段带预备拍。'],
    ['用底栏练习', '点速度展开档位。单段选3只练第3段；累加选3练第1–3段。段号独立于进度条，点箭头可收起或展开，放大视频不会藏住控制条。'],
    ['调整画面或分段', '双指缩放，放大后拖动；轻点画面播放或暂停。菜单内可重置完整画面、默认大小和居中，也可校准节拍或打开自定义分段，拖进度条后确认分界。自动分析只估算稳定节拍，不识别舞蹈动作。'],
    ['摄像头与录像', '摄像头按钮开关对比，自己的画面默认镜像。录像设置保留3、5、10秒倒计时。录像包含浏览器支持的老师音轨，不录麦克风，不上传；可回看、变速、下载WebM、删除或再录。刷新前请下载要保留的录像。'],
  ] : [
    ['Choose a video', 'Open a local MP4, MOV or WebM. Video, camera and beat analysis stay on this device.'],
    ['Mark two starts', 'Menu → Practice setup. Seek and confirm Music start, then seek to the first move and confirm Dance start without reopening the menu. Both starts create eight-beat sections; section 1 includes preparation.'],
    ['Practice with the dock', 'Tap Speed for presets. Single + 3 practices section 3; Build-up + 3 practices 1–3. Section numbers are separate from the timeline. Use the arrow to fold them. Zoom never hides the dock.'],
    ['Adjust the view or sections', 'Pinch to zoom; drag after zooming. Tap the video to play or pause. Menu offers Reset, beat calibration and Custom sections. To move a boundary, seek and confirm. Beat analysis estimates steady tempo, not choreography.'],
    ['Camera and recording', 'Camera toggles comparison; self-view is mirrored by default. Recording settings retain 3, 5 and 10 second countdowns. Record supported teacher audio, never the microphone. Review, change review speed, download WebM, delete or record again. Download before refreshing; nothing is uploaded.'],
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
  const settingsDrawerRef = useRef<HTMLElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const gestureRef = useRef(new TeacherGesture())
  const analysisRef = useRef<AbortController | null>(null)
  const fileRef = useRef<File | null>(null)
  const [setupMode, setSetupMode] = useState(false)
  const [setupStep, setSetupStep] = useState<'music' | 'dance'>('music')
  const [markerOpen, setMarkerOpen] = useState(false)
  const [dockExpanded, setDockExpanded] = useState(true)
  const [dockHint, setDockHint] = useState(() => safeStorage.getItem('adl-dock-hint') !== 'dismissed')
  const [menuPage, setMenuPage] = useState<'main' | 'tempo' | 'custom' | 'sound' | 'recording' | 'view' | 'help'>('main')
  const [tempoStatus, setTempoStatus] = useState<'analyzing' | 'auto' | 'manual' | 'editing' | 'unavailable'>('manual')
  const [tempoFailure, setTempoFailure] = useState('')
  const [confirmedTempoMode, setConfirmedTempoMode] = useState<SavedPracticeState['tempoMode']>('unset')
  const loopTimerRef = useRef<number | null>(null)
  const loopPendingRef = useRef(false)
  const [showLanding, setShowLanding] = useState(true)
  const [language, setLanguage] = useState<UiLanguage>(() => safeStorage.getItem('frametune-language') === 'en' ? 'en' : 'zh')
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
  const [isMirrored, setIsMirrored] = useState(() => safeStorage.getItem('adl-mirrored') === 'true')
  const [volume, setVolume] = useState(() => Math.min(1, Math.max(0, readStoredNumber('adl-volume', 1))))
  const [isMuted, setIsMuted] = useState(false)
  const [orientation, setOrientation] = useState<VideoOrientation>('landscape')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('contain')
  const [singleTeacherFraming, setSingleTeacherFraming] = useState<TeacherFraming>(DEFAULT_TEACHER_FRAMING)
  const [splitTeacherFraming, setSplitTeacherFraming] = useState<TeacherFraming>(DEFAULT_TEACHER_FRAMING)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
  const [bpmInput, setBpmInput] = useState('100')
  const [bpm, setBpm] = useState(100)
  const [bpmError, setBpmError] = useState('')
  const [firstBeatTime, setFirstBeatTime] = useState<number | null>(null)
  const [firstBeatConfirmed, setFirstBeatConfirmed] = useState(false)
  const [rawFormalStartTime, setRawFormalStartTime] = useState<number | null>(null)
  const [formalStartTime, setFormalStartTime] = useState<number | null>(null)
  const [formalStartLabel, setFormalStartLabel] = useState('')
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0)
  const [rangeMode, setRangeMode] = useState<PracticeRangeMode>('current')
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop')
  const [boundaryOffsets, setBoundaryOffsets] = useState<number[]>([])
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
    firstBeatTime === null || !firstBeatConfirmed || formalStartTime === null || !duration || (tempoStatus !== 'auto' && tempoStatus !== 'manual' && !(tempoStatus === 'editing' && confirmedTempoMode !== 'unset'))
      ? [] : buildLearningSegments(duration, formalStartTime, firstBeatTime, bpm)
  ), [bpm, confirmedTempoMode, duration, firstBeatConfirmed, firstBeatTime, formalStartTime, tempoStatus])
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
    safeStorage.setItem('frametune-language', language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    setError('')
    setBpmError('')
    if (cameraStatus === 'loading') setCameraMessage(language === 'zh' ? '正在启动摄像头…' : 'Starting camera…')
    else if (cameraStatus === 'error') setCameraMessage(language === 'zh' ? '摄像头不可用。请关闭后重试。' : 'Camera unavailable. Turn it off and try again.')
  }, [language])

  useEffect(() => () => {
    analysisRef.current?.abort()
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
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    setIsFullscreen(false)
    const closeReviewOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeReviewToPractice()
    }
    window.addEventListener('keydown', closeReviewOnEscape)
    return () => window.removeEventListener('keydown', closeReviewOnEscape)
  }, [closeReviewToPractice, reviewOpen])

  useEffect(() => {
    if (!practiceStorageKey) return
    safeStorage.setItem(practiceStorageKey, JSON.stringify({
      schemaVersion: 2, tempoMode: confirmedTempoMode,
      bpm, firstBeatTime, firstBeatConfirmed, rawFormalStartTime, formalStartTime, formalStartLabel,
      currentSegmentIndex: tempoStatus === 'analyzing' || tempoStatus === 'editing' ? currentSegmentIndex : safeSegmentIndex, rangeMode, playbackMode, boundaryOffsets,
    } satisfies SavedPracticeState))
  }, [boundaryOffsets, bpm, confirmedTempoMode, currentSegmentIndex, firstBeatConfirmed, firstBeatTime, formalStartLabel, formalStartTime, playbackMode, practiceStorageKey, rangeMode, rawFormalStartTime, safeSegmentIndex, tempoStatus])

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
      if (!setupMode && !(settingsDrawerOpen && menuPage === 'custom') && (video.currentTime >= practiceRange.endTime - 0.04 || video.currentTime < practiceRange.startTime)) video.currentTime = practiceRange.startTime
      await video.play()
      setError('')
    } catch {
      setError(text('无法播放此视频。请确认文件格式受浏览器支持。', 'This video could not be played. Check that its format is supported by your browser.'))
    }
  }, [cancelPendingLoop, isLoopWaiting, language, practiceRange.endTime, practiceRange.startTime, videoUrl, setupMode, menuPage, settingsDrawerOpen])

  const changeSegment = useCallback((index: number) => {
    if (!learningSegments.length) return
    cancelPendingLoop()
    const nextIndex = Math.min(Math.max(0, index), learningSegments.length - 1)
    setCurrentSegmentIndex(nextIndex)
    const nextStart = getPracticeRange(rangeMode, learningSegments, nextIndex, duration, bpm).startTime
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = nextStart }
    setCurrentTime(nextStart)
  }, [bpm, cancelPendingLoop, duration, learningSegments, rangeMode])

  const changePlaybackMode = useCallback((mode: PlaybackMode) => {
    cancelPendingLoop()
    setPlaybackMode(mode)
  }, [cancelPendingLoop])

  const handleTimeUpdate = (video: HTMLVideoElement) => {
    setCurrentTime(video.currentTime)
    if (setupMode || (settingsDrawerOpen && menuPage === 'custom') || !learningSegments.length || video.paused || loopPendingRef.current || video.currentTime < practiceRange.endTime - 0.04) return
    if (playbackMode === 'continuous') {
      video.pause()
      video.currentTime = practiceRange.endTime
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
      safeStorage.setItem('adl-mirrored', String(!current))
      return !current
    })
  }, [])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement === playerRef.current) await document.exitFullscreen()
      else if (isFullscreen) setIsFullscreen(false)
      else if (playerRef.current?.requestFullscreen) await playerRef.current.requestFullscreen()
      else setIsFullscreen(true)
    } catch {
      setError(text('浏览器无法切换全屏模式。', 'The browser could not switch fullscreen mode.'))
    }
  }, [language, isFullscreen])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return
      const key = event.key.toLowerCase()
      if (event.code === 'Space' && target?.tagName === 'BUTTON') return
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
    analysisRef.current?.abort()
    fileRef.current = file
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const storageKey = videoStorageKey(file)
    const saved = readPracticeState(storageKey)
    setConfirmedTempoMode(saved.tempoMode)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setVideoUrl(url); setFileName(file.name); setFileSize(file.size); setPracticeStorageKey(storageKey)
    setBpm(saved.bpm); setBpmInput(saved.tempoMode === 'manual' ? String(saved.bpm) : ''); setFirstBeatTime(saved.firstBeatTime); setFirstBeatConfirmed(saved.firstBeatConfirmed)
    setRawFormalStartTime(saved.rawFormalStartTime); setFormalStartTime(saved.formalStartTime); setFormalStartLabel(saved.formalStartLabel)
    setCurrentSegmentIndex(saved.currentSegmentIndex); setRangeMode(saved.rangeMode); setPlaybackMode(saved.playbackMode); setBoundaryOffsets(saved.boundaryOffsets); setSelectedBoundaryIndex(0)
    setSingleTeacherFraming(DEFAULT_TEACHER_FRAMING); setSplitTeacherFraming(DEFAULT_TEACHER_FRAMING); setDisplayMode('contain')
    setSetupMode(false); setMarkerOpen(false); setSettingsDrawerOpen(false); setMenuPage('main'); setDockExpanded(true); setDuration(0); setCurrentTime(0); setIsPlaying(false); setOrientation('landscape'); setError('')
    gestureRef.current.reset()
    if (saved.tempoMode === 'manual') { setTempoStatus('manual'); setTempoFailure('') }
    else runTempoAnalysis(file, saved.bpm)
    event.target.value = ''
  }

  const runTempoAnalysis = (file: File, previousBpm?: number) => {
    analysisRef.current?.abort()
    const controller = new AbortController()
    analysisRef.current = controller
    setTempoStatus('analyzing'); setTempoFailure(''); setBpmInput(''); setBpmError('')
    void analyzeVideoTempo(file, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (!result || result.confidence < .2) { setTempoStatus('unavailable'); setTempoFailure('unstable'); return }
      cancelPendingLoop()
      setBpm(result.bpm); setBpmInput(String(result.bpm));
      if (previousBpm === undefined || Math.abs(previousBpm - result.bpm) > Math.max(.5, previousBpm * .01)) { setBoundaryOffsets([]); setSelectedBoundaryIndex(0) }
      setTempoStatus('auto'); setConfirmedTempoMode('auto')
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) { setTempoStatus('unavailable'); setTempoFailure(failure instanceof Error ? failure.message : 'analysis-failed') }
    })
  }

  const markTimelineStart = (kind: 'music' | 'dance') => {
    if (kind === 'dance' && setupStep !== 'dance') return
    const time = videoRef.current?.currentTime ?? currentTime
    if (time >= duration - .25) { setError(text('起点需要放在视频结束之前。', 'Choose a start before the video ends.')); return }
    if (kind === 'dance' && firstBeatTime !== null && time < firstBeatTime) { setError(text('动作起点不能早于音乐起点。', 'Dance start must be after music start.')); return }
    if (kind === 'music') {
      setFirstBeatTime(time); setFirstBeatConfirmed(true)
      setSetupStep('dance')
      if (formalStartTime !== null && formalStartTime < time) { setFormalStartTime(null); setRawFormalStartTime(null) }
    } else {
      setRawFormalStartTime(time); setFormalStartTime(time)
      setFormalStartLabel(firstBeatTime === null ? '' : nearestBeatPoint(time, firstBeatTime, bpm).label)
    }
    setBoundaryOffsets([]); setSelectedBoundaryIndex(0); setCurrentSegmentIndex(0); setMarkerOpen(false); setError('')
    pauseAndSeek(time)
    if (kind === 'dance') setSetupMode(false)
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = speed; video.volume = volume
    setOrientation(video.videoWidth === video.videoHeight ? 'square' : video.videoWidth > video.videoHeight ? 'landscape' : 'portrait')
    setDisplayMode('contain'); setSingleTeacherFraming(DEFAULT_TEACHER_FRAMING); setSplitTeacherFraming(DEFAULT_TEACHER_FRAMING)
    setDuration(Number.isFinite(video.duration) ? video.duration : 0)
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
    gestureRef.current.reset()
    if (!compareMode) setDisplayMode('contain')
    setCurrentTeacherFraming(() => DEFAULT_TEACHER_FRAMING)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    gestureRef.current.start(event.pointerId, event.clientX, event.clientY, clampTeacherFraming(teacherFraming))
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const framing = gestureRef.current.move(event.pointerId, event.clientX, event.clientY)
    if (framing) setCurrentTeacherFraming(() => framing)
  }
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const tap = gestureRef.current.end(event.pointerId, event.type === 'pointercancel')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (tap) void togglePlayback()
  }

  useEffect(() => {
    const stage = videoStageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setTeacherViewportRevision((revision) => revision + 1))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [compareMode, isFullscreen, videoUrl])

  const applyBpm = () => {
    const next = Number(bpmInput)
    if (!Number.isFinite(next) || next < 40 || next > 240) { setBpmError(text('请输入 40–240 之间的 BPM。', 'Enter a BPM between 40 and 240.')); return }
    analysisRef.current?.abort()
    cancelPendingLoop(); videoRef.current?.pause()
    setBpm(next); setBpmError(''); setTempoStatus('manual'); setConfirmedTempoMode('manual'); setTempoFailure(''); setBoundaryOffsets([]); setSelectedBoundaryIndex(0)
  }
  const selectPracticeRange = (mode: PracticeRangeMode) => {
    cancelPendingLoop(); setRangeMode(mode)
    const nextStart = getPracticeRange(mode, learningSegments, safeSegmentIndex, duration, bpm).startTime
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = nextStart }
    setCurrentTime(nextStart)
  }
  const confirmSelectedBoundary = () => {
    const naturalBoundary = naturalLearningSegments[selectedBoundaryIndex]?.endTime
    if (naturalBoundary === undefined) return
    const before = learningSegments[selectedBoundaryIndex].startTime
    const after = learningSegments[selectedBoundaryIndex + 1]?.endTime ?? duration
    if (currentTime <= before + .25 || currentTime >= after - .25) { setError(text('请选择相邻分界之间的位置。', 'Choose a position between the neighboring boundaries.')); return }
    setError('')
    setBoundaryOffsets((current) => {
      const next = [...current]
      next[selectedBoundaryIndex] = currentTime - naturalBoundary
      return next
    })
  }
  const changeSpeed = (next: number) => {
    if (videoRef.current) videoRef.current.playbackRate = next
    setSpeed(next); safeStorage.setItem('adl-playback-speed', String(next))
  }
  const changeVolume = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value)
    if (videoRef.current) { videoRef.current.volume = next; if (next > 0) videoRef.current.muted = false }
    if (recordingAudioGainRef.current) recordingAudioGainRef.current.gain.value = videoRef.current?.muted ? 0 : next
    setVolume(next); setIsMuted(next === 0); safeStorage.setItem('adl-volume', String(next))
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
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      setRecordingError(text('当前浏览器不支持本地录像，请使用支持录像的浏览器。', 'Local recording is not supported by this browser. Try a supported browser.'))
      updateRecordingStatus('error')
      return
    }
    if (!videoUrl || !video || !compareMode || cameraStatus !== 'active' || !camera) {
      setRecordingError(text('请先载入视频并开启可用的摄像头对比。', 'Load a video and start camera comparison before recording.'))
      updateRecordingStatus('error')
      return
    }
    setRecordingError('')
    setSetupMode(false); setMarkerOpen(false); setSettingsDrawerOpen(false)
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


  const visibleTeacherFraming = clampTeacherFraming(teacherFraming)

  if (showLanding) return <LandingPage onStart={() => setShowLanding(false)} language={language} setLanguage={setLanguage} />

  return (
    <main className={`app-shell${videoUrl ? ' has-video' : ''}`}>
      <header className="app-header">
        <button type="button" className="workspace-brand" onClick={() => { stopCamera(); setShowLanding(true) }} aria-label={text('返回帧琢首页', 'Return to the FrameTune home page')}><strong>帧琢</strong><span>FrameTune</span><small>{text('测试版', 'Beta')}</small></button>
        <div className="workspace-header-tools"><p className="workspace-tagline">{text('逐帧精练，雕琢姿态', 'Refine every move, frame by frame.')}</p><div className="workspace-language" aria-label="Language"><button type="button" className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>中文</button><span>/</span><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button></div></div>
      </header>
      <section className="workspace">
        {!videoUrl ? (
          <label className="upload-panel"><span className="upload-icon">＋</span><strong>{text('选择舞蹈视频', 'Choose a dance video')}</strong><span>{text('MP4、MOV 或 WebM · 文件保留在本机', 'MP4, MOV, or WebM · stays on this device')}</span><input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={handleFileChange} /></label>
        ) : <>
          <div ref={playerRef} className={`player-frame practice-player ${orientation}${compareMode ? ' comparing' : ''}${isFullscreen ? ' is-immersive' : ''}`}>
            <div className={`video-stage${compareMode ? ' compare-mode' : ''}`}>
              <div ref={videoStageRef} className={`teacher-video-panel${canPanTeacher ? ' draggable-stage' : ''}`}
                onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onLostPointerCapture={event => { gestureRef.current.end(event.pointerId, true) }}>
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
              <button type="button" className={isMirrored ? 'active' : ''} aria-pressed={isMirrored} onClick={toggleMirror}>{text('镜像', 'Mirror')}</button>
              <button type="button" aria-label={compareMode ? text('关闭摄像头', 'Turn camera off') : text('摄像头对比', 'Compare with camera')} aria-pressed={compareMode} title={text('同时显示本机摄像头，不录制或上传', 'Show your local camera without recording or uploading')} className={compareMode ? 'active' : ''} onClick={toggleCompareMode}>{text('摄像头', 'Camera')}</button>
              {compareMode && cameraStatus === 'active' && recordingStatus !== 'recording' && recordingStatus !== 'processing' && <button type="button" className="record-button" disabled={recordingStatus === 'countdown'} onClick={() => void startRecordingCountdown()}>{recordingStatus === 'countdown' ? text('倒计时中', 'Counting down') : text('开始录制', 'Record')}</button>}
              {recordingStatus === 'recording' && <button type="button" className="stop-record-button" onClick={stopRecording}>{text('停止录制', 'Stop')}</button>}
              {recordingUrl && !reviewOpen && <button type="button" onClick={() => setReviewOpen(true)}>{text('查看录像', 'Review recording')}</button>}
              <button type="button" aria-expanded={settingsDrawerOpen} onClick={() => { setSettingsDrawerOpen(value => !value); setMenuPage('main') }}>{text('菜单', 'Menu')}</button>
              <button type="button" aria-label={isFullscreen ? text('退出全屏', 'Exit fullscreen') : text('进入全屏', 'Enter fullscreen')} onClick={() => void toggleFullscreen()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" /></svg></button>
            </div>
            <PracticeDock language={language} expanded={dockExpanded} onExpanded={setDockExpanded} speed={speed} speeds={SPEEDS} onSpeed={changeSpeed}
              sections={learningSegments} selected={safeSegmentIndex} rangeMode={rangeMode} onRange={selectPracticeRange} onSection={changeSegment} playing={isPlaying} waiting={isLoopWaiting} onPlay={() => void togglePlayback()}
              hint={dockHint} onDismissHint={() => { setDockHint(false); safeStorage.setItem('adl-dock-hint', 'dismissed') }}
              timeline={<>
                {setupMode && <div className="marker-setup"><span role="status">{setupStep === 'music' ? text('1. 移动进度条，确认音乐起点。', '1. Seek, then confirm Music start.') : text('2. 移到动作开始处，确认动作起点。', '2. Seek to the first move; confirm Dance start.')}</span><button type="button" onClick={() => { setSetupMode(false); setMarkerOpen(false) }}>{text('退出设置', 'Exit setup')}</button></div>}
                <div className="start-markers">{(setupMode || firstBeatConfirmed) && <><span>{text('音乐', 'Music')} {firstBeatConfirmed && firstBeatTime !== null ? firstBeatTime.toFixed(2) + 's' : '—'}</span><span>{text('动作', 'Dance')} {formalStartTime === null ? '—' : formalStartTime.toFixed(2) + 's'}</span></>}<span className="tempo-state" role="status">{tempoStatus === 'editing' ? text('请确认BPM', 'Confirm BPM') : tempoStatus === 'analyzing' ? text('识别BPM中…', 'Detecting BPM…') : tempoStatus === 'unavailable' ? text('未识别BPM · 菜单可重试', 'BPM not detected · Retry in menu') : text(tempoStatus === 'auto' ? '自动 ' : '手动 ', tempoStatus === 'auto' ? 'Auto ' : 'Manual ') + bpm + ' BPM'}</span></div>
                <div className="timeline-row"><span>{setupMode || menuPage === 'custom' ? currentTime.toFixed(2) : formatTime(currentTime)}</span><input aria-label={text('视频进度', 'Video timeline')} type="range" min="0" max={duration || 0} step="0.01" value={Math.min(currentTime, duration || 0)} onChange={event => { pauseAndSeek(Number(event.target.value)); if (setupMode) setMarkerOpen(true) }} onPointerUp={() => { if (setupMode) setMarkerOpen(true) }} /><span>{formatTime(duration)}</span></div>
                {setupMode && markerOpen && <div className="marker-options" aria-label={text('标记起点', 'Mark a start')}><button type="button" onClick={() => markTimelineStart('music')}>{text('音乐起点', 'Music start')}</button><button type="button" disabled={setupStep !== 'dance'} onClick={() => markTimelineStart('dance')}>{text('动作起点', 'Dance start')}</button></div>}
                {error && <p className="dock-error" role="alert">{error}</p>}
                {recordingError && <p className="dock-error" role="alert">{recordingError}</p>}
                {recordingAudioNotice && <p className="dock-notice" role="status">{recordingAudioNotice}</p>}
                {recordingStatus === 'processing' && <p className="dock-notice" role="status">{text('正在生成录像…', 'Preparing recording…')}</p>}
              </>}
              menu={settingsDrawerOpen && <section ref={settingsDrawerRef} className="compact-menu" aria-label={text('练习菜单', 'Practice menu')}>
                <div className="compact-menu-header"><strong>{menuPage === 'main' ? text('菜单', 'Menu') : menuPage === 'tempo' ? text('节拍校准', 'Beat calibration') : menuPage === 'custom' ? text('自定义分段', 'Custom sections') : menuPage === 'recording' ? text('录像设置', 'Recording settings') : menuPage === 'sound' ? text('声音', 'Sound') : menuPage === 'view' ? text('画面', 'View') : text('使用说明', 'Help')}</strong><button type="button" onClick={() => menuPage === 'main' ? setSettingsDrawerOpen(false) : setMenuPage('main')}>{menuPage === 'main' ? text('关闭', 'Close') : text('返回', 'Back')}</button></div>
                {menuPage === 'main' && <div className="compact-menu-items">
                  <button type="button" onClick={() => { cancelPendingLoop(); videoRef.current?.pause(); setSetupMode(true); setSetupStep('music'); setMarkerOpen(false); setSettingsDrawerOpen(false); setMenuPage('main') }}>{text('练习设置', 'Practice setup')}</button>
                  <button type="button" onClick={() => setMenuPage('tempo')}>{text('节拍校准', 'Beat calibration')}{tempoStatus === 'unavailable' ? ' · !' : ''}</button>
                  <button type="button" onClick={() => { setMenuPage('custom'); setSetupMode(false); if (learningSegments.length > 1) pauseAndSeek(learningSegments[selectedBoundaryIndex]?.endTime ?? learningSegments[0].endTime) }}>{text('自定义分段', 'Custom sections')}</button>
                  <button type="button" onClick={() => setMenuPage('sound')}>{text('声音', 'Sound')}</button>
                  <button type="button" onClick={() => setMenuPage('recording')}>{text('录像设置', 'Recording settings')}</button>
                  <button type="button" onClick={() => setMenuPage('view')}>{text('画面', 'View')}</button>
                  <button type="button" onClick={() => changePlaybackMode(playbackMode === 'loop' ? 'continuous' : 'loop')}>{playbackMode === 'loop' ? text('循环 · 停2秒', 'Repeat · 2s rest') : text('播放一次', 'Play once')}</button>
                  <label className="button-link">{text('更换视频', 'Replace video')}<input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" disabled={recordingStatus === 'recording' || recordingStatus === 'countdown' || recordingStatus === 'processing'} onChange={handleFileChange} /></label>
                  <button type="button" onClick={() => setMenuPage('help')}>{text('使用说明', 'Help')}</button>
                </div>}
                {menuPage === 'tempo' && <div className="compact-menu-body"><p role="status">{tempoStatus === 'editing' ? text('确认输入的BPM。', 'Confirm your BPM.') : tempoStatus === 'analyzing' ? text('正在本机分析音乐。', 'Analyzing music on this device.') : tempoStatus === 'auto' ? text('已自动识别BPM；不准确时可校准。', 'BPM detected. Adjust if needed.') : tempoStatus === 'unavailable' ? tempoFailure === 'large-file' ? text('视频超过150MB，暂不能本机分析。', 'Video exceeds 150MB; local analysis unavailable.') : tempoFailure === 'unsupported-audio' ? text('无法读取视频声音，可换视频重试。', 'Cannot read audio. Try another video.') : tempoFailure === 'analysis-timeout' ? text('分析超时，请重新分析。', 'Analysis timed out. Try again.') : tempoFailure === 'unstable' ? text('未找到稳定BPM，可重试或手动校准。', 'No stable BPM. Retry or calibrate manually.') : text('分析未完成，请重新分析。', 'Analysis could not finish. Try again.') : text('当前使用已保存或手动节拍。', 'Using saved or manual tempo.')}</p><div className="inline-controls"><input aria-label={text('每分钟节拍数', 'Beats per minute')} placeholder="BPM" type="number" min="40" max="240" value={bpmInput} onChange={event => { analysisRef.current?.abort(); cancelPendingLoop(); videoRef.current?.pause(); setBpmInput(event.target.value); setBpmError(''); setTempoStatus('editing'); setTempoFailure('') }} /><button type="button" disabled={!bpmInput} onClick={applyBpm}>{text('确认', 'Confirm')}</button><button type="button" disabled={tempoStatus === 'analyzing'} onClick={() => { if (fileRef.current) runTempoAnalysis(fileRef.current, bpm) }}>{text('重新分析', 'Analyze again')}</button></div>{bpmError && <p role="alert">{bpmError}</p>}</div>}
                {menuPage === 'custom' && <div className="compact-menu-body">{learningSegments.length > 1 ? <><div className="inline-controls"><select aria-label={text('分界', 'Boundary')} value={Math.min(selectedBoundaryIndex, learningSegments.length - 2)} onChange={event => { const index = Number(event.target.value); setSelectedBoundaryIndex(index); pauseAndSeek(learningSegments[index].endTime) }}>{learningSegments.slice(0, -1).map((segment, index) => <option value={index} key={segment.segmentIndex}>{index + 1} / {index + 2}</option>)}</select><button type="button" className="confirm-button" onClick={confirmSelectedBoundary}>{text('确认此处分段', 'Set boundary here')}</button><button type="button" onClick={() => setBoundaryOffsets(current => { const next = [...current]; next[selectedBoundaryIndex] = 0; return next })}>{text('恢复自动', 'Restore auto')}</button></div><p>{text('拖动下面进度条，再确认。', 'Seek below, then confirm.')}</p></> : <p>{text('先标记音乐与动作起点，生成至少两段。', 'Mark both starts to create at least two sections.')}</p>}</div>}
                {menuPage === 'sound' && <div className="compact-menu-body inline-controls"><button type="button" onClick={toggleMute}>{isMuted || volume === 0 ? text('取消静音', 'Unmute') : text('静音', 'Mute')}</button><input aria-label={text('音量', 'Volume')} type="range" min="0" max="1" step=".05" value={volume} onChange={changeVolume} /></div>}
                {menuPage === 'view' && <div className="compact-menu-body">{teacherFramingControls()}<p>{text('双指缩放，放大后拖动。重置恢复完整画面、默认大小和居中。', 'Pinch to zoom; drag to move. Reset restores full view, default size and center.')}</p></div>}
                {menuPage === 'recording' && <div className="compact-menu-body"><label>{text('倒计时', 'Countdown')} <select aria-label={text('录制倒计时', 'Recording countdown')} value={countdownSeconds} disabled={recordingStatus === 'countdown' || recordingStatus === 'recording'} onChange={event => setCountdownSeconds(Number(event.target.value) as 3 | 5 | 10)}>{[3,5,10].map(value => <option key={value} value={value}>{value}s</option>)}</select></label><p>{text('只录老师声音，不录麦克风；录像不上传。', 'Teacher audio only. No microphone, no uploads.')}</p>{recordingAudioNotice && <p role="status">{recordingAudioNotice}</p>}{recordingError && <p role="alert">{recordingError}</p>}</div>}
                {menuPage === 'help' && <div className="compact-menu-body"><p>{text('练习设置：拖进度条，先确认音乐起点，再确认动作起点，不用重开菜单。自动按八拍分段，第1段带预备拍。单段选3只练第3段；累加选3练第1–3段。箭头收起或展开段号。', 'Setup: seek and confirm Music start, then Dance start without reopening the menu. Auto sections use eight beats; section 1 includes preparation. Single + 3 practices section 3. Build-up + 3 practices 1–3. The arrow folds or opens section numbers.')}</p><p>{text('导入后自动识别音乐BPM，不识别动作。音乐不稳定时可重新分析或校准。', 'BPM is detected on import, not dance moves. Retry or calibrate if the rhythm is unclear.')}</p><p title={fileName}>{fileName} · {formatFileSize(fileSize)}</p></div>}
              </section>}
            />
          </div>

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
        {!videoUrl && error && <p className="error-message" role="alert">{error}</p>}
      </section>
    </main>
  )
}

export default App
