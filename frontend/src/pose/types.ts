export const POSE_LANDMARKS = 33
export const POSE_VERSION = 1
export const POSE_MODEL = 'pose_landmarker_lite'

/** Frame-by-frame body landmarks of one video. `points` holds [x, y, visibility] per landmark per frame
 *  (normalized image coordinates). Frames where no person was found have valid[i] === 0. */
export interface PoseTrack {
  version: number
  model: string
  fps: number
  width: number
  height: number
  duration: number
  times: Float32Array
  valid: Uint8Array
  points: Float32Array
}

export interface PoseProgress { done: number; total: number; stage: 'loading' | 'extracting' }

export const LM = {
  nose: 0, leftShoulder: 11, rightShoulder: 12, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftAnkle: 27, rightAnkle: 28,
} as const
