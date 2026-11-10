import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

const fixture = path.resolve('.test-artifacts/practice-late-128bpm.mp4')
const stats = (page: Page) => page.evaluate(() => (window as unknown as { __adlStats?: { analysisRuns: number; analysisFromCache: number } }).__adlStats ?? { analysisRuns: 0, analysisFromCache: 0 })
async function pick(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: /开始练习/ }).click()
  await page.locator('input[type=file]').setInputFiles(fixture)
  await expect(page.locator('.tempo-state')).toHaveText(/自动.*12[6789].*BPM/, { timeout: 30000 })
}

test('same video re-picked restores alignment without re-analysing; clearing makes it analyse again', async ({ page }) => {
  await pick(page)
  expect((await stats(page)).analysisRuns).toBe(1)
  const firstState = await page.locator('.tempo-state').innerText()
  // Alignment data is mirrored in IndexedDB (not only localStorage).
  await expect.poll(() => page.evaluate(() => new Promise<number>(resolve => {
    const request = indexedDB.open('frametune-dances')
    request.onsuccess = () => { const get = request.result.transaction('dances').objectStore('dances').count(); get.onsuccess = () => resolve(get.result) }
    request.onerror = () => resolve(-1)
  }))).toBe(1)

  // Reopen (simulates closing the tab / phone killing the page): same result, no new analysis run.
  await page.reload()
  await pick(page)
  expect(await stats(page)).toMatchObject({ analysisRuns: 0, analysisFromCache: 1 })
  await expect(page.locator('.tempo-state')).toHaveText(firstState)

  // Even if this device lost localStorage, the IndexedDB copy restores it.
  await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('adl-')).forEach(k => localStorage.removeItem(k)))
  await page.reload()
  await pick(page)
  expect(await stats(page)).toMatchObject({ analysisRuns: 0, analysisFromCache: 1 })
  await expect(page.locator('.tempo-state')).toHaveText(firstState)

  // Folded "已保存的舞" list: clear this one.
  await page.reload()
  await page.getByRole('button', { name: /开始练习/ }).click()
  await page.locator('summary', { hasText: '已保存的舞' }).click()
  await expect(page.locator('.saved-dances li')).toHaveCount(1)
  await expect(page.locator('.saved-dances li')).toContainText('practice-late-128bpm.mp4')
  await page.getByRole('button', { name: /^清除 practice-late/ }).click()
  await expect(page.getByText('还没有保存的舞。')).toBeVisible()
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes('practice-late')).length)).toBe(0)

  await page.reload()
  await pick(page)
  expect(await stats(page)).toMatchObject({ analysisRuns: 1, analysisFromCache: 0 })
})

test('"全部清除" empties the list, and background / foreground does not re-run alignment', async ({ page }) => {
  await pick(page)
  const before = await page.locator('.tempo-state').innerText()
  // Phone screen off and back on.
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
      document.dispatchEvent(new Event('visibilitychange'))
    }
  })
  await page.waitForTimeout(1500)
  expect(await stats(page)).toMatchObject({ analysisRuns: 1 })
  await expect(page.locator('.tempo-state')).toHaveText(before)

  await page.getByRole('button', { name: /更多/ }).click()
  await page.getByRole('navigation', { name: /更多选项/ }).getByRole('button', { name: '已保存的舞', exact: true }).click()
  await expect(page.locator('.saved-dances li')).toHaveCount(1)
  await page.getByRole('button', { name: '全部清除', exact: true }).click()
  await expect(page.getByText('还没有保存的舞。')).toBeVisible()
})

const fixtureB = path.resolve('.test-artifacts/practice-100bpm.mp4')
const tempoText = (page: Page) => page.locator('.tempo-state').innerText()
async function changeVideoTo(page: Page, file: string) {
  const chooser = page.waitForEvent('filechooser')
  await openChangeVideo(page)
  await (await chooser).setFiles(file)
}
async function openChangeVideo(page: Page) {
  await page.getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('navigation', { name: /更多选项/ }).getByRole('button', { name: '换视频', exact: true }).click()
}
const savedKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('adl-practice:')).sort())

test('change video A -> B -> back to A: always-visible button saves, stops playback, restores A without re-analysing and never mixes data', async ({ page }) => {
  await pick(page) // A = late 128 BPM
  const stateA = await tempoText(page)
  expect(stateA).toMatch(/12[6789]/)
  expect((await stats(page)).analysisRuns).toBe(1)
  // the button is visible on a phone-sized screen too, and playback is stopped when it is pressed
  await page.setViewportSize({ width: 390, height: 844 })
  // 换视频 lives in ⋯ (更多) since the 2026-11 UI refresh; the ⋯ button is always visible.
  await expect(page.getByRole('button', { name: '更多', exact: true })).toBeVisible()
  await page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => { void v.play() })
  await expect.poll(() => page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true)
  const chooser = page.waitForEvent('filechooser')
  await openChangeVideo(page)
  expect(await page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await (await chooser).setFiles(fixtureB)

  // B: new fingerprint, analysed fresh, its own BPM, A untouched.
  await expect(page.locator('.tempo-state')).toHaveText(/自动.*\d+.*BPM/, { timeout: 30000 })
  await expect.poll(async () => (await tempoText(page)).includes('128') || /12[6789]/.test(await tempoText(page))).toBe(false)
  const stateB = await tempoText(page)
  expect(stateB).not.toBe(stateA)
  expect(await stats(page)).toMatchObject({ analysisRuns: 2, analysisFromCache: 0 })
  expect(await savedKeys(page)).toHaveLength(2)
  const bpms = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('adl-practice:')).map(k => JSON.parse(localStorage.getItem(k)!).bpm as number))
  expect(new Set(bpms.map(Math.round)).size).toBe(2)

  // back to A: restored from the saved fingerprint, no new analysis.
  await changeVideoTo(page, fixture)
  await expect(page.locator('.tempo-state')).toHaveText(stateA, { timeout: 30000 })
  expect(await stats(page)).toMatchObject({ analysisRuns: 2, analysisFromCache: 1 })

  // "已保存的舞" -> 切换 B: asks for the file, matching file restores B without analysing again.
  await page.getByRole('button', { name: /更多/ }).click()
  await page.getByRole('navigation', { name: /更多选项/ }).getByRole('button', { name: '已保存的舞', exact: true }).click()
  await expect(page.locator('.saved-dances li')).toHaveCount(2)
  const chooser2 = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^切换到 practice-100bpm/ }).click()
  await expect(page.getByRole('status').filter({ hasText: '请选择视频文件「practice-100bpm.mp4」' })).toBeVisible()
  await (await chooser2).setFiles(fixtureB)
  await expect(page.getByText('已恢复「practice-100bpm.mp4」的对齐')).toBeVisible()
  await expect(page.locator('.tempo-state')).toHaveText(stateB, { timeout: 30000 })
  expect(await stats(page)).toMatchObject({ analysisRuns: 2, analysisFromCache: 2 })

  // picking a different file than the saved item is treated as a new video, with a notice.
  await page.getByRole('button', { name: /更多/ }).click()
  await page.getByRole('navigation', { name: /更多选项/ }).getByRole('button', { name: '已保存的舞', exact: true }).click()
  const chooser3 = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^切换到 practice-100bpm/ }).click()
  await (await chooser3).setFiles(fixture)
  await expect(page.getByText(/所选文件和保存的「practice-100bpm.mp4」不一致/)).toBeVisible()
  await expect(page.locator('.tempo-state')).toHaveText(stateA, { timeout: 30000 })
})
