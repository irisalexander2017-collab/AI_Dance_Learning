import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0))
const box = (type: string, ...body: number[][]) => { const data = body.flat(); return [...be32(8 + data.length), ...ascii(type), ...data] }
const dataAtom = (flags: number, payload: number[]) => box('data', [0, 0, 0, flags], [0, 0, 0, 0], payload)
const mp4With = (ilstItems: number[]) => new Uint8Array([...box('ftyp', ascii('isom'), be32(512)), ...box('moov', box('udta', box('meta', [0, 0, 0, 0], box('hdlr', new Array(24).fill(0)), box('ilst', ilstItems)))), ...box('mdat', [1, 2, 3])])

test('MP4 tmpo atom is read, including when moov comes after mdat', async () => {
  const { readEmbeddedTempo, bufferSource } = await import('../src/beats/metadata.ts')
  const tmpo = box('tmpo', dataAtom(21, [0, 128]))
  assert.deepEqual(await readEmbeddedTempo(bufferSource(mp4With(tmpo))), { bpm: 128, source: 'mp4-tmpo' })
  const swapped = new Uint8Array([...box('ftyp', ascii('isom'), be32(0)), ...box('mdat', new Array(40).fill(7)), ...mp4With(tmpo).slice(box('ftyp', ascii('isom'), be32(512)).length, -box('mdat', [1, 2, 3]).length)])
  assert.equal((await readEmbeddedTempo(bufferSource(swapped)))?.bpm, 128)
})

test('iTunes freeform BPM and out-of-range tags', async () => {
  const { readEmbeddedTempo, bufferSource } = await import('../src/beats/metadata.ts')
  const freeform = box('----', box('mean', [0, 0, 0, 0], ascii('com.apple.iTunes')), box('name', [0, 0, 0, 0], ascii('BPM')), dataAtom(1, ascii('96.5')))
  assert.deepEqual(await readEmbeddedTempo(bufferSource(mp4With(freeform))), { bpm: 96.5, source: 'mp4-freeform' })
  assert.equal(await readEmbeddedTempo(bufferSource(mp4With(box('tmpo', dataAtom(21, [0, 5]))))), undefined, 'a nonsense 5 BPM tag is ignored')
  assert.equal(await readEmbeddedTempo(bufferSource(mp4With(box('tmpo', dataAtom(21, [3, 232]))))), undefined, '1000 BPM is ignored')
})

test('ID3 TBPM in v2.2, v2.3 and v2.4', async () => {
  const { readEmbeddedTempo, bufferSource } = await import('../src/beats/metadata.ts')
  const synch = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]
  const frame = (id: string, text: string, version: number) => {
    const body = [3, ...ascii(text)]
    return version === 2 ? [...ascii(id), (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...body]
      : [...ascii(id), ...(version === 4 ? synch(body.length) : be32(body.length)), 0, 0, ...body]
  }
  const tag = (version: number, id: string, text: string) => {
    const frames = [...frame('TIT2', 'x', version === 2 ? 3 : version).slice(0, 0), ...frame(id, text, version)]
    return new Uint8Array([...ascii('ID3'), version, 0, 0, ...synch(frames.length), ...frames, 0, 0, 0, 0])
  }
  assert.equal((await readEmbeddedTempo(bufferSource(tag(3, 'TBPM', '124'))))?.bpm, 124)
  assert.equal((await readEmbeddedTempo(bufferSource(tag(4, 'TBPM', '87.5'))))?.bpm, 87.5)
  assert.deepEqual(await readEmbeddedTempo(bufferSource(tag(2, 'TBP', '101'))), { bpm: 101, source: 'id3-tbpm' })
  assert.equal(await readEmbeddedTempo(bufferSource(tag(3, 'TXXX', '124'))), undefined)
})

test('untagged, empty and truncated files never throw', async () => {
  const { readEmbeddedTempo, bufferSource } = await import('../src/beats/metadata.ts')
  assert.equal(await readEmbeddedTempo(bufferSource(new Uint8Array(0))), undefined)
  assert.equal(await readEmbeddedTempo(bufferSource(new Uint8Array([0, 0, 0, 20, ...ascii('moov'), 1, 2]))), undefined)
  assert.equal(await readEmbeddedTempo(bufferSource(mp4With(new Array(3).fill(255)))), undefined)
})

test('a real ffmpeg-written tmpo tag is found (skipped without ffmpeg)', async (t) => {
  const { readEmbeddedTempo, bufferSource } = await import('../src/beats/metadata.ts')
  const out = join(mkdtempSync(join(tmpdir(), 'tmpo-')), 'tagged.mp4')
  try { execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=d=1:s=64x64', '-f', 'lavfi', '-i', 'sine=d=1', '-metadata', 'tmpo=121', '-y', out]) } catch { t.skip('ffmpeg unavailable'); return }
  assert.deepEqual(await readEmbeddedTempo(bufferSource(new Uint8Array(readFileSync(out)))), { bpm: 121, source: 'mp4-tmpo' })
})

test('beat grid labels, words and the eight-count wrap (fixed 1 & 2 & layout)', async () => {
  // Points are keyed beat·4 + sub (sub 0 = the number, 1..3 = extra hits); BPM here is the number-beat tempo.
  const { pointAt, activePoint } = await import('../src/beats/grid.ts')
  const grid = { bpm: 120, anchor: 2, adjust: {} }
  assert.deepEqual([0, 1, 4, 5, 28, 29, 32, 33].map(i => pointAt(grid, i)!.label), ['1', '&', '2', '&', '8', '&', '1', '&'])
  assert.deepEqual([0, 1, 4, 28, 32].map(i => pointAt(grid, i)!.word), ['one', 'and', 'two', 'eight', 'one'])
  assert.equal(pointAt(grid, 4)!.time, 2.5)
  assert.equal(pointAt(grid, 2), null, 'the fixed layout has one "&" per beat')
  assert.equal(pointAt(grid, -4)!.label, '8', 'counts continue backwards before the first beat')
  assert.equal(activePoint(grid, 2.1).label, '1')
  assert.equal(activePoint(grid, 2.26).label, '&')
  assert.equal(activePoint(grid, 1.99).label, '&')
})

test('beat grid with a follow-the-teacher pattern: 0–3 extras map to &, e a, e & a', async () => {
  const { pointAt, pointsBetween, planCountEvents, subSyllable } = await import('../src/beats/grid.ts')
  assert.deepEqual(subSyllable(0, 0), { label: '&', word: 'and' }) // unused path; safe default
  assert.deepEqual([subSyllable(1, 0).label], ['&'])
  assert.deepEqual([0, 1].map(i => subSyllable(2, i).label), ['e', 'a'])
  assert.deepEqual([0, 1, 2].map(i => subSyllable(3, i).label), ['e', '&', 'a'])
  const grid = { bpm: 60, anchor: 10, adjust: {}, subs: { 0: [], 1: [0.5], 2: [1 / 3, 2 / 3], 3: [0.25, 0.5, 0.75] } }
  const points = pointsBetween(grid, 10, 14)
  assert.deepEqual(points.map(p => p.label), ['1', '2', '&', '3', 'e', 'a', '4', 'e', '&', 'a'])
  assert.deepEqual(points.map(p => Math.round(p.time * 100) / 100), [10, 11, 11.5, 12, 12.33, 12.67, 13, 13.25, 13.5, 13.75])
  assert.equal(pointAt(grid, 1), null, 'beat 1 has no extra hit when the teacher made one move')
  assert.deepEqual(planCountEvents(grid, 10, 14, false).map(e => e.word), ['one', 'two', 'three', 'four'], 'numbers-only mode drops every extra hit')
  assert.equal(pointAt({ ...grid, subs: null }, 1)!.time, 10.5, 'subs=null falls back to the fixed "&" at the half beat')
  assert.equal(pointAt({ ...grid, subs: null }, 1)!.label, '&')
  assert.equal(pointAt({ ...grid, subs: {} }, 1), null, 'empty subs object means numbers only (explicit 0 extras)')
})

test('BPM changes move the beat points but never the free-cut boundaries', async () => {
  const { buildCustomSegments, addCut, moveCut, removeCut, evenCutsFromFirst } = await import('../src/practice/customSegments.ts')
  const { buildLearningSegments } = await import('../src/practice/beatTimeline.ts')
  const cuts = [3.17, 11.4, 12.2]
  const before = buildCustomSegments(cuts, 40)
  const beats100 = buildLearningSegments(40, 2, 2, 100), beats140 = buildLearningSegments(40, 2, 2, 140)
  assert.notDeepEqual(beats100.map(s => s.endTime), beats140.map(s => s.endTime))
  assert.deepEqual(buildCustomSegments(cuts, 40), before)
  assert.deepEqual(before.map(s => [s.startTime, s.endTime]), [[0, 3.17], [3.17, 11.4], [11.4, 12.2], [12.2, 40]])
  assert.equal(before[1].endTime - before[1].startTime > 8 * 60 / 140, true, 'sections are not capped at eight counts')
  assert.equal(addCut(cuts, 11.5, 40), null, 'too close to an existing cut')
  assert.deepEqual(addCut([5], 20.001, 40), [5, 20]) // rounded to 10 ms
  assert.equal(moveCut(cuts, 1, 12.0, 40), null)
  assert.deepEqual(moveCut(cuts, 1, 9.9, 40), [3.17, 9.9, 12.2])
  assert.deepEqual(removeCut(cuts, 0), [11.4, 12.2])
  assert.deepEqual(buildCustomSegments([], 40), [], 'no cuts means no sections')
  assert.deepEqual(evenCutsFromFirst(4, 17), [4, 8, 12, 16])
  assert.deepEqual(evenCutsFromFirst(5, 20), [5, 10, 15])
  assert.deepEqual(evenCutsFromFirst(0.2, 20), [], 'too short')
  assert.deepEqual(evenCutsFromFirst(19.8, 20), [], 'too close to end')
})

test('saved practice keeps beat boundaries and custom cuts independently', async () => {
  const { normalizePracticeState } = await import('../src/practice/savedPractice.ts')
  const saved = normalizePracticeState({ bpm: 120, tempoMode: 'auto', tempoSource: 'tag', segmentMode: 'custom', customCuts: [9, 3, 'x', 3.1, 4], boundaryOffsets: [0.2, -0.1] })
  assert.equal(saved.tempoSource, 'tag'); assert.equal(saved.segmentMode, 'custom')
  assert.deepEqual(saved.customCuts, [3, 4, 9]); assert.deepEqual(saved.boundaryOffsets, [0.2, -0.1])
  const old = normalizePracticeState({ bpm: 120, tempoMode: 'manual' })
  assert.equal(old.segmentMode, 'beats'); assert.deepEqual(old.customCuts, []); assert.equal(old.tempoSource, 'unset')
})

test('count scheduling: times follow media time, stretch with slow playback, samples are never rescaled', async () => {
  const { MediaClock, scheduleWindow } = await import('../src/coach/clock.ts')
  const grid = { bpm: 120, anchor: 1, adjust: {} }
  const onset = { one: 0.03, two: 0.045, and: 0.014 } as const
  for (const rate of [1, 0.5, 0.25]) {
    const clock = new MediaClock(); clock.reset(0.8, 10, rate)
    const events = scheduleWindow(grid, clock, 10, 10 + 3 / rate, { onset, includeAnd: true, shift: 0 })
    assert.deepEqual(events.slice(0, 5).map(e => e.label), ['1', '&', '2', '&', '3'])
    // 1 is at media 1.0 → 0.2 media-seconds after the clock anchor → 0.2 / rate audio seconds later.
    assert.ok(Math.abs(events[0].ctxHit - (10 + 0.2 / rate)) < 1e-9, `rate ${rate}`)
    assert.ok(Math.abs((events[1].ctxHit - events[0].ctxHit) - 0.25 / rate) < 1e-9, 'half-beat gap is stretched by 1/rate')
    assert.ok(Math.abs(events[0].ctxStart - (events[0].ctxHit - 0.03)) < 1e-12, 'sample start is moved by its perceptual onset only')
    assert.equal('rate' in events[0], false, 'no per-sample playbackRate is produced')
  }
})

test('count scheduling: calibration shift, numbers-only mode and manual "and" adjustments', async () => {
  const { MediaClock, scheduleWindow } = await import('../src/coach/clock.ts')
  const clock = new MediaClock(); clock.reset(0, 0, 1)
  const base = { bpm: 120, anchor: 0.5, adjust: {} }
  const plain = scheduleWindow(base, clock, 0.1, 2.1, { onset: {}, includeAnd: false, shift: 0 })
  assert.deepEqual(plain.map(e => e.label), ['1', '2', '3', '4'])
  assert.deepEqual(plain.map(e => e.ctxHit), [0.5, 1, 1.5, 2])
  const shifted = scheduleWindow(base, clock, 0.1, 2.1, { onset: {}, includeAnd: false, shift: -0.04 })
  assert.ok(Math.abs(shifted[0].ctxHit - 0.46) < 1e-12)
  const tuned = scheduleWindow({ ...base, adjust: { 1: 0.03, 5: -0.02 } }, clock, 0.1, 2.1, { onset: {}, includeAnd: true, shift: 0 })
  assert.deepEqual(tuned.filter(e => e.label === '&').map(e => Math.round(e.ctxHit * 1000)), [250, 780, 1230, 1750])
})

test('manual "and" adjustments clamp, persist and drop when the tempo changes', async () => {
  const { nudgeAdjust, setAdjustToTime, pointAt, maxAdjust } = await import('../src/beats/grid.ts')
  const { normalizeCountSettings, DEFAULT_COUNT_SETTINGS } = await import('../src/beats/countSettings.ts')
  let grid = { bpm: 120, anchor: 0, adjust: {} as Record<number, number> }
  grid = { ...grid, adjust: nudgeAdjust(grid, 5, 0.01) }
  grid = { ...grid, adjust: nudgeAdjust(grid, 5, 0.02) }
  assert.equal(Math.round(grid.adjust[5] * 1000), 30)
  assert.equal(Math.round(pointAt(grid, 5)!.time * 1000), 780)
  assert.deepEqual(nudgeAdjust(grid, 4, 0.02), grid.adjust, 'whole beats are not adjustable')
  grid = { ...grid, adjust: nudgeAdjust(grid, 5, 1) }
  assert.equal(grid.adjust[5], maxAdjust(120), 'clamped to the allowed range')
  grid = { ...grid, adjust: nudgeAdjust(grid, 5, -maxAdjust(120)) }
  assert.equal(grid.adjust[5], undefined, 'back at zero removes the entry')
  grid = { ...grid, adjust: setAdjustToTime(grid, 9, 1.4) }
  assert.equal(Math.round(grid.adjust[9] * 1000), Math.round(maxAdjust(120) * 1000), 'dragging beyond the limit is clamped')
  grid = { ...grid, adjust: setAdjustToTime(grid, 9, 1.3) }
  assert.equal(Math.round(grid.adjust[9] * 1000), 50)
  // Saved JSON round-trip (what localStorage holds).
  const stored = JSON.parse(JSON.stringify({ ...DEFAULT_COUNT_SETTINGS, adjust: grid.adjust, adjustBpm: 120, anchorMode: 'manual', manualAnchor: 3.25 }))
  const restored = normalizeCountSettings(stored)
  assert.deepEqual(restored.adjust, grid.adjust); assert.equal(restored.manualAnchor, 3.25); assert.equal(restored.anchorMode, 'manual')
  assert.deepEqual(normalizeCountSettings({ version: 2, adjust: { 4: 0.01, 3: 9, x: 1, 5: 0.02 } }).adjust, { 5: 0.02 }, 'number points, huge and non-numeric entries are discarded')
  assert.deepEqual(normalizeCountSettings({ adjust: { 1: 0.02 } }).adjust, {}, 'version-1 half-beat keys are not carried over')
  assert.equal(normalizeCountSettings({}).follow, true); assert.equal(normalizeCountSettings({ follow: false }).follow, false)
  assert.equal(normalizeCountSettings({ levelShift: 9 }).levelShift, 2, 'level steps are clamped to ±2')
  assert.equal(normalizeCountSettings({ anchorMode: 'manual' }).anchorMode, 'auto', 'manual without an anchor falls back')
})

test('phase alignment finds a known phase and ignores chance-level evidence', async () => {
  const { alignPhase, pickDownbeat } = await import('../src/beats/phase.ts')
  const { resolveAnchor, evidenceStrength } = await import('../src/beats/anchor.ts')
  const period = 0.5
  let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const onsets = Array.from({ length: 80 }, (_, i) => ({ time: 0.13 + i * period + (rand() - .5) * .02, strength: i % 8 === 0 ? 1 : 0.5 }))
  const noise = Array.from({ length: 70 }, () => ({ time: rand() * 40, strength: rand() }))
  const result = alignPhase(period, [{ events: onsets, weight: 1 }])!
  assert.ok(Math.abs(result.phase - 0.13) < 0.01, `phase ${result.phase}`)
  assert.ok(result.concentration > 0.9)
  assert.ok(evidenceStrength(noise, period).weight < 0.1 && evidenceStrength(onsets, period).weight > 0.5, 'random accents get ~zero weight, a locked source a large one')
  assert.equal(pickDownbeat(period, 0.13, [{ events: onsets, weight: 1 }]).beatOffset, 0)
  const shifted = onsets.map((e, i) => ({ ...e, strength: i % 8 === 3 ? 1 : .4 }))
  assert.equal(pickDownbeat(period, 0.13, [{ events: shifted, weight: 1 }]).beatOffset, 3)
  // Noise-only pose evidence must not move a phase that the music defines.
  const both = resolveAnchor({ bpm: 120, mode: 'auto', manualAnchor: null, musicStart: null, danceStart: 4, poseAccents: noise, audioOnsets: onsets, basis: 'both' })
  const frac = (((both.anchor - 0.13) / period) % 1 + 1) % 1
  assert.ok(Math.min(frac, 1 - frac) < 0.08, `anchor phase follows the music (${frac})`)
})

test('first-beat sources: exact manual, marker refined within a quarter beat, auto', async () => {
  const { resolveAnchor } = await import('../src/beats/anchor.ts')
  const period = 60 / 120
  const onsets = Array.from({ length: 60 }, (_, i) => ({ time: 0.31 + i * period, strength: 1 }))
  const common = { bpm: 120, manualAnchor: null, musicStart: 10.34, danceStart: 14.4, poseAccents: [], audioOnsets: onsets, basis: 'both' as const }
  const manual = resolveAnchor({ ...common, mode: 'manual', manualAnchor: 5.123 })
  assert.deepEqual([manual.anchor, manual.source], [5.123, 'manual'])
  const music = resolveAnchor({ ...common, mode: 'music' })
  assert.equal(music.source, 'music-start'); assert.ok(Math.abs(music.anchor - 10.31) < 0.006, `${music.anchor}`); assert.ok(Math.abs(music.shiftMs) <= 100)
  const far = resolveAnchor({ ...common, mode: 'music', musicStart: 10.5 })
  assert.equal(far.anchor, 10.5, 'evidence more than a quarter beat away never overrides the marker')
  const none = resolveAnchor({ ...common, mode: 'dance', audioOnsets: [] })
  assert.deepEqual([none.anchor, none.evidence], [14.4, 'none'])
  const auto = resolveAnchor({ ...common, mode: 'auto' })
  assert.equal(auto.source, 'auto'); assert.ok(Math.abs((auto.anchor - 0.31) / period - Math.round((auto.anchor - 0.31) / period)) < 0.02)
})

const pulses = (bpm: number, seconds: number, rate = 11025, accentEvery = 0) => {
  const samples = new Float32Array(rate * seconds)
  let n = 0
  for (let time = 0.2; time < seconds - 0.2; time += 60 / bpm, n++) {
    const gain = accentEvery && n % accentEvery === 0 ? 1 : 0.6
    for (let j = 0; j < rate * .08; j++) { const i = Math.round(time * rate) + j; if (i < samples.length) samples[i] += gain * Math.exp(-j / (rate * .02)) * Math.sin(2 * Math.PI * 95 * j / rate) }
  }
  return samples
}

test('tempo prior picks the musical octave and always offers ×2 / ÷2', async () => {
  const { chooseTempo, reconcileTempo, tempoPrior } = await import('../src/beats/tempoCandidates.ts')
  assert.ok(tempoPrior(118) > tempoPrior(60) && tempoPrior(118) > tempoPrior(236))
  // Peaks at 71.6 / 107.4 / 214.8 (what the "10count" clip's audio gives): 107.4 explains the others best.
  const choice = chooseTempo([[{ bpm: 107.4, score: 1, correlation: .5 }, { bpm: 71.6, score: .7, correlation: .4 }, { bpm: 214.8, score: .4, correlation: .3 }]])!
  assert.ok(Math.abs(choice.bpm - 107.4) < 0.2, String(choice.bpm))
  assert.ok(choice.alternatives.some(v => Math.abs(v - 214.8) < 1) && choice.alternatives.some(v => Math.abs(v - 53.7) < 1))
  assert.equal(chooseTempo([]), null)
  // Legacy 73.5 vs. prior-aware 147: the prior may only resolve a half/double-time difference.
  const r = reconcileTempo(73.5, { bpm: 147, alternatives: [], support: 1 })!
  assert.equal(r.bpm, 147)
  assert.equal(reconcileTempo(100, { bpm: 133, alternatives: [], support: 1 })!.bpm, 100, 'unrelated disagreement keeps the legacy value')
  assert.equal(reconcileTempo(null, null), null)
})

test('audio analysis: steady pulses are found at 90, 120 and 150 BPM, onsets land on the pulse', async () => {
  const { analyzeAudioSamples } = await import('../src/beats/audioAnalysis.ts')
  for (const bpm of [90, 120, 150]) {
    const samples = pulses(bpm, 48, 11025, 4)
    const result = analyzeAudioSamples(samples, samples, 11025)
    assert.ok(result.tempo && Math.abs(result.tempo.bpm - bpm) < bpm * .015, `${bpm} → ${result.tempo?.bpm}`)
    assert.ok(result.tempo!.alternatives.some(a => Math.abs(a / bpm - 2) < .03) || bpm > 120)
    const period = 60 / bpm
    const offsets = result.onsets.map(o => ((o.time - 0.2) % period + period) % period).map(o => Math.min(o, period - o))
    assert.ok(offsets.filter(o => o < 0.03).length / offsets.length > 0.8, `onsets are on the pulse (${bpm})`)
  }
  const silence = new Float32Array(11025 * 30)
  assert.equal(analyzeAudioSamples(silence, silence, 11025).tempo, null)
})

test('playback speeds never exceed 1× and include the new slow steps', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const match = source.match(/const SPEEDS = \[([^\]]+)\]/)!
  const speeds = match[1].split(',').map(Number)
  assert.deepEqual(speeds, [0.25, 0.35, 0.5, 0.65, 0.8, 1])
  assert.ok(Math.max(...speeds) <= 1)
})

test('WAV encoder writes a valid 16-bit header', async () => {
  const { encodeWav } = await import('../src/coach/wav.ts')
  const wav = encodeWav([new Float32Array([0, 1, -1, 0.5])], 44100)
  const view = new DataView(wav.buffer)
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF'); assert.equal(view.getUint32(24, true), 44100); assert.equal(view.getUint32(40, true), 8)
  assert.equal(view.getInt16(46, true), 32767); assert.equal(view.getInt16(48, true), -32768)
})

test('real test videos carry no tempo tag (skipped when the files are absent)', async (t) => {
  const { readEmbeddedTempo, blobSource } = await import('../src/beats/metadata.ts')
  const dir = '/workspace/街舞项目/test-videos'
  if (!existsSync(dir)) { t.skip('test videos not present'); return }
  for (const name of ['shaheem-10count.mp4', 'shaheem-shegoesby.mp4']) {
    const file = new Blob([readFileSync(join(dir, name))])
    assert.equal(await readEmbeddedTempo(blobSource(file)), undefined, name)
  }
})

test('tempo refinement pulls a 1 % error back onto the pulse and never moves further than ±2 % even on unstructured onsets', async () => {
  const { refineTempo } = await import('../src/beats/phase.ts')
  let seed = 11; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const true_ = 145.5
  const events = Array.from({ length: 220 }, (_, i) => ({ time: 0.37 + i * 60 / true_ + (rand() - .5) * .03, strength: .5 + rand() / 2 }))
  const fixed = refineTempo(events, 147.3)
  assert.ok(Math.abs(fixed.bpm - true_) < 0.25, String(fixed.bpm))
  const noise = Array.from({ length: 120 }, () => ({ time: rand() * 60, strength: rand() }))
  assert.ok(Math.abs(refineTempo(noise, 120).bpm / 120 - 1) <= 0.0201)
})
