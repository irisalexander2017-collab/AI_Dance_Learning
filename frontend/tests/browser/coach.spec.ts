import { test, expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const fixture = path.resolve('.test-artifacts/practice-100bpm.mp4')
const tagged = path.resolve('.test-artifacts/practice-tagged-121.mp4')
const videoTime = (page: Page) => page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => v.currentTime)
const paused = (page: Page) => page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => v.paused)

async function loadVideo(page: Page, file = fixture) {
  await page.goto('./')
  await page.getByRole('button', { name: /开始练习/ }).click()
  await page.locator('input[type=file]').setInputFiles(file)
  await expect.poll(() => page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(20)
}
async function seek(page: Page, time: number) {
  await page.locator('.timeline-row input').evaluate((input: HTMLInputElement, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }))
  }, time)
}
const openMenuPage = async (page: Page, name: string | RegExp) => {
  const label = typeof name === 'string' ? name : ''
  if (label === '练习设置' || label === '数拍与分段' || (name instanceof RegExp && (name.test('练习设置') || name.test('数拍与分段')))) {
    await page.getByRole('button', { name: /更多/ }).click()
    await page.getByRole('navigation', { name: /更多选项/ }).getByRole('button', { name: '数拍与分段', exact: true }).click()
    return
  }
  if (label === '自定义分段') {
    // Since the 2026-11 UI refresh the free-cut editor is the 「自定义分段」 mode inside ⋯ → 数拍与分段 (no separate ⋯ entry).
    await page.getByRole('button', { name: /更多/ }).click()
    await page.getByRole('navigation', { name: /更多选项/ }).getByRole('button', { name: '数拍与分段', exact: true }).click()
    return
  }
  await page.getByRole('button', { name: /更多/ }).click()
  await page.getByRole('navigation', { name: /更多选项/ }).getByRole('button', { name }).click()
}
const closeMenu = async (page: Page) => { await page.keyboard.press('Escape') }

test('speed menu offers only slow-motion steps, none above 1×', async ({ page }) => {
  await loadVideo(page)
  await page.locator('.dock-speed-trigger').click()
  const labels = await page.locator('.dock-speed-options button').allInnerTexts()
  expect(labels).toEqual(['0.25×', '0.35×', '0.5×', '0.65×', '0.8×', '1×'])
  await page.getByRole('button', { name: '0.35×', exact: true }).click()
  await expect.poll(() => page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(0.35)
  await page.reload()
  // A stale stored fast speed (e.g. 1.5) from the old version falls back to 1×.
  await page.evaluate(() => localStorage.setItem('adl-playback-speed', '1.5'))
  await page.reload()
  await page.getByRole('button', { name: /开始练习/ }).click()
  await page.locator('input[type=file]').setInputFiles(fixture)
  await expect(page.locator('.dock-speed-trigger')).toContainText('1×')
})

test('releasing the timeline starts playback even from a pause (mouse)', async ({ page }) => {
  await loadVideo(page)
  expect(await paused(page)).toBe(true)
  const box = (await page.locator('.timeline-row input').boundingBox())!
  await page.mouse.move(box.x + 8, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 6 })
  expect(await paused(page)).toBe(true) // still holding: no playback mid-drag
  await page.mouse.up()
  await expect.poll(() => paused(page)).toBe(false)
  const at = await videoTime(page)
  expect(at).toBeGreaterThan(5)
  await expect.poll(() => videoTime(page)).toBeGreaterThan(at + 0.3)
  // Also after pausing again and dragging a second time.
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  expect(await paused(page)).toBe(true)
  await seek(page, 3)
  await expect.poll(() => paused(page)).toBe(false)
})

test('timeline touch drag resumes playback on a phone-sized touch device', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['camera'] })
  const page = await context.newPage()
  await loadVideo(page)
  expect(await paused(page)).toBe(true)
  const box = (await page.locator('.timeline-row input').boundingBox())!
  const cdp = await context.newCDPSession(page)
  const y = box.y + box.height / 2
  const point = (fraction: number) => [{ x: box.x + box.width * fraction, y, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(0.05) })
  for (const f of [0.15, 0.3, 0.5]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(f) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => paused(page)).toBe(false)
  expect(await videoTime(page)).toBeGreaterThan(6)
  await context.close()
})

test('BPM read-out is collapsed, edits with Enter, ×2 / ÷2 and closes', async ({ page }) => {
  await loadVideo(page)
  await expect(page.locator('.tempo-state')).toHaveText(/自动.*BPM/, { timeout: 30000 })
  await expect(page.locator('#bpm-editor')).toHaveCount(0)
  await page.locator('.bpm-number').click()
  await expect(page.locator('#bpm-editor')).toBeVisible()
  const field = page.getByRole('spinbutton', { name: /曲速（音乐 BPM）|Song tempo/ })
  await field.fill('120')
  await field.press('Enter')
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*120.*BPM/)
  await expect(page.locator('#bpm-editor')).toHaveCount(0) // Enter confirms and collapses
  // ×2 / ÷2 now act on the number-beat level (what "1, 2, 3 …" follow), not on the music BPM.
  await page.locator('.bpm-number').click()
  await expect(page.getByTestId('count-hint')).toContainText('120 BPM 数字拍')
  await page.getByRole('button', { name: '放快' }).click()
  await expect(page.getByTestId('count-hint')).toContainText('240 BPM 数字拍')
  await expect(page.getByTestId('count-hint')).toContainText('×2')
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*120.*BPM/) // the music BPM itself is untouched
  await expect(page.getByRole('button', { name: '放快' })).toBeDisabled() // 480 is out of range
  await page.getByRole('button', { name: '放慢' }).click()
  await expect(page.getByTestId('count-hint')).toContainText('120 BPM 数字拍')
  await expect(page.getByTestId('count-hint')).not.toContainText('已手动')
  await page.getByRole('button', { name: '收起', exact: true }).click()
  await expect(page.locator('#bpm-editor')).toHaveCount(0)
  await page.locator('.bpm-number').click()
  await field.fill('500'); await field.press('Enter')
  await expect(page.getByRole('alert')).toContainText('40–240')
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*120.*BPM/)
})

test('an embedded tmpo tag is used before audio analysis', async ({ page }) => {
  const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', fixture, '-c', 'copy', '-metadata', 'tmpo=121', tagged])
  expect(made.status).toBe(0)
  await loadVideo(page, tagged)
  await expect(page.locator('.tempo-state')).toHaveText(/自动\s*121\s*BPM\s*·\s*标签/, { timeout: 30000 })
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('adl-practice:'))!)!).tempoSource)).toBe('tag')
})

async function enableCount(page: Page) {
  await expect(page.locator('.tempo-state')).toHaveText(/BPM/, { timeout: 30000 })
  const toggle = page.getByRole('button', { name: '数拍', exact: true }) // top-bar switch
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
}

test('count voice is scheduled ahead on the audio clock; slow speed stretches gaps but not samples; overlay shows the beat', async ({ page }) => {
  await loadVideo(page)
  await page.locator('.tempo-state').waitFor()
  await setBpm100(page)
  // This test checks the scheduling mechanics on a regular "1 & 2 &" lattice, so the count style is fixed here
  // (following the teacher would put a varying number of "and"s into each beat).
  await openCountSettings(page)
  await page.getByRole('combobox', { name: '数拍方式' }).selectOption('fixed')
  await closeMenu(page)
  await enableCount(page)
  await page.waitForTimeout(2500) // lazy audio-onset analysis (used to align the grid) settles; entries cancelled by a grid change are flagged
  await seek(page, 2)
  await expect(page.locator('[data-testid=beat-overlay]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__countLog?.length ?? 0), { timeout: 8000 }).toBeGreaterThan(8)
  const labels = await page.evaluate(() => window.__countLog!.filter(e => !e.cancelled).map(e => e.label))
  expect(labels.slice(0, 6).join('')).toMatch(/^(1&2&3&|&2&3&4|2&3&4&|&3&4&5|3&4&5&|&4&5&6|4&5&6&|&5&6&7|5&6&7&|&6&7&8|6&7&8&|&7&8&1|7&8&1&|&8&1&2|8&1&2&|&1&2&3)/)
  const log = await page.evaluate(() => window.__countLog!.filter(e => !e.cancelled))
  for (let i = 1; i < Math.min(log.length, 10); i++) {
    expect(log[i].ctxHit - log[i - 1].ctxHit).toBeGreaterThan(0.28)
    expect(log[i].ctxHit - log[i - 1].ctxHit).toBeLessThan(0.32)
    expect(log[i].ctxHit).toBeGreaterThan(log[i].ctxNow) // scheduled ahead of the audio clock
  }
  const beat = await page.locator('[data-testid=beat-overlay]').getAttribute('data-beat')
  expect(beat).toMatch(/^[1-8&]$/)
  // Half speed: gaps double.
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await page.locator('.dock-speed-trigger').click(); await page.getByRole('button', { name: '0.5×', exact: true }).click()
  await page.evaluate(() => { window.__countLog!.length = 0 })
  await seek(page, 6)
  await expect.poll(() => page.evaluate(() => window.__countLog!.length), { timeout: 12000 }).toBeGreaterThan(6)
  const slow = await page.evaluate(() => window.__countLog!.filter(e => !e.cancelled))
  for (let i = 1; i < 7; i++) expect(slow[i].ctxHit - slow[i - 1].ctxHit).toBeGreaterThan(0.57)
  for (let i = 1; i < 7; i++) expect(slow[i].ctxHit - slow[i - 1].ctxHit).toBeLessThan(0.63)
  expect(slow[0].rate).toBeCloseTo(0.5, 2)
  expect(await page.evaluate(() => JSON.parse(window.__countExport!()).length)).toBeGreaterThan(6)
})

test('"and" fine-tuning is saved per video and survives a reload', async ({ page }) => {
  await loadVideo(page)
  await setBpm100(page)
  await enableCount(page) // grid + beat strip need an active count plan with points
  await openCountSettings(page)
  await expect(page.locator('.beat-cell.half').first()).toBeVisible({ timeout: 15000 })
  const cell = page.locator('.beat-cell.half').first()
  const index = await cell.getAttribute('data-index')
  await cell.click()
  await page.getByRole('button', { name: '+20 ms' }).click()
  await page.getByRole('button', { name: '+10 ms' }).click()
  await expect(page.locator(`.beat-cell[data-index="${index}"]`)).toHaveAttribute('aria-label', /偏移 30 毫秒/)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('adl-count:'))!)!).adjust)).toEqual({ [index!]: 0.03 })
  await page.reload()
  await page.getByRole('button', { name: /开始练习/ }).click()
  await page.locator('input[type=file]').setInputFiles(fixture)
  await openMenuPage(page, '练习设置')
  await page.getByRole('button', { name: /^高级/ }).click()
  await expect(page.locator(`.beat-cell[data-index="${index}"]`)).toHaveAttribute('aria-label', /偏移 30 毫秒/)
  await page.getByRole('button', { name: '全部还原' }).click()
  await expect(page.locator(`.beat-cell[data-index="${index}"]`)).toHaveAttribute('aria-label', /偏移 0 毫秒/)
})

test('free cuts are independent of BPM and of the eight-beat mode', async ({ page }) => {
  await loadVideo(page)
  await page.locator('.tempo-state').waitFor()
  await openMenuPage(page, '自定义分段')
  await page.getByRole('button', { name: '自定义分段', exact: true }).click()
  await expect(page.getByText('还没有分界')).toBeVisible()
  await seek(page, 5); await page.getByRole('button', { name: '在当前位置添加分界' }).click()
  await seek(page, 12.34); await page.getByRole('button', { name: '在当前位置添加分界' }).click()
  await expect(page.getByText('共 3 段')).toBeVisible()
  const cuts = () => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('adl-practice:'))!)!))
  await expect.poll(async () => (await cuts()).customCuts).toEqual([5, 12.34])
  await page.getByRole('button', { name: '分界 1 前移 0.1 秒' }).click()
  await expect.poll(async () => (await cuts()).customCuts).toEqual([4.9, 12.34])
  // Change the BPM: custom boundaries must not move.
  await closeMenu(page)
  await page.locator('.bpm-number').click()
  await page.getByRole('spinbutton', { name: /曲速（音乐 BPM）|Song tempo/ }).fill('77'); await page.getByRole('spinbutton', { name: /曲速（音乐 BPM）|Song tempo/ }).press('Enter')
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*77.*BPM/)
  expect((await cuts()).customCuts).toEqual([4.9, 12.34])
  await expect(page.getByRole('button', { name: '第3段', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '第4段', exact: true })).toHaveCount(0)
  // Eight-beat mode keeps working, and the cuts stay saved for later.
  await openMenuPage(page, '自定义分段')
  await page.getByRole('button', { name: '八拍分段', exact: true }).click()
  expect((await cuts()).segmentMode).toBe('beats')
  expect((await cuts()).customCuts).toEqual([4.9, 12.34])
  await page.getByRole('button', { name: '自定义分段', exact: true }).click()
  await page.getByRole('button', { name: '删除分界 2' }).click()
  await expect.poll(async () => (await cuts()).customCuts).toEqual([4.9])
  await page.reload()
  await page.getByRole('button', { name: /开始练习/ }).click()
  await page.locator('input[type=file]').setInputFiles(fixture)
  await expect(page.getByRole('button', { name: '第2段', exact: true })).toBeVisible()
  expect((await cuts()).segmentMode).toBe('custom')
})

const videoVolume = (page: Page) => page.evaluate(() => (window as unknown as { __adlTeacherGain?: number }).__adlTeacherGain ?? 1)
async function setBpm100(page: Page) {
  await page.locator('.tempo-state').waitFor()
  await page.locator('.bpm-number').click()
  await page.getByRole('spinbutton', { name: /曲速（音乐 BPM）|Song tempo/ }).fill('100')
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*100.*BPM/)
}
async function openCountSettings(page: Page) {
  await openMenuPage(page, '练习设置')
  const advanced = page.getByRole('button', { name: /^高级/ })
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click()
}

test('while the count sounds the video\'s own sound is muted (default), lowered or kept; it comes back when the count is off, also in slow motion', async ({ page }) => {
  await loadVideo(page)
  await setBpm100(page)
  const normal = await videoVolume(page)
  expect(normal).toBeGreaterThan(0.3)
  await enableCount(page)
  await expect.poll(() => videoVolume(page)).toBe(0) // 静音 is the default
  await page.locator('.dock-speed-trigger').click(); await page.getByRole('button', { name: '0.5×', exact: true }).click()
  await expect.poll(() => videoVolume(page)).toBe(0) // slow motion keeps it muted
  await openCountSettings(page)
  await page.getByRole('combobox', { name: '数拍时原声' }).selectOption('duck')
  await expect.poll(() => videoVolume(page)).toBeCloseTo(normal * 0.12, 2)
  await page.getByRole('combobox', { name: '数拍时原声' }).selectOption('keep')
  await expect.poll(() => videoVolume(page)).toBeCloseTo(normal, 2)
  await page.getByRole('combobox', { name: '数拍时原声' }).selectOption('mute')
  await expect.poll(() => videoVolume(page)).toBe(0)
  await page.getByRole('button', { name: '数拍', exact: true }).click() // count off → original sound restored
  await expect.poll(() => videoVolume(page)).toBeCloseTo(normal, 2)
})

test('count style switch (follow the teacher / fixed 1&2&) and manual "set 1 here" beats the automatic lock', async ({ page }) => {
  await loadVideo(page)
  await setBpm100(page)
  await enableCount(page)
  await openCountSettings(page)
  const style = page.getByRole('combobox', { name: '数拍方式' })
  await expect(style).toHaveValue('follow') // default
  await expect(page.getByTestId('count-mode-info')).not.toContainText('固定 1&2&')
  await style.selectOption('fixed')
  await expect(page.getByTestId('count-mode-info')).toContainText('固定 1&2&')
  await style.selectOption('follow')
  await expect(page.getByTestId('count-mode-info')).not.toContainText('固定 1&2&')
  await seek(page, 4.2) // dragging the timeline autoplays, so stop at 4.2 before taking the position (otherwise it drifts, load-sensitive)
  await page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 4.2 })
  await expect.poll(() => paused(page)).toBe(true)
  await page.getByRole('button', { name: /当前位置设为/ }).click()
  await expect(page.locator('.anchor-info')).toContainText('第一拍 4.2')
  await page.waitForTimeout(1500) // later pose / audio results must not move a manual first beat
  await expect(page.locator('.anchor-info')).toContainText('第一拍 4.2')
  // the BPM panel carries the small source / level hint
  await page.locator('.bpm-number').click()
  await expect(page.getByTestId('count-hint')).toContainText(/BPM 数字拍/)
})


test('count beat overlay sits top-right and is quiet; dock shows ×2/÷2 and Set beat 1 when counting', async ({ page }) => {
  await loadVideo(page)
  await setBpm100(page)
  await enableCount(page)
  await seek(page, 2)
  await expect(page.locator('[data-testid=beat-overlay]')).toBeVisible({ timeout: 15000 })
  const box = await page.locator('[data-testid=beat-overlay]').boundingBox()
  const stage = await page.locator('.teacher-video-panel').boundingBox()
  expect(box && stage).toBeTruthy()
  // right half of the video, top quarter — not centred over the dancer
  expect(box!.x + box!.width / 2).toBeGreaterThan(stage!.x + stage!.width * 0.55)
  expect(box!.y + box!.height / 2).toBeLessThan(stage!.y + stage!.height * 0.35)
  expect(box!.height).toBeLessThan(40)
  await openMenuPage(page, '数拍与分段')
  await page.getByRole('button', { name: '高级' }).click()
  await expect(page.getByRole('button', { name: '放快' })).toBeVisible()
  await expect(page.getByRole('button', { name: '放慢' })).toBeVisible()
  await expect(page.getByRole('button', { name: '当前位置设为“1”', exact: true })).toBeVisible()
  await page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 3.5 })
  await expect.poll(() => paused(page)).toBe(true)
  await page.getByRole('button', { name: '当前位置设为“1”', exact: true }).click()
  await openCountSettings(page)
  await expect(page.locator('.anchor-info')).toContainText('第一拍 3.5')
})
