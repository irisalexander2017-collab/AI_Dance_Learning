import { POSE_LANDMARKS, POSE_MODEL, POSE_VERSION, type PoseProgress, type PoseTrack } from './types.ts'

export interface ExtractOptions {
  fps?: number
  signal?: AbortSignal
  onProgress?: (progress: PoseProgress) => void
  /** Site base URL, defaults to Vite's BASE_URL. */
  base?: string
  /** 'play' decodes sequentially (fast, default when requestVideoFrameCallback exists); 'seek' steps frame by frame. */
  mode?: 'play' | 'seek'
  playbackRate?: number
}

const SEEK_TIMEOUT_MS = 8000

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail); resolve() }
    const fail = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail); reject(new Error('seek-failed')) }
    const timer = setTimeout(done, SEEK_TIMEOUT_MS)
    video.addEventListener('seeked', done); video.addEventListener('error', fail)
    video.currentTime = time
  })
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true; video.playsInline = true; video.preload = 'auto'
    video.onloadeddata = () => { if (video.videoWidth > 0 && video.videoHeight > 0) resolve(video); else reject(new Error('video-unsupported')) }
    video.onerror = () => reject(new Error('video-unsupported'))
    video.src = url
  })
}

/** Reads every 1/fps second of the video with a hidden element, hands the frames to a Web Worker that runs
 *  MediaPipe PoseLandmarker, and returns the landmark track. The UI thread only seeks and copies bitmaps. */
export async function extractPoseTrack(videoUrl: string, options: ExtractOptions = {}): Promise<PoseTrack> {
  const fps = options.fps ?? 15
  const base = options.base ?? import.meta.env.BASE_URL
  const abs = new URL(base, location.href).href
  const aborted = () => options.signal?.aborted === true
  const abortError = () => new DOMException('Cancelled', 'AbortError')
  if (aborted()) throw abortError()
  options.onProgress?.({ done: 0, total: 0, stage: 'loading' })
  const worker = new Worker(`${abs}pose-worker.js`)
  const pending = new Map<number, { resolve: (value: Float32Array | null) => void; reject: (reason: Error) => void }>()
  let fatal: Error | null = null
  let readyResolve: (() => void) | null = null
  let readyReject: ((reason: Error) => void) | null = null
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  worker.onmessage = (event: MessageEvent<{ type: string; id?: number; points?: Float32Array | null; message?: string }>) => {
    const data = event.data
    if (data.type === 'ready') readyResolve?.()
    else if (data.type === 'result' && data.id !== undefined) { pending.get(data.id)?.resolve(data.points ?? null); pending.delete(data.id) }
    else if (data.type === 'error') {
      const error = new Error(data.message || 'pose-worker-error')
      if (data.id !== undefined && pending.has(data.id)) { pending.get(data.id)!.reject(error); pending.delete(data.id) }
      else { fatal = error; readyReject?.(error); pending.forEach(item => item.reject(error)); pending.clear() }
    }
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || 'pose-worker-crashed')
    fatal = error; readyReject?.(error); pending.forEach(item => item.reject(error)); pending.clear()
  }
  const abortListener = () => { const error = abortError(); fatal = error; readyReject?.(error); pending.forEach(item => item.reject(error)); pending.clear() }
  options.signal?.addEventListener('abort', abortListener, { once: true })
  try {
    worker.postMessage({ type: 'init', base: abs, model: `${abs}models/${POSE_MODEL}.task` })
    const video = await loadVideo(videoUrl)
    await ready
    const width = video.videoWidth, height = video.videoHeight
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('video-unsupported')
    const capacity = Math.ceil(duration * fps * 1.5) + 8
    const times = new Float32Array(capacity)
    const valid = new Uint8Array(capacity)
    const points = new Float32Array(capacity * POSE_LANDMARKS * 3)
    let count = 0
    let lastStamp = -1
    const request = (id: number, time: number, bitmap: ImageBitmap) => {
      const stamp = Math.max(lastStamp + 1, Math.round(time * 1000)); lastStamp = stamp
      return new Promise<Float32Array | null>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        worker.postMessage({ type: 'frame', id, bitmap, timestampMs: stamp }, [bitmap])
      })
    }
    const record = (index: number, time: number, landmarks: Float32Array | null) => {
      times[index] = time
      if (landmarks) { valid[index] = 1; points.set(landmarks, index * POSE_LANDMARKS * 3) }
      if (index % 5 === 0) options.onProgress?.({ done: Math.min(duration, time) , total: duration, stage: 'extracting' })
    }
    const mode = options.mode ?? ('requestVideoFrameCallback' in video ? 'play' : 'seek')
    if (mode === 'seek') {
      const total = Math.max(1, Math.floor(duration * fps))
      const grab = async (index: number) => {
        const time = Math.min(duration - 0.001, index / fps)
        await seek(video, time)
        return { time, bitmap: await createImageBitmap(video) }
      }
      let nextFrame = grab(0); nextFrame.catch(() => undefined)
      for (let index = 0; index < total; index++) {
        if (fatal || aborted()) throw fatal ?? abortError()
        const { time, bitmap } = await nextFrame
        if (index + 1 < total) { nextFrame = grab(index + 1); nextFrame.catch(() => undefined) }
        record(index, time, await request(index, time, bitmap)); count = index + 1
      }
    } else {
      // Sequential decoding is much faster than seeking for long-GOP phone videos.
      video.playbackRate = options.playbackRate ?? 2
      let inflight = 0, nextTime = 0
      const tasks: Promise<void>[] = []
      await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => { video.pause(); reject(error) }
        const resume = () => { if (video.paused && !video.ended && inflight < 2) void video.play().catch(() => undefined) }
        const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
          if (fatal || aborted()) { fail(fatal ?? abortError()); return }
          const time = metadata.mediaTime
          if (time >= nextTime - 0.002 && count < capacity) {
            nextTime = Math.max(nextTime + 1 / fps, time + 0.5 / fps)
            const index = count++
            inflight++
            if (inflight >= 3) video.pause()
            tasks.push(createImageBitmap(video).then(bitmap => request(index, time, bitmap)).then(result => { record(index, time, result) }).finally(() => { inflight--; resume() }))
          }
          if (video.ended) resolve(); else video.requestVideoFrameCallback(onFrame)
        }
        video.addEventListener('ended', () => resolve(), { once: true })
        video.requestVideoFrameCallback(onFrame)
        video.play().catch(() => fail(new Error('video-unsupported')))
      })
      await Promise.all(tasks)
      if (fatal || aborted()) throw fatal ?? abortError()
    }
    options.onProgress?.({ done: duration, total: duration, stage: 'extracting' })
    video.pause(); video.removeAttribute('src'); video.load()
    const used = Math.max(1, count)
    const order = Array.from({ length: used }, (_, i) => i).sort((a, b) => times[a] - times[b])
    const sortedTimes = Float32Array.from(order, i => times[i])
    const sortedValid = Uint8Array.from(order, i => valid[i])
    const sortedPoints = new Float32Array(used * POSE_LANDMARKS * 3)
    order.forEach((from, to) => sortedPoints.set(points.subarray(from * POSE_LANDMARKS * 3, (from + 1) * POSE_LANDMARKS * 3), to * POSE_LANDMARKS * 3))
    return { version: POSE_VERSION, model: POSE_MODEL, fps, width, height, duration, times: sortedTimes, valid: sortedValid, points: sortedPoints }
  } finally {
    options.signal?.removeEventListener('abort', abortListener)
    worker.postMessage({ type: 'close' })
    setTimeout(() => worker.terminate(), 200)
  }
}
