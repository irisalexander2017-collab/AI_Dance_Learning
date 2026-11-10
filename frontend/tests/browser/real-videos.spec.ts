import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// End-to-end run on the two real dance clips. Skipped when the files are absent.
// shegoesby is HEVC, which system Chrome cannot decode, so an H.264 transcode of the same file is used (see 验收报告.md).
const ROOT = process.env.REAL_VIDEO_DIR || '/workspace/街舞项目/test-videos'
const H264 = process.env.REAL_VIDEO_H264_DIR || '/workspace/scratch/test-videos-h264'
const OUT = process.env.REAL_OUT_DIR || '/workspace/街舞项目/验收截图'
const clips = [
  { name: '10count', file: path.join(ROOT, 'shaheem-10count.mp4'), seekAt: 8 },
  { name: 'shegoesby', file: path.join(H264, 'shaheem-shegoesby-h264.mp4'), seekAt: 12 },
]
test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 390, height: 844 } })

const state = (page: Page) => page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => ({ t: v.currentTime, paused: v.paused, rate: v.playbackRate }))
async function seek(page: Page, time: number) {
  await page.locator('.timeline-row input').evaluate((input: HTMLInputElement, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }))
  }, time)
}
const menuPage = async (page: Page, name: string | RegExp) => {
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
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, name) })
const activeLog = (page: Page) => page.evaluate(() => window.__countLog!.filter(e => !e.cancelled))

for (const clip of clips) {
  test(`real video: ${clip.name}`, async ({ page }) => {
    test.skip(!fs.existsSync(clip.file), 'video not present')
    test.setTimeout(300000)
    fs.mkdirSync(OUT, { recursive: true })
    const summary: Record<string, unknown> = { clip: clip.name }
    await page.goto('./')
    await page.getByRole('button', { name: /开始练习/ }).click()
    await page.locator('input[type=file]').setInputFiles(clip.file)
    await expect.poll(() => page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => v.duration), { timeout: 20000 }).toBeGreaterThan(20)

    // 1 · BPM read-out (auto) — source from the saved state
    await expect(page.locator('.tempo-state')).toHaveText(/\d+(\.\d+)?\s*BPM/, { timeout: 90000 })
    summary.bpmChip = (await page.locator('.tempo-state').innerText()).replace(/\s+/g, ' ')
    summary.tempoSource = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('adl-practice:'))!)!).tempoSource)
    summary.bpm = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('adl-practice:'))!)!).bpm)
    await shot(page, `${clip.name}-01-bpm-chip.png`)
    await page.locator('.bpm-number').click()
    await expect(page.locator('#bpm-editor')).toBeVisible()
    summary.alternatives = await page.locator('.bpm-candidate').allInnerTexts()
    await shot(page, `${clip.name}-02-bpm-editor-open.png`)
    await page.getByRole('button', { name: '收起', exact: true }).click()

    // 2 · count on → pose preprocessing with progress
    await menuPage(page, '练习设置')
    await page.getByRole('button', { name: /^高级/ }).click()
    await page.getByRole('button', { name: '数拍', exact: true }).click()
    const started = Date.now()
    await expect(page.locator('.pose-status progress')).toBeVisible({ timeout: 30000 })
    await expect.poll(async () => Number(await page.locator('.pose-status progress').getAttribute('value')), { timeout: 60000 }).toBeGreaterThan(0.3)
    await shot(page, `${clip.name}-03-pose-progress.png`)
    await expect(page.locator('.pose-status')).toContainText('动作分析完成', { timeout: 150000 })
    summary.poseSeconds = Math.round((Date.now() - started) / 100) / 10
    summary.poseText = (await page.locator('.pose-status').innerText()).replace(/\s+/g, ' ')
    summary.anchorText = await page.locator('.anchor-info').innerText()
    summary.countModeInfo = await page.getByTestId('count-mode-info').innerText()
    summary.nativeVolumeWhileCounting = await page.evaluate(() => (window as unknown as { __adlTeacherGain?: number }).__adlTeacherGain ?? 1)
    expect(summary.nativeVolumeWhileCounting).toBe(0) // the video's own music is muted while the count sounds
    await shot(page, `${clip.name}-04-count-settings.png`)
    await page.keyboard.press('Escape')

    // 3 · count sound trigger times at 1× (timeline drag auto-plays)
    await page.waitForTimeout(1500)
    await page.evaluate(() => { window.__countLog!.length = 0 })
    await seek(page, clip.seekAt)
    await expect.poll(async () => (await state(page)).paused).toBe(false)
    await expect.poll(() => page.evaluate(() => window.__countLog!.length), { timeout: 15000 }).toBeGreaterThan(14)
    await shot(page, `${clip.name}-05-overlay-playing.png`)
    const log1 = await activeLog(page)
    fs.writeFileSync(path.join(OUT, `${clip.name}-count-log-1x.json`), JSON.stringify(await page.evaluate(() => JSON.parse(window.__countExport!())), null, 1))
    await page.locator('.bpm-number').click()
    summary.countHint = await page.getByTestId('count-hint').innerText()
    await shot(page, `${clip.name}-05b-bpm-hint.png`)
    await page.getByRole('button', { name: '收起', exact: true }).click()
    const numberBpm = Number(/([\d.]+) BPM 数字拍/.exec(summary.countHint as string)![1])
    const numbers = log1.filter(e => e.label !== '&')
    // The very first count after a seek can be up to ~0.13 s off while the video starts to move (the clock only re-anchors on jumps > 0.1 s of media time); the next one can still be ~0.06 s off while the clock converges; after that the spacing is exact.
    const numberGaps = numbers.slice(2, 10).map((e, i) => e.ctxHit - numbers[i + 1].ctxHit)
    summary.firstGapAfterSeekMs1x = Math.round((numbers[1].ctxHit - numbers[0].ctxHit) * 1000)
    for (const [k, gap] of numberGaps.entries()) expect(Math.abs(gap - 60 / numberBpm), `number gaps ${numberGaps.join(',')} vs ${60 / numberBpm}; log ${JSON.stringify(log1.slice(0, 14).map(e => [e.label, +e.mediaTime.toFixed(3), +e.ctxHit.toFixed(3)]))}`).toBeLessThan(k === 0 ? 0.09 : 0.03) // number beats follow the chosen level (the clock is still converging for the first one)
    for (const e of log1.slice(0, 15)) expect(e.ctxHit).toBeGreaterThan(e.ctxNow - 0.001)
    summary.numberBpm = numberBpm
    summary.numberGapsMs1x = numberGaps.map(g => Math.round(g * 1000))
    summary.firstLabels1x = log1.slice(0, 20).map(e => e.label).join(' ')
    // "and" hits sit strictly between two number beats
    for (const [i, e] of log1.entries()) if (e.label === '&' && i > 0 && i < log1.length - 1) expect(e.ctxHit).toBeGreaterThan(log1[i - 1].ctxHit)

    // 4 · slow motion
    await page.locator('.dock-speed-trigger').click()
    await shot(page, `${clip.name}-06-speed-menu.png`)
    expect(await page.locator('.dock-speed-options button').allInnerTexts()).toEqual(['0.25×', '0.35×', '0.5×', '0.65×', '0.8×', '1×'])
    await page.getByRole('button', { name: '0.35×', exact: true }).click()
    await page.evaluate(() => { window.__countLog!.length = 0 })
    await seek(page, clip.seekAt)
    await expect.poll(() => page.evaluate(() => window.__countLog!.filter(e => !e.cancelled).length), { timeout: 30000 }).toBeGreaterThan(10)
    const slow = await activeLog(page)
    const slowNumbers = slow.filter(e => e.label !== '&')
    const slowGaps = slowNumbers.slice(2, 7).map((e, i) => e.ctxHit - slowNumbers[i + 1].ctxHit)
    summary.firstGapAfterSeekMsSlow035 = Math.round((slowNumbers[1].ctxHit - slowNumbers[0].ctxHit) * 1000)
    summary.gapsMsSlow035 = slowGaps.map(g => Math.round(g * 1000))
    for (const [k, gap] of slowGaps.entries()) expect(Math.abs(gap - 60 / numberBpm / 0.35), `slow gaps ${slowGaps.join(',')} expected ${60 / numberBpm / 0.35}`).toBeLessThan(k === 0 ? 0.15 : 0.06)
    expect(await page.evaluate(() => (window as unknown as { __adlTeacherGain?: number }).__adlTeacherGain ?? 1)).toBe(0) // still muted in slow motion
    expect(slow[0].rate).toBeCloseTo(0.35, 2)
    summary.gapsMsSlow035 = slowGaps.map(g => Math.round(g * 1000))
    fs.writeFileSync(path.join(OUT, `${clip.name}-count-log-0.35x.json`), JSON.stringify(slow, null, 1))
    await shot(page, `${clip.name}-07-slow-0.35.png`)

    // 5 · drag-then-autoplay from a pause (mouse)
    await page.locator('.dock-speed-trigger').click(); await page.getByRole('button', { name: '1×', exact: true }).click()
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    expect((await state(page)).paused).toBe(true)
    const box = (await page.locator('.timeline-row input').boundingBox())!
    await page.mouse.move(box.x + 10, box.y + box.height / 2); await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 }); await page.mouse.up()
    await expect.poll(async () => (await state(page)).paused).toBe(false)
    summary.dragAutoplayAt = Math.round((await state(page)).t * 100) / 100
    await page.getByRole('button', { name: '暂停', exact: true }).click()

    // 6 · export count track as WAV
    await menuPage(page, '练习设置')
    await page.getByRole('button', { name: /^高级/ }).click()
    const download = page.waitForEvent('download', { timeout: 60000 })
    await page.getByRole('button', { name: '导出数拍 WAV' }).click()
    const wav = await download
    await wav.saveAs(path.join(OUT, `${clip.name}-count.wav`))
    await page.keyboard.press('Escape')

    // 7 · eight-beat sections (mark both starts) and free cuts
    await menuPage(page, '数拍与分段')
    const practiceMenu = page.getByRole('region', { name: '练习菜单' })
    await seek(page, 1); await practiceMenu.getByRole('button', { name: '音乐起点', exact: true }).click()
    await seek(page, 3); await practiceMenu.getByRole('button', { name: '动作起点', exact: true }).click()
    await expect(page.getByRole('button', { name: '第3段', exact: true })).toBeVisible()
    summary.eightBeatSections = await page.locator('.dock-section-row button').count()
    await shot(page, `${clip.name}-08-eight-beat-sections.png`)
    await page.keyboard.press('Escape')
    await menuPage(page, '自定义分段')
    await page.getByRole('button', { name: '自定义分段', exact: true }).click()
    await seek(page, 6.37); await page.getByRole('button', { name: '在当前位置添加分界' }).click()
    await seek(page, 14.8); await page.getByRole('button', { name: '在当前位置添加分界' }).click()
    await seek(page, 21.05); await page.getByRole('button', { name: '在当前位置添加分界' }).click()
    await expect(page.getByText('共 4 段')).toBeVisible()
    await shot(page, `${clip.name}-09-custom-cuts-editor.png`)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '第4段', exact: true })).toBeVisible()
    const cuts = () => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('adl-practice:'))!)!))
    expect((await cuts()).customCuts).toEqual([6.37, 14.8, 21.05])
    summary.customCuts = (await cuts()).customCuts

    // 8 · manual BPM correction leaves custom cuts alone; ×2 / ÷2 act on the number-beat level
    await page.locator('.bpm-number').click()
    const field = page.getByRole('spinbutton', { name: '修正 BPM' })
    await field.fill('96'); await field.press('Enter')
    await expect(page.locator('.tempo-state')).toHaveText(/手动.*96.*BPM/)
    await page.locator('.bpm-number').click()
    const before = Number(/([\d.]+) BPM 数字拍/.exec(await page.getByTestId('count-hint').innerText())![1])
    await page.getByRole('button', { name: '放快' }).click()
    const doubled = Number(/([\d.]+) BPM 数字拍/.exec(await page.getByTestId('count-hint').innerText())![1])
    expect(doubled / before).toBeCloseTo(2, 1)
    await expect(page.locator('.tempo-state')).toHaveText(/手动.*96.*BPM/)
    await page.getByRole('button', { name: '放慢' }).click()
    expect(Number(/([\d.]+) BPM 数字拍/.exec(await page.getByTestId('count-hint').innerText())![1])).toBeCloseTo(before, 1)
    await shot(page, `${clip.name}-10-bpm-manual.png`)
    expect((await cuts()).customCuts).toEqual([6.37, 14.8, 21.05])
    // 9 · count off → the video's own sound comes back
    await page.keyboard.press('Escape')
    await menuPage(page, '练习设置')
    await page.getByRole('button', { name: '数拍', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __adlTeacherGain?: number }).__adlTeacherGain ?? 1)).toBeGreaterThan(0.3)
    fs.writeFileSync(path.join(OUT, `${clip.name}-summary.json`), JSON.stringify(summary, null, 1))
  })
}
