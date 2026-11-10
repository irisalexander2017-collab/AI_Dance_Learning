/* Classic Web Worker: runs MediaPipe PoseLandmarker off the UI thread.
   Messages in : {type:'init', base, model, delegate} | {type:'frame', id, bitmap, timestampMs} | {type:'close'}
   Messages out: {type:'ready', delegate} | {type:'error', message} | {type:'result', id, points|null}
   `points` is a Float32Array(33*3) of [x, y, visibility] in normalized image coordinates. */
let landmarker = null
let delegateUsed = 'CPU'
self.onmessage = async (event) => {
  const msg = event.data
  try {
    if (msg.type === 'init') {
      importScripts(msg.base + 'mediapipe/vision_bundle.js')
      const fileset = await Vision.FilesetResolver.forVisionTasks(msg.base + 'mediapipe/wasm')
      const make = (delegate) => Vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: msg.model, delegate },
        runningMode: 'VIDEO', numPoses: 1, canvas: new OffscreenCanvas(1, 1),
      })
      try { landmarker = await make('CPU'); delegateUsed = 'CPU' }
      catch (cpuError) { landmarker = await make('GPU'); delegateUsed = 'GPU' }
      self.postMessage({ type: 'ready', delegate: delegateUsed })
    } else if (msg.type === 'frame') {
      const result = landmarker.detectForVideo(msg.bitmap, msg.timestampMs)
      msg.bitmap.close()
      const pose = result.landmarks && result.landmarks[0]
      let points = null
      if (pose) {
        points = new Float32Array(33 * 3)
        for (let i = 0; i < 33; i++) {
          points[i * 3] = pose[i].x; points[i * 3 + 1] = pose[i].y
          points[i * 3 + 2] = pose[i].visibility === undefined ? 1 : pose[i].visibility
        }
      }
      self.postMessage({ type: 'result', id: msg.id, points }, points ? [points.buffer] : [])
    } else if (msg.type === 'close') {
      if (landmarker) landmarker.close()
      self.close()
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: msg.id, message: String(error && error.message ? error.message : error) })
  }
}
