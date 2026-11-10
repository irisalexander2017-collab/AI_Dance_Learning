import { LM, POSE_LANDMARKS, type PoseTrack } from './types.ts'

export interface AccentPeak { time: number; strength: number }
export interface AccentCurve { dt: number; values: Float32Array; peaks: AccentPeak[] }
export type AccentKind = 'speed' | 'impact'

const GRID_HZ = 100
const JOINT_GROUPS: { ids: number[]; weight: number }[] = [
  { ids: [LM.leftWrist, LM.rightWrist], weight: 0.9 },
  { ids: [LM.leftAnkle, LM.rightAnkle], weight: 0.8 },
  { ids: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip], weight: 1.0 }, // torso centre
]

function gaussianSmooth(values: Float32Array, sigmaSamples: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigmaSamples * 3))
  const kernel = Float32Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-0.5 * ((i - radius) / sigmaSamples) ** 2))
  const norm = kernel.reduce((a, b) => a + b, 0)
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    let sum = 0
    for (let k = -radius; k <= radius; k++) { const j = i + k; if (j >= 0 && j < values.length) sum += values[j] * kernel[k + radius] }
    out[i] = sum / norm
  }
  return out
}

function percentile(values: ArrayLike<number>, q: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b)
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

/** Position (pixels) of a landmark group centre in frame i, or null when it is not reliably visible. */
function groupCentre(track: PoseTrack, frame: number, ids: number[]): [number, number] | null {
  if (!track.valid[frame]) return null
  let x = 0, y = 0
  for (const id of ids) {
    const base = (frame * POSE_LANDMARKS + id) * 3
    if (track.points[base + 2] < 0.35) return null
    x += track.points[base] * track.width; y += track.points[base + 1] * track.height
  }
  return [x / ids.length, y / ids.length]
}

function torsoLength(track: PoseTrack): number {
  const lengths: number[] = []
  for (let i = 0; i < track.times.length; i++) {
    const shoulders = groupCentre(track, i, [LM.leftShoulder, LM.rightShoulder])
    const hips = groupCentre(track, i, [LM.leftHip, LM.rightHip])
    if (shoulders && hips) lengths.push(Math.hypot(shoulders[0] - hips[0], shoulders[1] - hips[1]))
  }
  return lengths.length ? percentile(lengths, 0.5) : track.height * 0.25
}

/** Accent strength over time on a uniform 100 Hz grid. 'speed' = movement speed of wrists, ankles and torso
 *  (scaled by torso length); 'impact' = how quickly that speed collapses, i.e. the moment a move is "hit". */
export function computeAccentCurve(track: PoseTrack, kind: AccentKind = 'speed'): AccentCurve {
  const n = track.times.length
  const duration = n ? track.times[n - 1] : 0
  const size = Math.max(1, Math.ceil(duration * GRID_HZ) + 1)
  const dt = 1 / GRID_HZ
  const torso = Math.max(1, torsoLength(track))
  const total = new Float32Array(size)
  for (const group of JOINT_GROUPS) {
    // Resample the group centre onto the uniform grid; gaps wider than 0.4 s stay empty.
    const known: { t: number; x: number; y: number }[] = []
    for (let i = 0; i < n; i++) { const c = groupCentre(track, i, group.ids); if (c) known.push({ t: track.times[i], x: c[0], y: c[1] }) }
    if (known.length < 3) continue
    const xs = new Float32Array(size), ys = new Float32Array(size), ok = new Uint8Array(size)
    let k = 0
    for (let g = 0; g < size; g++) {
      const t = g * dt
      while (k + 1 < known.length && known[k + 1].t < t) k++
      const a = known[k], b = known[Math.min(known.length - 1, k + 1)]
      if (t < known[0].t || t > known[known.length - 1].t || b.t - a.t > 0.4) continue
      const f = b.t === a.t ? 0 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)))
      xs[g] = a.x + (b.x - a.x) * f; ys[g] = a.y + (b.y - a.y) * f; ok[g] = 1
    }
    const sx = gaussianSmooth(xs, 0.03 * GRID_HZ), sy = gaussianSmooth(ys, 0.03 * GRID_HZ)
    const speed = new Float32Array(size)
    for (let g = 1; g < size - 1; g++) {
      if (!ok[g - 1] || !ok[g + 1]) continue
      speed[g] = Math.hypot(sx[g + 1] - sx[g - 1], sy[g + 1] - sy[g - 1]) / (2 * dt) / torso
    }
    const scale = Math.max(1e-3, percentile(Array.from(speed).filter((_, g) => ok[g]), 0.95))
    for (let g = 0; g < size; g++) total[g] += group.weight * Math.min(2, speed[g] / scale)
  }
  let values = gaussianSmooth(total, 0.025 * GRID_HZ)
  if (kind === 'impact') {
    const impact = new Float32Array(size)
    const lag = Math.round(0.06 * GRID_HZ)
    for (let g = lag; g < size; g++) impact[g] = Math.max(0, values[g - lag] - values[g])
    values = gaussianSmooth(impact, 0.015 * GRID_HZ)
  }
  return { dt, values, peaks: pickPeaks(values, dt) }
}

export function pickPeaks(values: Float32Array, dt: number, minGap = 0.14): AccentPeak[] {
  if (values.length < 3) return []
  const med = percentile(values, 0.5), high = percentile(values, 0.9)
  const threshold = med + 0.5 * Math.max(1e-4, high - med)
  const candidates: AccentPeak[] = []
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] < threshold || values[i] < values[i - 1] || values[i] <= values[i + 1]) continue
    const left = values[i - 1], centre = values[i], right = values[i + 1]
    const denominator = left - 2 * centre + right
    const shift = denominator < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator)) : 0
    candidates.push({ time: (i + shift) * dt, strength: (centre - med) / Math.max(1e-4, high - med) })
  }
  // Keep the stronger of two peaks that are closer than minGap.
  candidates.sort((a, b) => b.strength - a.strength)
  const kept: AccentPeak[] = []
  for (const peak of candidates) if (kept.every(other => Math.abs(other.time - peak.time) >= minGap)) kept.push(peak)
  return kept.sort((a, b) => a.time - b.time)
}
