import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { buildLearningSegments, getPracticeRange, applyBoundaryOffsets } from '../src/practice/beatTimeline.ts'

test('single section 3 begins at section 3; cumulative section 3 includes preparation', () => {
  const sections = buildLearningSegments(30, 6, 2, 120)
  assert.deepEqual(getPracticeRange('current', sections, 2, 30, 120), { startTime: 14, endTime: 18 })
  assert.deepEqual(getPracticeRange('from-start', sections, 2, 30, 120), { startTime: 2, endTime: 18 })
})

test('large custom offsets never create backwards or overlapping segments', () => {
  const sections = buildLearningSegments(18, 2, 0, 120)
  const adjusted = applyBoundaryOffsets(sections, [100, -100, 100], 0, 120)
  for (let i = 0; i < adjusted.length; i++) {
    assert.ok(adjusted[i].endTime > adjusted[i].startTime)
    if (i) assert.equal(adjusted[i].startTime, adjusted[i - 1].endTime)
  }
  assert.equal(adjusted[0].startTime, 2)
  assert.equal(adjusted.at(-1)!.endTime, 18)
})

test('silence is rejected rather than inventing a usable tempo', async () => {
  const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
  assert.equal(estimateTempo(new Float32Array(22050 * 12), 22050), null)
})

for (const bpm of [40, 50, 80, 100, 120, 150, 190, 220, 240]) {
  test(`local rhythm estimator finds ${bpm} BPM in audible pulse audio`, async () => {
    const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
    const rate = 22050
    const samples = new Float32Array(rate * 24)
    for (let time = 0.3; time < 24; time += 60 / bpm) {
      for (let j = 0; j < rate * .09; j++) {
        const index = Math.round(time * rate) + j
        if (index < samples.length) samples[index] += .7 * Math.exp(-j / (rate * .016)) * Math.sin(2 * Math.PI * 110 * j / rate)
      }
    }
    const result = estimateTempo(samples, rate)
    assert.ok(result, 'audible regular beats must be detected')
    assert.ok(Math.abs(result.bpm - bpm) < 2, `expected ${bpm}, got ${result.bpm}`)
  })
}

for (const bpm of [132, 146, 178]) {
  test('a repeating three-beat bass pattern must not replace the ' + bpm + ' BPM pulse', async () => {
    const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
    const rate = 22050, samples = new Float32Array(rate * 48), beatLength = 60 / bpm
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate, age = t % beatLength, bassAge = t % (beatLength * 3)
      samples[i] = .85 * Math.sin(2*Math.PI*80*bassAge) * Math.exp(-bassAge/.05)
        + .25 * Math.sin(2*Math.PI*700*age) * Math.exp(-age/.015)
        + .1 * Math.sin(2*Math.PI*3300*age) * Math.exp(-age/.007)
    }
    const result = estimateTempo(samples, rate)
    assert.ok(result, 'consistent pulse evidence across bands should be recognized')
    assert.ok(Math.abs(result.bpm - bpm) < 2, 'expected ' + bpm + ', got ' + result.bpm)
    assert.ok(result.analyzedWindows >= 2, 'both audible windows must support the result')
  })
}

test('real she-goes-by clip does not mistake a three-beat repetition for the main pulse',
  { skip: !process.env.BPM_REGRESSION_VIDEO }, async () => {
    const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
    const bytes = execFileSync(process.env.FFMPEG_PATH || 'ffmpeg',
      ['-v','error','-i',process.env.BPM_REGRESSION_VIDEO!,'-vn','-ac','1','-ar','22050','-f','f32le','pipe:1'],
      { maxBuffer: 20 * 1024 * 1024 })
    const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const result = estimateTempo(samples, 22050)
    assert.ok(result, 'the real rhythmic clip should be recognized')
    assert.ok(Math.abs(result.bpm - 146) < 2, 'expected approximately 146, got ' + result.bpm)
    assert.ok(result.analyzedWindows >= 2, 'one surviving estimate is not multi-window confirmation')
  })

test('nearly tied competing non-octave rhythms are not presented as a certain BPM', async () => {
  const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
  const rate = 22050, samples = new Float32Array(rate * 24)
  for (let i = 0; i < samples.length; i++) {
    for (const bpm of [100, 150]) {
      const age = (i / rate) % (60 / bpm)
      samples[i] += .3 * (Math.sin(2*Math.PI*110*age) + Math.sin(2*Math.PI*700*age)) * Math.exp(-age/.016)
    }
  }
  assert.equal(estimateTempo(samples, rate), null)
})

test('one rhythmic window cannot stand in for multiple other audible unrecognized windows', async () => {
  const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
  const rate = 22050, samples = new Float32Array(rate * 72)
  let random = 7
  for (let i = 0; i < rate * 48; i++) {
    random = (random * 1664525 + 1013904223) >>> 0
    samples[i] = .3 * (random / 4294967296 * 2 - 1)
  }
  for (let time = 48.3; time < 72; time += .6) {
    for (let j = 0; j < rate * .09; j++) {
      const index = Math.round(time * rate) + j
      if (index < samples.length) samples[index] += .7 * Math.exp(-j/(rate*.016)) * Math.sin(2*Math.PI*110*j/rate)
    }
  }
  assert.equal(estimateTempo(samples, rate), null)
})

test('pinch and drag suppress playback clicks, including the last finger release', async () => {
  const { TeacherGesture } = await import('../src/practice/teacherGesture.ts')
  const gesture = new TeacherGesture()
  const framing = { zoom: 1, panX: 0, panY: 0 }
  gesture.start(1, 100, 100, framing)
  gesture.start(2, 200, 100, framing)
  assert.equal(gesture.move(2, 300, 100)?.zoom, 2)
  assert.equal(gesture.end(2), false)
  assert.equal(gesture.end(1), false)
  gesture.start(3, 100, 100, framing)
  gesture.move(3, 130, 100)
  assert.equal(gesture.end(3), false)
  gesture.start(4, 100, 100, framing)
  assert.equal(gesture.end(4), true)
})

test('marking starts with the old default BPM does not disable automatic recognition', async () => {
  const { normalizePracticeState } = await import('../src/practice/savedPractice.ts')
  assert.equal(normalizePracticeState({bpm:100, firstBeatTime:2, formalStartTime:6}).tempoMode, 'unset')
  assert.equal(normalizePracticeState({bpm:100, tempoMode:'manual', firstBeatTime:2}).tempoMode, 'manual')
  assert.equal(normalizePracticeState({bpm:0, tempoMode:'manual'}).tempoMode, 'unset')
})

test('music after a long silent introduction is analyzed rather than only the first 90 seconds', async () => {
  const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
  const rate = 11025, samples = new Float32Array(rate * 126)
  for (let time = 96; time < 126; time += 60 / 128) {
    for (let j = 0; j < rate * .08; j++) {
      const index = Math.round(time * rate) + j
      if (index < samples.length) samples[index] += .6 * Math.exp(-j / (rate * .02)) * Math.sin(2 * Math.PI * 95 * j / rate)
    }
  }
  const result = estimateTempo(samples, rate)
  assert.ok(result)
  assert.ok(Math.abs(result.bpm - 128) < 2, `expected 128, got ${result.bpm}`)
})

test('incompatible tempo sections are not passed off as one stable BPM', async () => {
  const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
  const rate = 11025, samples = new Float32Array(rate * 72)
  for (const [start, bpm] of [[0, 90], [24, 137], [48, 173]]) {
    for (let time = start + .3; time < start + 24; time += 60 / bpm) {
      for (let j = 0; j < rate * .08; j++) {
        const index = Math.round(time * rate) + j
        if (index < samples.length) samples[index] += .7 * Math.exp(-j / (rate * .016)) * Math.sin(2 * Math.PI * 110 * j / rate)
      }
    }
  }
  assert.equal(estimateTempo(samples, rate), null)
})

test('a sustained tone is not mistaken for musical beats', async () => {
  const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
  const rate = 11025, samples = Float32Array.from({length:rate*24}, (_, i) => .5 * Math.sin(2*Math.PI*440*i/rate))
  assert.equal(estimateTempo(samples, rate), null)
})

for (const seed of [1, 2, 3]) {
  test('unrhythmic white noise is rejected, seed ' + seed, async () => {
    const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
    let random = seed
    const samples = Float32Array.from({length:22050*24}, () => {
      random = (random * 1664525 + 1013904223) >>> 0
      return .3 * (random / 4294967296 * 2 - 1)
    })
    assert.equal(estimateTempo(samples, 22050), null)
  })
}

for (const bpm of [92, 128, 172]) {
  test('percussion with melody and subdivisions retains the ' + bpm + ' BPM beat', async () => {
    const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
    const rate = 22050, samples = new Float32Array(rate * 24)
    let random = 7
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate
      const beat = Math.floor(t / (60 / bpm)), age = t % (60 / bpm), halfAge = t % (30 / bpm)
      random = (random * 1664525 + 1013904223) >>> 0
      const noise = random / 4294967296 * 2 - 1
      samples[i] = .65 * Math.sin(2*Math.PI*95*age) * Math.exp(-age/.025)
        + .13 * noise * Math.exp(-halfAge/.012)
        + (beat % 2 ? .2 * noise * Math.exp(-age/.025) : 0)
        + .08 * Math.sin(2*Math.PI*[330,415,494,440][Math.floor(beat/4)%4]*t)
    }
    const result = estimateTempo(samples, rate)
    assert.ok(result)
    assert.ok(Math.abs(result.bpm - bpm) < 2, 'expected ' + bpm + ', got ' + result.bpm)
  })
}

test('saved settings reject invalid values and migrate the old range mode', async () => {
  const { normalizePracticeState } = await import('../src/practice/savedPractice.ts')
  const corrupt = normalizePracticeState({ bpm: 0, firstBeatTime: 'bad', formalStartTime: 'bad', currentSegmentIndex: 'bad' })
  assert.equal(corrupt.bpm, 100)
  assert.equal(corrupt.firstBeatTime, null)
  assert.equal(corrupt.formalStartTime, null)
  assert.equal(corrupt.currentSegmentIndex, 0)
  assert.equal(corrupt.firstBeatConfirmed, false)
  assert.equal(normalizePracticeState({rangeMode:'previous-current'}).rangeMode,'current')
  assert.equal(normalizePracticeState({bpm:120, firstBeatTime:2, formalStartTime:6, firstBeatConfirmed:true}).formalStartTime,6)
})
test('one-finger drag after a pinch starts from the last pinch framing', async () => {
  const { TeacherGesture } = await import('../src/practice/teacherGesture.ts')
  const gesture = new TeacherGesture()
  gesture.start(1,100,100,{zoom:1,panX:0,panY:0})
  gesture.start(2,200,100,{zoom:1,panX:0,panY:0})
  const before = gesture.move(2,300,100)!
  gesture.end(2)
  const after = gesture.move(1,110,100)!
  assert.equal(after.zoom,before.zoom)
  assert.equal(after.panX,before.panX+10)
  assert.equal(gesture.end(1),false)
})
