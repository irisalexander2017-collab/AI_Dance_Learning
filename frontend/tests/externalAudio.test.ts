import assert from 'node:assert/strict'
import test from 'node:test'

test('onset envelope reacts to energy rises and normalizes', async () => {
  const { onsetEnvelope } = await import('../src/practice/externalAudio.ts')
  const sr = 1000
  const samples = new Float32Array(sr * 4)
  // Quiet then a burst at t=2.0s
  for (let i = Math.floor(2 * sr); i < Math.floor(2.05 * sr); i++) samples[i] = 1
  const env = onsetEnvelope(samples, sr, 50)
  assert.ok(env.length > 50)
  const peakAt = env.indexOf(Math.max(...env))
  assert.ok(Math.abs(peakAt / 50 - 2) < 0.15, `peak frame ${peakAt} → ${peakAt / 50}s`)
})

test('cross-correlation recovers a known positive offset', async () => {
  const { onsetEnvelope, estimateAudioOffset, externalTimeAt } = await import('../src/practice/externalAudio.ts')
  const sr = 2000
  const fps = 50
  const make = (hits: number[]) => {
    const samples = new Float32Array(sr * 8)
    for (const t of hits) {
      const i0 = Math.floor(t * sr)
      for (let i = i0; i < i0 + 40 && i < samples.length; i++) samples[i] = 1
    }
    return onsetEnvelope(samples, sr, fps)
  }
  // Same pattern, but external events are 1.2 s earlier in the file than in the video timeline
  // → video hits at 2,3,4,5 while external hits at 0.8,1.8,2.8,3.8 → offset = +1.2
  const video = make([2, 3, 4, 5])
  const external = make([0.8, 1.8, 2.8, 3.8])
  const guess = estimateAudioOffset(video, external, fps, 5)
  assert.ok(Math.abs(guess.offsetSeconds - 1.2) < 0.08, `got ${guess.offsetSeconds}`)
  assert.ok(guess.score > 0.3, `score ${guess.score}`)
  assert.equal(externalTimeAt(3, guess.offsetSeconds).toFixed(2), (3 - guess.offsetSeconds).toFixed(2))
})

test('cross-correlation recovers a negative offset', async () => {
  const { onsetEnvelope, estimateAudioOffset } = await import('../src/practice/externalAudio.ts')
  const sr = 2000
  const fps = 50
  const make = (hits: number[]) => {
    const samples = new Float32Array(sr * 8)
    for (const t of hits) {
      const i0 = Math.floor(t * sr)
      for (let i = i0; i < i0 + 40 && i < samples.length; i++) samples[i] = 1
    }
    return onsetEnvelope(samples, sr, fps)
  }
  // External content lags the video by 0.8 s → offset ≈ -0.8
  const video = make([1, 2, 3, 4])
  const external = make([1.8, 2.8, 3.8, 4.8])
  const guess = estimateAudioOffset(video, external, fps, 5)
  assert.ok(Math.abs(guess.offsetSeconds - (-0.8)) < 0.08, `got ${guess.offsetSeconds}`)
})

test('isExternalAudioFile accepts common extensions', async () => {
  const { isExternalAudioFile } = await import('../src/practice/externalAudio.ts')
  assert.equal(isExternalAudioFile(new File([], 'a.mp3', { type: 'audio/mpeg' })), true)
  assert.equal(isExternalAudioFile(new File([], 'a.wav')), true)
  assert.equal(isExternalAudioFile(new File([], 'a.aac')), true)
  assert.equal(isExternalAudioFile(new File([], 'clip.mp4')), false)
})

test('empty envelopes yield zero offset', async () => {
  const { estimateAudioOffset } = await import('../src/practice/externalAudio.ts')
  assert.deepEqual(estimateAudioOffset(new Float32Array(0), new Float32Array(10), 50), { offsetSeconds: 0, score: 0, fps: 50 })
})
