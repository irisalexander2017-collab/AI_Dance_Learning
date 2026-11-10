import assert from 'node:assert/strict'
import test from 'node:test'

const DT = 0.01
/** A synthetic 100 Hz motion-energy curve: quiet head, then a bump at every hit time (plus a low continuous sway). */
function curve(duration: number, hits: number[], blips: number[] = []) {
  const values = new Float32Array(Math.round(duration / DT))
  let seed = 11; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < values.length; i++) {
    const t = i * DT
    let v = 0.01 + rand() * 0.01
    for (const hit of hits) v += Math.exp(-0.5 * ((t - hit) / 0.07) ** 2)
    for (const blip of blips) v += 0.6 * Math.exp(-0.5 * ((t - blip) / 0.05) ** 2)
    if (hits.length && t > hits[0] - 0.2 && t < hits[hits.length - 1] + 0.2) v += 0.18
    values[i] = v
  }
  return { dt: DT, values, peaks: hits.map(time => ({ time, strength: 1 })) }
}
const every = (start: number, step: number, until: number) => { const out: number[] = []; for (let t = start; t < until; t += step) out.push(t); return out }

test('dance start: first sustained rise of the motion energy, not a short blip or the still head', async () => {
  const { detectDanceStart } = await import('../src/beats/motionTempo.ts')
  const hits = every(3.0, 0.8, 30)
  const start = detectDanceStart(curve(32, hits, [1.0])).time
  assert.ok(start !== null && start > 2.3 && start < 3.1, `start ${start}`)
  assert.equal(detectDanceStart(curve(10, [])).time, null, 'no movement at all gives no start')
})

test('number-beat level: the music tempo multiple whose interval matches the motion period', async () => {
  const { analyzeMotion, chooseNumberLevel } = await import('../src/beats/motionTempo.ts')
  // Teacher hits every 0.8 s (75 BPM) while the audio tempo is detected at 150 BPM → numbers go at half the audio tempo.
  const slow = curve(40, every(2, 0.8, 38))
  const motionSlow = analyzeMotion(slow)
  assert.ok(Math.abs(motionSlow.period!.seconds - 0.8) < 0.03, `period ${motionSlow.period?.seconds}`)
  const half = chooseNumberLevel(150, motionSlow, slow.peaks)
  assert.equal(half.reliable, true)
  assert.ok(Math.abs(half.bpm - 75) < 0.5 && Math.abs(half.ratio - 0.5) < 1e-9, `chose ${half.bpm} (${half.ratio})`)
  // Hits every 1 s while the audio tempo is detected at 240 BPM → quarter level (60 BPM numbers).
  const quarter = curve(40, every(2, 1, 38))
  assert.equal(chooseNumberLevel(240, analyzeMotion(quarter), quarter.peaks).bpm, 60)
  // Hits every 0.5 s and a slow audio detection (60 BPM): one hit per number, so the numbers speed up to the hits (×2).
  const fast = curve(40, every(2, 0.5, 38))
  const doubled = chooseNumberLevel(60, analyzeMotion(fast), fast.peaks)
  assert.equal(doubled.bpm, 60, 'one hit per number at the audio tempo is already the right level')
  assert.ok(chooseNumberLevel(60, analyzeMotion(fast), fast.peaks).margin > 0.3, 'and the choice is clear')
  // Without usable motion the audio tempo is used as is and the choice is flagged unreliable.
  const none = chooseNumberLevel(120, { danceStart: null, period: null, duration: 10, hitsPerSecond: 0 }, [])
  assert.equal(none.bpm, 120); assert.equal(none.reliable, false)
})

test('first beat: locked to the movement start, then moved onto accents only when the whole clip agrees', async () => {
  const { lockFirstBeat } = await import('../src/beats/motionTempo.ts')
  const T = 0.8
  // Accents sit 60 ms after the detected start grid → the phase follows them.
  const accents = every(3.06, T, 40).map(time => ({ time, strength: 1 }))
  const moved = lockFirstBeat(3.0, T, accents, [], 40)
  assert.ok(Math.abs(moved.anchor - 3.06) < 0.012, `anchor ${moved.anchor}`)
  assert.notEqual(moved.source, 'dance-start')
  // No accents → the detected start is kept exactly.
  const plain = lockFirstBeat(3.0, T, [], [], 40)
  assert.equal(plain.anchor, 3.0); assert.equal(plain.source, 'dance-start')
})

test('follow subs stick to accents: 0/1/2/3 peaks → correct counts; weak peaks ignored; close merge', async () => {
  const { quantizeSubBeats, placeSubs, snapSubs, subStats, MAX_SUBS, MIN_SUB_STRENGTH } = await import('../src/beats/motionTempo.ts')
  assert.equal(MAX_SUBS, 3)
  assert.ok(MIN_SUB_STRENGTH > 0)
  const T = 1, anchor = 10
  const at = (k: number, f: number, s = 1) => ({ time: anchor + (k + f) * T, strength: s })
  // Beat 0: only the number peak → no sub
  // Beat 1: one mid accent at 0.42 → one sub near 0.42
  // Beat 2: two accents at 0.28 and 0.72 → two subs
  // Beat 3: three accents → three subs (1 e & a), positions near accents
  // Beat 4: two accents 0.05 apart → merge to one
  // Beat 5: mid accent too weak → no sub (prefer fewer wrong ands)
  const peaks = [
    at(0, 0),
    at(1, 0), at(1, 0.42),
    at(2, 0), at(2, 0.28), at(2, 0.72),
    at(3, 0), at(3, 0.25, 0.9), at(3, 0.5, 1), at(3, 0.78, 0.85),
    at(4, 0), at(4, 0.4), at(4, 0.45),
    at(5, 0), at(5, 0.5, 0.1),
  ]
  const pattern = quantizeSubBeats(peaks, anchor, T, anchor, anchor + 6)
  assert.deepEqual(pattern[0] ?? [], [], '0 extra → only the number')
  assert.equal(pattern[1]!.length, 1, '1 extra → 1 and')
  assert.ok(Math.abs(pattern[1]![0] - 0.42) < 0.05, `and near accent, got ${pattern[1]}`)
  assert.equal(pattern[2]!.length, 2)
  assert.ok(Math.abs(pattern[2]![0] - 0.28) < 0.05 && Math.abs(pattern[2]![1] - 0.72) < 0.05)
  assert.equal(pattern[3]!.length, 3, '3 extras → e & a positions')
  assert.ok(pattern[3]!.every((a, i, arr) => i === 0 || a - arr[i - 1] >= 0.15), 'subs keep spacing')
  assert.equal(pattern[4]!.length, 1, 'close accents merge to one')
  assert.deepEqual(pattern[5] ?? [], [], 'weak mid peak → no sub')
  assert.deepEqual(placeSubs([]), [])
  assert.equal(placeSubs([0.41]).length, 1)
  assert.ok(Math.abs(placeSubs([0.41])[0] - 0.41) < 0.001)
  assert.equal(placeSubs([0.25, 0.5, 0.75]).length, 3)
  assert.deepEqual(snapSubs([0.45]), [0.5]) // legacy fixed snap still centered
  const stats = subStats(pattern, anchor, T, anchor, anchor + 6)
  assert.ok(stats.withSubs[3] >= 1, 'beats with 3 extras are counted')
})

test('count plan: manual first beat beats the automatic motion lock; "fixed" ignores the motion; level steps act on numbers', async () => {
  const { planCount } = await import('../src/beats/countPlan.ts')
  const { DEFAULT_COUNT_SETTINGS } = await import('../src/beats/countSettings.ts')
  const { analyzeMotion } = await import('../src/beats/motionTempo.ts')
  const c = curve(40, every(3, 0.8, 38))
  const base = { bpm: 150, motion: analyzeMotion(c), poseAccents: c.peaks, audioOnsets: [], musicStart: null, danceStart: null, duration: 40 }
  const auto = planCount({ ...base, settings: DEFAULT_COUNT_SETTINGS })
  assert.equal(auto.anchorInfo.source, 'motion-start')
  assert.ok(Math.abs(auto.anchorInfo.anchor - 3) < 0.4, `auto anchor ${auto.anchorInfo.anchor}`)
  assert.ok(Math.abs(auto.numberBpm - 75) < 0.5)
  assert.equal(auto.info.basis, 'motion')
  const manual = planCount({ ...base, settings: { ...DEFAULT_COUNT_SETTINGS, anchorMode: 'manual', manualAnchor: 7.77 } })
  assert.equal(manual.anchorInfo.anchor, 7.77, 'manual "set 1 here" is exact and wins over the motion lock')
  assert.equal(manual.anchorInfo.source, 'manual')
  const fixed = planCount({ ...base, settings: { ...DEFAULT_COUNT_SETTINGS, follow: false } })
  assert.equal(fixed.numberBpm, 150, 'fixed 1&2& counts at the music tempo')
  assert.equal(fixed.grid.subs, null)
  const doubled = planCount({ ...base, settings: { ...DEFAULT_COUNT_SETTINGS, levelShift: 1 } })
  assert.ok(Math.abs(doubled.numberBpm - 150) < 1, '×2 acts on the number-beat level (75 → 150)')
  const halved = planCount({ ...base, settings: { ...DEFAULT_COUNT_SETTINGS, levelShift: -1 } })
  assert.ok(Math.abs(halved.numberBpm - 37.5) < 0.5, '÷2 acts on the number-beat level (75 → 37.5)')
  // A manual "and" fine-tune survives and is only dropped when the number-beat tempo it belongs to changes.
  const tuned = planCount({ ...base, settings: { ...DEFAULT_COUNT_SETTINGS, adjust: { 5: 0.02 }, adjustBpm: auto.numberBpm } })
  assert.equal(tuned.grid.adjust[5], 0.02)
  assert.deepEqual(planCount({ ...base, settings: { ...DEFAULT_COUNT_SETTINGS, adjust: { 5: 0.02 }, adjustBpm: 99 } }).grid.adjust, {})
  // User-marked dance/music start must win over detectDanceStart (~motion.danceStart).
  const marked = planCount({ ...base, danceStart: 1.5, musicStart: 1.0, settings: DEFAULT_COUNT_SETTINGS })
  assert.equal(marked.anchorInfo.source, 'dance-start', 'user dance marker beats motion-start lock')
  assert.ok(Math.abs(marked.anchorInfo.anchor - 1.5) < 0.15, `marked anchor ${marked.anchorInfo.anchor}`)
  // follow + pose not ready → empty subs (numbers only; prefer fewer wrong ands); switches to follow once pose ready
  const waiting = planCount({ ...base, motion: null, settings: DEFAULT_COUNT_SETTINGS })
  assert.deepEqual(waiting.grid.subs, {}, 'numbers-only while pose analyzes (no fixed half-beat ands)')
  assert.equal(waiting.info.basis, 'music')
  const { pointAt } = await import('../src/beats/grid.ts')
  assert.equal(pointAt(waiting.grid, 1), null, 'no temporary mid-beat and while pose is not ready')
  assert.ok(pointAt(waiting.grid, 0) !== null, 'whole-beat numbers still present')
  const fixedSubs = planCount({ ...base, motion: null, settings: { ...DEFAULT_COUNT_SETTINGS, follow: false } })
  assert.equal(fixedSubs.grid.subs, null)
  assert.ok(pointAt(fixedSubs.grid, 1) !== null, 'fixed mode still has the half-beat and')
})

test('original sound while counting: mute by default, lower, or keep', async () => {
  const { NATIVE_AUDIO_GAIN, normalizeCountPrefs, DEFAULT_COUNT_PREFS } = await import('../src/beats/countSettings.ts')
  assert.equal(DEFAULT_COUNT_PREFS.nativeAudio, 'mute')
  assert.equal(NATIVE_AUDIO_GAIN.mute, 0); assert.ok(NATIVE_AUDIO_GAIN.duck > 0 && NATIVE_AUDIO_GAIN.duck <= 0.15); assert.equal(NATIVE_AUDIO_GAIN.keep, 1)
  assert.equal(normalizeCountPrefs({ nativeAudio: 'duck' }).nativeAudio, 'duck')
  assert.equal(normalizeCountPrefs({ nativeAudio: 'bogus' }).nativeAudio, 'mute')
  assert.equal(normalizeCountPrefs({ voice: 'male2' }).voice, 'male', 'legacy male2 maps to A')
  assert.equal(normalizeCountPrefs({ voice: 'female' }).voice, 'female')
}
)
