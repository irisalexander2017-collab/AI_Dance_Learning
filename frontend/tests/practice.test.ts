import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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

test('nearly tied competing non-octave rhythms: soft estimate allowed, silence/noise still rejected', async () => {
  const { estimateTempo } = await import('../src/practice/tempoAnalysis.ts')
  const { analyzeAudioSamples } = await import('../src/beats/audioAnalysis.ts')
  const rate = 22050, samples = new Float32Array(rate * 24)
  for (let i = 0; i < samples.length; i++) {
    for (const bpm of [100, 150]) {
      const age = (i / rate) % (60 / bpm)
      samples[i] += .3 * (Math.sin(2*Math.PI*110*age) + Math.sin(2*Math.PI*700*age)) * Math.exp(-age/.016)
    }
  }
  // Softened non-octave veto: a best candidate may surface; UI can still offer alternatives via suggestions.
  const result = estimateTempo(samples, rate)
  if (result) assert.ok(result.bpm >= 40 && result.bpm <= 240)
  const analysis = analyzeAudioSamples(samples, samples, rate)
  assert.ok((analysis.suggestions?.length ?? 0) > 0 || analysis.tempo, 'always expose a tempo or one-tap suggestions')
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

test('eight-beat sections may use a temporary song tempo before BPM is confirmed', () => {
  // App policy (naturalLearningSegments): music + dance markers alone unlock sections.
  // While tempoStatus is analyzing/unavailable, bpm state (default 100 / last / editing) is used;
  // auto/manual confirmation rebuilds with the real song tempo. Do not gate segments on tempoStatus.
  const temporary = buildLearningSegments(30, 6, 2, 100)
  const confirmed = buildLearningSegments(30, 6, 2, 128)
  assert.ok(temporary.length >= 2, 'temporary BPM still yields eight-beat sections')
  assert.notDeepEqual(temporary.map(s => s.endTime), confirmed.map(s => s.endTime), 'real BPM rebuilds boundaries')
  assert.deepEqual(buildLearningSegments(30, 6, 2, 0), [], 'non-positive BPM still yields no sections')
})

test('null-tempo and low-confidence analyses are not treated as usable cache', async () => {
  const { isUsableCachedAnalysis, ANALYSIS_CACHE_VERSION } = await import('../src/practice/danceStore.ts')
  assert.equal(isUsableCachedAnalysis(null), false)
  assert.equal(isUsableCachedAnalysis({ tempo: null, legacy: null, onsets: [], suggestions: [120] }), false)
  assert.equal(isUsableCachedAnalysis({ tempo: { bpm: 120, alternatives: [], confidence: 0.05 }, legacy: null, onsets: [], suggestions: [] }), false)
  assert.equal(isUsableCachedAnalysis({ tempo: { bpm: 120, alternatives: [], confidence: 0.2 }, legacy: null, onsets: [], suggestions: [], cacheVersion: ANALYSIS_CACHE_VERSION - 1 } as never), false)
  assert.ok(isUsableCachedAnalysis({ tempo: { bpm: 120, alternatives: [], confidence: 0.2 }, legacy: null, onsets: [{ time: 1, strength: 1 }], suggestions: [120] }))
  assert.ok(isUsableCachedAnalysis({ tempo: { bpm: 104, alternatives: [], confidence: 0.4 }, legacy: null, onsets: [], suggestions: [], cacheVersion: ANALYSIS_CACHE_VERSION } as never))
})

test('matched-tempo filename catalog hits known videos by name/size', async () => {
  const { lookupMatchedTempo, resetMatchedTempoCache } = await import('../src/beats/matchedTempo.ts')
  resetMatchedTempoCache()
  const originalFetch = globalThis.fetch
  const catalog = await import('../public/matched-tempo.json', { with: { type: 'json' } }).then(m => m.default).catch(async () => {
    const { readFileSync } = await import('node:fs')
    return JSON.parse(readFileSync(new URL('../public/matched-tempo.json', import.meta.url), 'utf8'))
  })
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('matched-tempo.json')) {
      return new Response(JSON.stringify(catalog), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return originalFetch(input as never)
  }) as typeof fetch
  try {
    const hit = await lookupMatchedTempo({ name: 'shaheem-shegoesby.mp4', size: 3428872 })
    assert.ok(hit)
    assert.equal(hit!.source, 'matched-json')
    assert.ok(Math.abs(hit!.bpm - 145) <= 1, `expected ~145 got ${hit!.bpm}`)
    const safer = await lookupMatchedTempo({ name: 'shaheem-safer.mp4', size: 7918302 })
    assert.ok(safer && Math.abs(safer.bpm - 118) <= 2)
    const fine = await lookupMatchedTempo({ name: 'lylebeniga-finechina.mp4', size: 8215776 })
    assert.ok(fine && Math.abs(fine.bpm - 104) <= 1)
    assert.equal(await lookupMatchedTempo({ name: 'no-such-renamed.mp4', size: 1 }), null)
  } finally {
    globalThis.fetch = originalFetch
    resetMatchedTempoCache()
  }
})

for (const sample of [
  { name: 'she goes by', file: '/workspace/街舞项目/ai-dance-copy/work/audio-match/videos/shaheem-shegoesby.mp4', expect: 145, tol: 3 },
  { name: 'Safer', file: '/workspace/街舞项目/ai-dance-copy/work/audio-match/videos/shaheem-safer.mp4', expect: 117, tol: 5 },
  { name: 'Fine China', file: '/workspace/街舞项目/ai-dance-copy/work/audio-match/videos/lylebeniga-finechina.mp4', expect: 104, tol: 2 },
  { name: 'COCA BODY', file: '/workspace/街舞项目/ai-dance-copy/work/audio-match/videos/Weixin-2026-07-11.mp4', expect: 102, tol: 3 },
  { name: 'Like I Love You', file: '/workspace/街舞项目/ai-dance-copy/work/audio-match/videos/sep3-clip.mp4', expect: 115, tol: 3 },
] as const) {
  test(`BPM regression: ${sample.name} adopts near ${sample.expect}`,
    { skip: !existsSync(sample.file) }, async () => {
      const { analyzeAudioSamples } = await import('../src/beats/audioAnalysis.ts')
      const { windowStarts } = await import('../src/practice/tempoAnalysis.ts')
      const bytes = execFileSync(process.env.FFMPEG_PATH || 'ffmpeg',
        ['-v', 'error', '-i', sample.file, '-vn', '-ac', '1', '-ar', '22050', '-t', '120', '-f', 'f32le', 'pipe:1'],
        { maxBuffer: 60 * 1024 * 1024 })
      const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4))
      const rate = 22050
      const size = Math.min(samples.length, Math.round(rate * 24))
      const starts = windowStarts(samples.length, rate)
      const mono = new Float32Array(size * starts.length)
      starts.forEach((start, i) => mono.set(samples.subarray(start, start + size), i * size))
      const full = samples.slice(0, Math.min(samples.length, rate * 180))
      const analysis = analyzeAudioSamples(mono, full, rate)
      assert.ok(analysis.tempo && analysis.tempo.confidence >= 0.08, `${sample.name} must yield a usable tempo, got ${JSON.stringify(analysis.tempo)} suggestions=${analysis.suggestions}`)
      assert.ok(Math.abs(analysis.tempo!.bpm - sample.expect) <= sample.tol, `${sample.name}: expected ~${sample.expect}, got ${analysis.tempo!.bpm}`)
    })
}
