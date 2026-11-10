import { useCallback, useEffect, useRef, useState } from 'react'
import { computeAccentCurve } from './motionAccents.ts'
import { analyzeMotion } from '../beats/motionTempo.ts'
import type { MotionAnalysis } from '../beats/motionTempo.ts'
import { danceStats } from '../practice/danceStore.ts'
import { loadPoseTrack, poseCacheKey, savePoseTrack } from './poseCache.ts'
import { extractPoseTrack } from './poseClient.ts'
import type { TimedEvent } from '../beats/onset.ts'
import type { PoseTrack } from './types.ts'

export type PoseStatus = 'idle' | 'loading' | 'running' | 'ready' | 'failed' | 'cancelled'
export interface PoseState { status: PoseStatus; progress: number; failure: string; fromCache: boolean; accents: TimedEvent[]; detectedRate: number; motion: MotionAnalysis | null }
const IDLE: PoseState = { status: 'idle', progress: 0, failure: '', fromCache: false, accents: [], detectedRate: 0, motion: null }
const FPS = 15

function summarise(track: PoseTrack) {
  const curve = computeAccentCurve(track, 'speed')
  const accents = curve.peaks.map(peak => ({ time: peak.time, strength: peak.strength }))
  const motion = analyzeMotion(curve)
  const detectedRate = track.valid.length ? track.valid.reduce((sum, value) => sum + (value ? 1 : 0), 0) / track.valid.length : 0
  return { accents, detectedRate, motion }
}

/** Pose preprocessing for one video: IndexedDB cache first, otherwise MediaPipe in a Worker with progress. */
export function usePoseAccents(videoKey: string, videoUrl: string | null, wanted: boolean) {
  const [state, setState] = useState<PoseState>(IDLE)
  const controller = useRef<AbortController | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    controller.current?.abort()
    setState(IDLE)
    if (!wanted || !videoUrl || !videoKey) return
    const abort = new AbortController()
    controller.current = abort
    const key = poseCacheKey(videoKey, FPS)
    setState({ ...IDLE, status: 'loading' })
    void (async () => {
      const cached = await loadPoseTrack(key)
      if (abort.signal.aborted) return
      if (cached) { setState({ status: 'ready', progress: 1, failure: '', fromCache: true, ...summarise(cached) }); return }
      setState({ ...IDLE, status: 'running' }); danceStats().poseRuns++
      try {
        const track = await extractPoseTrack(videoUrl, {
          fps: FPS, signal: abort.signal,
          onProgress: progress => { if (!abort.signal.aborted) setState(current => ({ ...current, status: 'running', progress: progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0 })) },
        })
        if (abort.signal.aborted) return
        await savePoseTrack(key, track)
        setState({ status: 'ready', progress: 1, failure: '', fromCache: false, ...summarise(track) })
      } catch (failure) {
        if (abort.signal.aborted) return
        setState({ ...IDLE, status: 'failed', failure: failure instanceof Error ? failure.message : 'pose-failed' })
      }
    })()
    return () => abort.abort()
  }, [videoKey, videoUrl, wanted, attempt])

  const cancel = useCallback(() => { controller.current?.abort(); setState({ ...IDLE, status: 'cancelled' }) }, [])
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  return { pose: state, cancelPose: cancel, retryPose: retry }
}
