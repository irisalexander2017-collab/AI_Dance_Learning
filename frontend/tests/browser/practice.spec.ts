import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
// Fullscreen moved into ⋯ (更多) in the 2026-11 UI refresh.
async function toggleFullscreenFromMenu(page: import('@playwright/test').Page, name: '进入全屏' | '退出全屏') {
  await page.getByRole('button', { name: /更多|More/ }).click()
  await page.getByRole('navigation', { name: /更多选项|More options/ }).getByRole('button', { name, exact: true }).click()
}

const fixture = path.resolve('.test-artifacts/practice-100bpm.mp4')
// Allow only static same-origin page resources; media/API uploads remain failures online too.
const appOrigin = new URL(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/').origin
function isUnexpectedNetworkRequest(request: import('@playwright/test').Request) {
  if (!/^https?:/.test(request.url())) return false
  return new URL(request.url()).origin !== appOrigin || request.method() !== 'GET'
    || !['document', 'script', 'stylesheet', 'image', 'font'].includes(request.resourceType())
}
async function openBpmEditor(page: Page) {
  if (await page.locator('#bpm-editor').count() === 0) await page.locator('.bpm-number').click()
  await expect(page.locator('#bpm-editor')).toBeVisible()
}
async function ensureBpmTypeField(page: Page) {
  await openBpmEditor(page)
  const field = page.getByRole('spinbutton', { name: /曲速（音乐 BPM）|Song tempo|修正 BPM|Correct BPM/ })
  if (await field.count() === 0) await page.getByRole('button', { name: /手动输入|Type BPM/ }).click()
  await expect(field).toBeVisible()
}
async function setManualBpm(page: Page, value: string) {
  await ensureBpmTypeField(page)
  await page.getByRole('spinbutton', { name: /曲速（音乐 BPM）|Song tempo|修正 BPM|Correct BPM/ }).fill(value)
  await page.getByRole('button', { name: /确认曲速|Set tempo|确认|OK/ }).click()
}
test('unconfirmed BPM edits preserve confirmed manual tempo and selected section after refresh', async ({page}) => {
  await loadVideo(page)
  await setManualBpm(page, '130')
  await setup(page)
  await page.getByRole('button',{name:'第3段',exact:true}).click()
  await ensureBpmTypeField(page)
  await page.getByRole('spinbutton').fill('140')
  await page.reload()
  await page.getByRole('button',{name:/开始练习/}).click()
  await page.locator('input[type=file]').setInputFiles(fixture)
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*130.*BPM/)
  await expect(page.getByRole('button',{name:'第3段',exact:true})).toHaveAttribute('aria-pressed','true')
})
test('automatic analysis cannot overwrite a BPM being typed before confirmation', async ({page}) => {
  await page.addInitScript(() => {
    const decode = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = function(bytes: ArrayBuffer) {
      return new Promise<AudioBuffer>((resolve,reject) => { setTimeout(() => { void decode.call(this,bytes).then(resolve,reject) },1200) })
    }
  })
  await loadVideo(page)
  await ensureBpmTypeField(page)
  await page.getByRole('spinbutton').fill('120')
  await page.waitForTimeout(2200)
  await expect(page.getByRole('spinbutton')).toHaveValue('120')
  await page.getByRole('button',{name:'确认',exact:true}).click()
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*120.*BPM/)
})

test('recognizing the old default preserves already customized boundaries at the same tempo', async ({page}) => {
  await loadVideo(page)
  const key = await page.evaluate(() => Object.keys(localStorage).find(k=>k.startsWith('adl-practice:'))!)
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({bpm:100,firstBeatTime:2,firstBeatConfirmed:true,formalStartTime:6,boundaryOffsets:[.5]})),key)
  await page.reload()
  await page.getByRole('button',{name:/开始练习/}).click()
  await page.locator('input[type=file]').setInputFiles(fixture)
  await expect(page.locator('.tempo-state')).toHaveText(/自动.*BPM/, {timeout:30000})
  await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).boundaryOffsets,key)).toEqual([.5])
})
test('a stalled audio decoder times out without inventing BPM or freezing video controls', async ({page}) => {
  await page.addInitScript(() => { AudioContext.prototype.decodeAudioData = () => new Promise<AudioBuffer>(() => {}) })
  await loadVideo(page)
  await expect(page.locator('.tempo-state')).toHaveText(/未识别/, {timeout:26000})
  // detailed timeout copy used to live on the removed "节拍校准" menu page; the chip is enough
  await setManualBpm(page, '120')
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*120.*BPM/)
})
test('old default tempo with saved starts is automatically recognized on import', async ({page}) => {
  await loadVideo(page)
  const key = await page.evaluate(() => Object.keys(localStorage).find(k=>k.startsWith('adl-practice:'))!)
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({bpm:100,firstBeatTime:2,firstBeatConfirmed:true,formalStartTime:6})),key)
  await page.reload()
  await page.getByRole('button',{name:/开始练习/}).click()
  await page.locator('input[type=file]').setInputFiles(fixture)
  await expect(page.locator('.tempo-state')).toHaveText(/自动.*BPM/, {timeout:30000})
  const bpm = Number((await page.locator('.tempo-state').innerText()).match(/[\d.]+/)![0])
  expect(Math.abs(bpm - 100)).toBeLessThan(2)
  await expect(page.getByRole('button',{name:'第3段',exact:true})).toBeVisible()
})

test('late music is analyzed and BPM status is visible without opening settings', async ({page}) => {
  await page.goto('./')
  await page.getByRole('button',{name:/开始练习/}).click()
  await page.locator('input[type=file]').setInputFiles(path.resolve('.test-artifacts/practice-late-128bpm.mp4'))
  await expect(page.locator('.tempo-state')).toHaveText(/自动.*12[6789].*BPM/, {timeout:30000})
  await expect(page.locator('.compact-menu')).toHaveCount(0)
})

test('unrecognized audio never silently generates sections using the default 100 BPM', async ({page}) => {
  await page.goto('./')
  await page.getByRole('button',{name:/开始练习/}).click()
  await page.locator('input[type=file]').setInputFiles(path.resolve('.test-artifacts/practice-silent.mp4'))
  await expect(page.locator('.tempo-state')).toHaveText(/几乎无声|未识别|分析/, {timeout:30000})
  await markAt(page, 'music', 2)
  await markAt(page, 'dance', 6)
  await expect(page.locator('.dock-section-row button')).toHaveCount(0)
  await ensureBpmTypeField(page)
  await expect(page.getByRole('spinbutton')).toBeEmpty()
})
async function loadVideo(page: Page, en = false) {
  await page.goto('./')
  if (en) await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByRole('button', { name: en ? /Start practicing/ : /开始练习/ }).click()
  await page.locator('input[type=file]').setInputFiles(fixture)
  await expect.poll(() => page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(20)
}
async function seek(page: Page, time: number) {
  await page.locator('.timeline-row input').evaluate((input: HTMLInputElement, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, time)
}
async function openPractice(page: Page, en = false) {
  await page.getByRole('button', { name: /更多|More/ }).click()
  await page.getByRole('navigation', { name: /更多选项|More options/ }).getByRole('button', { name: en ? 'Count & sections' : '数拍与分段', exact: true }).click()
}
async function openSide(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name: /更多|More/ }).click()
  await page.getByRole('navigation', { name: /更多选项|More options/ }).getByRole('button', { name }).click()
}
async function markAt(page: Page, kind: 'music' | 'dance', time: number, en = false) {
  const chip = kind === 'music'
    ? page.getByRole('button', { name: en ? /^Music\b/ : /^音乐\b/ })
    : page.getByRole('button', { name: en ? /^Dance\b/ : /^动作\b/ })
  await chip.click()
  await seek(page, time)
  await page.getByRole('button', { name: en ? 'Confirm' : '确认', exact: true }).click()
}
async function setup(page: Page, en = false) {
  await markAt(page, 'music', 2, en)
  await markAt(page, 'dance', 6, en)
  await expect(page.getByRole('button', { name: en ? 'Section 3' : '第3段', exact: true })).toBeVisible()
}
for (const en of [false, true]) {
  test('continuous setup replaces saved starts without reopening the menu ' + (en ? 'EN' : 'ZH'), async ({page}) => {
    await page.setViewportSize({width:390,height:844})
    await loadVideo(page,en)
    await setup(page,en)
    await page.reload()
    await page.getByRole('button',{name:en ? /Start practicing/ : /开始练习/}).click()
    await page.locator('input[type=file]').setInputFiles(fixture)
    await expect(page.locator('.start-markers')).toContainText('6.00s')
    await expect(page.locator('.start-markers')).toContainText('2.00s')
    await markAt(page, 'music', 3, en)
    await expect(page.locator('.start-markers')).toContainText('3.00s')
    await page.screenshot({path:'.test-artifacts/continuous-setup-' + (en ? 'en' : 'zh') + '.png'})
    await markAt(page, 'dance', 8, en)
    await expect(page.locator('.start-markers')).toContainText('3.00s')
    await expect(page.locator('.start-markers')).toContainText('8.00s')
    await expect.poll(() => page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('adl-practice:'))!
      const saved = JSON.parse(localStorage.getItem(key)!)
      return [saved.firstBeatTime, saved.formalStartTime]
    })).toEqual([3,8])
  })
}
test('continuous setup keeps invalid dance starts open and can recover', async ({page}) => {
  await loadVideo(page)
  await setup(page)
  await markAt(page, 'music', 3)
  await page.getByRole('button', { name: /^动作\b/ }).click()
  await seek(page, 2)
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('动作起点不能早于音乐起点。',{exact:true})).toBeVisible()
  await seek(page, 8)
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('动作起点不能早于音乐起点。',{exact:true})).toHaveCount(0)
  await expect(page.locator('.start-markers')).toContainText('8.00s')
})
for (const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1280,height:800}]) {
  for (const en of [false,true]) {
    test('practice workflow ' + viewport.width + ' ' + (en ? 'EN' : 'ZH'), async ({page}) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.setViewportSize(viewport)
      await loadVideo(page,en)
      await setup(page,en)
      const stage = await page.locator('.video-stage').boundingBox()
      const dock = await page.locator('.practice-dock').boundingBox()
      expect(stage!.height).toBeGreaterThan(viewport.height * .45)
      expect(dock!.y + dock!.height).toBeLessThanOrEqual(viewport.height + 1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const hint = page.getByRole('button', {name:en ? 'Got it' : '知道了',exact:true})
      if (await hint.isVisible()) await hint.click()
      await page.getByRole('button', {name:en ? 'Section 3' : '第3段',exact:true}).click()
      await expect.poll(() => page.locator('.teacher-video-panel video').evaluate((v:HTMLVideoElement) => v.currentTime)).toBeGreaterThan(14)
      await page.getByRole('button', {name:en ? 'Build-up' : '累加',exact:true}).click()
      await expect.poll(() => page.locator('.teacher-video-panel video').evaluate((v:HTMLVideoElement) => v.currentTime)).toBeLessThan(6)
      await page.getByRole('button', {name:en ? 'Collapse sections' : '收起段号',exact:true}).click()
      await expect(page.locator('.dock-section-row')).toHaveCount(0)
      await page.getByRole('button', {name:en ? 'Expand sections' : '展开段号',exact:true}).click()
      await page.getByRole('button', {name:/^(速度|Speed) /}).click()
      await page.getByRole('button', {name:'0.8×',exact:true}).click()
      expect(await page.locator('.teacher-video-panel video').evaluate((v:HTMLVideoElement) => v.playbackRate)).toBe(.8)
      await page.getByRole('button', {name:en ? 'Play' : '播放',exact:true}).click()
      await expect.poll(() => page.locator('.teacher-video-panel video').evaluate((v:HTMLVideoElement) => v.paused)).toBe(false)
      await page.getByRole('button', {name:en ? 'Pause' : '暂停',exact:true}).click()
      await openPractice(page, en)
      await expect(page.locator('.video-stage')).toBeVisible()
      await seek(page,12)
      await page.locator('.timeline-row input').dispatchEvent('pointerup')
      await page.getByRole('button',{name:en ? 'Close' : '关闭',exact:true}).click()
      expect(errors).toEqual([])
      await page.screenshot({path:'.test-artifacts/practice-' + viewport.width + '-' + (en?'en':'zh') + '.png'})
      await page.reload()
      await page.getByRole('button',{name:en ? /Start practicing/ : /开始练习/}).click()
      await page.locator('input[type=file]').setInputFiles(fixture)
      await expect(page.getByRole('button',{name:en ? 'Section 3' : '第3段',exact:true})).toBeVisible()
    })
  }
}
test('audio analysis, gestures, recording and download', async ({page,context}) => {
  await page.setViewportSize({width:390,height:844})
  await loadVideo(page)
  await expect(page.locator('.tempo-state')).toHaveText(/自动.*BPM/, {timeout:25000})
  const autoBpm = Number((await page.locator('.tempo-state').innerText()).match(/[\d.]+/)![0])
  expect(autoBpm).toBeGreaterThan(98)
  expect(autoBpm).toBeLessThan(102)
  await openBpmEditor(page)
  expect(Number(await page.getByRole('spinbutton').inputValue())).toBeGreaterThan(98)
  expect(Number(await page.getByRole('spinbutton').inputValue())).toBeLessThan(102)
  await page.getByRole('button',{name:'收起',exact:true}).click()
  await setup(page)
  const box = (await page.locator('.teacher-video-panel').boundingBox())!
  const x = box.x + box.width/2, y = box.y + box.height/2
  const client = await context.newCDPSession(page)
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:x-40,y},{id:2,x:x+40,y}]})
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x-80,y},{id:2,x:x+80,y}]})
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await expect.poll(() => page.locator('.teacher-video-panel video').evaluate(v => v.style.transform)).toContain('scale(2)')
  expect(await page.locator('.teacher-video-panel video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true)
  await page.getByRole('button',{name:'摄像头对比',exact:true}).click()
  await expect(page.locator('.camera-video')).toBeVisible()
  await openSide(page, '录像设置')
  await page.getByLabel('录制倒计时').selectOption('3')
  await page.getByRole('button',{name:'关闭',exact:true}).click()
  await toggleFullscreenFromMenu(page, '进入全屏')
  await page.getByRole('button',{name:'开始录制',exact:true}).click()
  await page.getByRole('button',{name:'取消',exact:true}).click()
  await expect(page.locator('.recording-countdown')).toHaveCount(0)
  await page.getByRole('button',{name:'开始录制',exact:true}).click()
  await expect(page.getByRole('button',{name:'停止录制',exact:true})).toBeVisible()
  await page.waitForTimeout(1500)
  await page.getByRole('button',{name:'停止录制',exact:true}).click()
  await expect(page.getByRole('heading',{name:'练习录像回看'})).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement === null)).toBe(true)
  await expect(page.getByText(/本地生成 · 包含老师视频声音/)).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link',{name:'下载 WebM'}).click()
  const download = await downloadPromise
  await download.saveAs('.test-artifacts/recording.webm')
  await page.getByRole('button',{name:'再录一次',exact:true}).click()
  await page.getByRole('button',{name:'取消',exact:true}).click()
  await page.getByRole('button',{name:'查看录像',exact:true}).click()
  await page.getByRole('button',{name:'删除录像',exact:true}).click()
  await expect(page.locator('.recording-review')).toHaveCount(0)
  await page.getByRole('button',{name:'关闭摄像头',exact:true}).click()
  await expect(page.locator('.camera-video')).toHaveCount(0)
  await expect(page.locator('.teacher-video-panel video')).toHaveCSS('transform', /matrix\(2,/)
})

test('silent video calibration and malformed saved settings are safe', async ({page}) => {
  await page.goto('./')
  await page.getByRole('button',{name:/开始练习/}).click()
  await page.locator('input[type=file]').setInputFiles(path.resolve('.test-artifacts/practice-silent.mp4'))
  await expect(page.locator('.tempo-state')).toHaveText(/几乎无声|未识别|分析/, { timeout: 30000 })
  await setManualBpm(page, '120')
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*120.*BPM/)
  await setup(page)
  await toggleFullscreenFromMenu(page, '进入全屏')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
  const dock = (await page.locator('.practice-dock').boundingBox())!
  expect(dock.y+dock.height).toBeLessThanOrEqual((page.viewportSize()!.height)+1)
  await toggleFullscreenFromMenu(page, '退出全屏')
  const key = await page.evaluate(() => Object.keys(localStorage).find(k=>k.startsWith('adl-practice:'))!)
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({bpm:0,currentSegmentIndex:'bad',firstBeatTime:'bad',formalStartTime:'bad',boundaryOffsets:[null]})),key)
  await page.reload()
  await page.getByRole('button',{name:/开始练习/}).click()
  await page.locator('input[type=file]').setInputFiles(path.resolve('.test-artifacts/practice-silent.mp4'))
  await expect(page.locator('.teacher-video-panel video')).toBeVisible()
  await expect(page.locator('.dock-section-row button')).toHaveCount(0)
})
test('single range loops only its selected section; invalid custom boundary is rejected', async ({page}) => {
  await loadVideo(page)
  await setup(page)
  await page.getByRole('button',{name:'循环',exact:true}).click()
  await page.getByRole('button',{name:'第3段',exact:true}).click()
  await seek(page,20.3)
  await expect(page.getByRole('button',{name:'取消等待',exact:true})).toBeVisible()
  await expect.poll(() => page.locator('.teacher-video-panel video').evaluate((v:HTMLVideoElement)=>v.currentTime),{timeout:6000}).toBeLessThan(18)
  await page.getByRole('button',{name:'暂停',exact:true}).click()
  await openPractice(page)
  await seek(page,1)
  await page.locator('.timeline-row input').dispatchEvent('pointerup')
  await expect(page.getByRole('alert')).toHaveText('请选择相邻分界之间的位置。')
})
test('she-goes-by BPM regression is recognized correctly on first and repeat import', async ({page}) => {
  test.skip(!process.env.BPM_REGRESSION_VIDEO, 'Set BPM_REGRESSION_VIDEO to the local failing clip.')
  const remoteRequests: string[] = [], errors: string[] = []
  page.on('request', request => { if (isUnexpectedNetworkRequest(request)) remoteRequests.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({width:390,height:844})
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto('./')
    await page.getByRole('button',{name:/开始练习/}).click()
    await page.locator('input[type=file]').setInputFiles(process.env.BPM_REGRESSION_VIDEO!)
    await expect(page.locator('.tempo-state')).toHaveText(/自动.*BPM/, {timeout:30000})
    const bpm = Number((await page.locator('.tempo-state').innerText()).match(/[\d.]+/)![0])
    console.log('She goes by BPM, import', attempt + 1, ':', bpm)
    expect(Math.abs(bpm - 146)).toBeLessThan(2)
  }
  await page.screenshot({path:'.test-artifacts/she-goes-by-mobile.png'})
  expect(remoteRequests).toEqual([])
  expect(errors).toEqual([])
})

test('real dance video opens, plays and analyzes without uploading', async ({page}) => {
  test.skip(!process.env.REAL_DANCE_VIDEO,'Set REAL_DANCE_VIDEO to a local dance file.')
  const remoteRequests:string[]=[]
  const errors:string[]=[]
  page.on('request',request=> { if(isUnexpectedNetworkRequest(request))remoteRequests.push(request.url()) })
  page.on('pageerror',error=>errors.push(error.message))
  await page.setViewportSize({width:390,height:844})
  await page.goto('./')
  await page.getByRole('button',{name:/开始练习/}).click()
  await page.locator('input[type=file]').setInputFiles(process.env.REAL_DANCE_VIDEO!)
  await expect.poll(()=>page.locator('.teacher-video-panel video').evaluate((v:HTMLVideoElement)=>v.duration)).toBeGreaterThan(0)
  await page.getByRole('button',{name:'播放',exact:true}).click()
  await expect.poll(()=>page.locator('.teacher-video-panel video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(.2)
  await page.getByRole('button',{name:'暂停',exact:true}).click()
  await expect(page.locator('.tempo-state')).not.toHaveText(/识别BPM中/,{timeout:30000})
  if (process.env.REAL_EXPECTED_BPM) {
    await expect(page.locator('.tempo-state')).toHaveText(/自动.*BPM/)
    const bpm = Number(await page.getByRole('spinbutton').inputValue())
    console.log('Real dance BPM:', bpm, 'reference:', process.env.REAL_EXPECTED_BPM)
    expect(Math.abs(bpm - Number(process.env.REAL_EXPECTED_BPM))).toBeLessThan(2)
  }
  await page.screenshot({path:'.test-artifacts/real-dance-mobile.png'})
  expect(remoteRequests).toEqual([])
  expect(errors).toEqual([])
})

test('manual calibration persists before marking, and shortened boundary selection stays usable', async ({page}) => {
  await loadVideo(page)
  await setManualBpm(page, '120')
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*120.*BPM/)
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('adl-practice:'))!
    const saved = JSON.parse(localStorage.getItem(key)!)
    return [saved.bpm,saved.tempoMode]
  })).toEqual([120,'manual'])
  await page.reload()
  await page.getByRole('button',{name:/开始练习/}).click()
  await page.locator('input[type=file]').setInputFiles(fixture)
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*120.*BPM/)
  await setup(page)
  await openPractice(page)
  await page.getByRole('button',{name:'关闭',exact:true}).click()
  await openBpmEditor(page)
  await page.getByRole('spinbutton').fill('40')
  await page.getByRole('button',{name:'确认',exact:true}).click()
  await openPractice(page)
  await seek(page,16)
  await page.locator('.timeline-row input').dispatchEvent('pointerup')
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'第2段',exact:true}).click()
  await seek(page,1) // changed requirement: a drag outside the selected section plays from there (selection follows the playhead)
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'第2段',exact:true}).click()
  await expect.poll(()=>page.locator('.teacher-video-panel video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThanOrEqual(16)
})
test('recording failure is visible without opening settings', async ({page}) => {
  await page.addInitScript(() => { Object.defineProperty(window,'MediaRecorder',{value:undefined,configurable:true}) })
  await loadVideo(page)
  await page.getByRole('button',{name:'摄像头对比',exact:true}).click()
  await expect(page.locator('.camera-video')).toBeVisible()
  await page.getByRole('button',{name:'开始录制',exact:true}).click()
  await expect(page.locator('.practice-dock [role=alert]')).toBeVisible()
  await expect(page.locator('.compact-menu')).toHaveCount(0)
})

test('calibration cancels an in-flight audio decode and storage denial does not crash practice', async ({page}) => {
  await page.addInitScript(() => {
    const decode = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = function(bytes: ArrayBuffer) {
      return new Promise<AudioBuffer>((resolve,reject) => { setTimeout(() => { void decode.call(this,bytes).then(resolve,reject) },1200) })
    }
  })
  await loadVideo(page)
  await setManualBpm(page, '130')
  await page.waitForTimeout(1600)
  await expect(page.locator('.tempo-state')).toHaveText(/手动.*130.*BPM/)
})
test('blocked local storage leaves current-session controls usable', async ({page}) => {
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked','SecurityError') }
    Storage.prototype.setItem = () => { throw new DOMException('Blocked','SecurityError') }
  })
  await loadVideo(page)
  await setup(page)
  await page.getByRole('button',{name:'第3段',exact:true}).click()
  await expect(page.getByRole('button',{name:'第3段',exact:true})).toHaveAttribute('aria-pressed','true')
  expect(errors).toEqual([])
})
test('native timeline clicks offer both start markers; zoomed drag does not play', async ({page}) => {
  await page.setViewportSize({width:390,height:844})
  await loadVideo(page)
  await openPractice(page)
  const practiceMenu = page.getByRole('region', { name: '练习菜单' })
  const slider = page.locator('.timeline-row input')
  const bounds = (await slider.boundingBox())!
  await slider.click({position:{x:8+(bounds.width-16)*2/24,y:bounds.height/2}})
  await expect(practiceMenu.getByRole('button',{name:'去标音乐',exact:true})).toBeVisible()
  await practiceMenu.getByRole('button',{name:'去标音乐',exact:true}).click()
  await slider.click({position:{x:8+(bounds.width-16)*6/24,y:bounds.height/2}})
  await practiceMenu.getByRole('button',{name:'去标动作',exact:true}).click()
  await expect(page.getByRole('button',{name:'第3段',exact:true})).toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('.teacher-video-panel video').evaluate((v: HTMLVideoElement) => { v.style.transform = 'translate(0px, 0px) scale(2)' })
  const stage = (await page.locator('.teacher-video-panel').boundingBox())!
  await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2)
  await page.mouse.down()
  await page.mouse.move(stage.x+stage.width/2+35,stage.y+stage.height/2+20,{steps:4})
  await page.mouse.up()
  expect(await page.locator('.teacher-video-panel video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true)
  await page.locator('.teacher-video-panel').click({position:{x:80,y:120}})
  await expect.poll(()=>page.locator('.teacher-video-panel video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(false)
})

test("collapsed section row shows total count and current section", async ({ page }) => {
  await loadVideo(page)
  await setup(page)
  await expect(page.locator(".dock-section-row button").first()).toBeVisible()
  const n = await page.locator(".dock-section-row button").count()
  expect(n).toBeGreaterThan(1)
  await page.getByRole("button", { name: "收起段号" }).click()
  await expect(page.locator(".dock-range-summary")).toHaveText(new RegExp(`共 ${n} 段 · 当前第 1 段`))
  await page.getByRole("button", { name: "累加", exact: true }).click()
  await page.getByRole("button", { name: "展开段号" }).click()
  await page.getByRole("button", { name: "第3段", exact: true }).click()
  await page.getByRole("button", { name: "收起段号" }).click()
  await expect(page.locator(".dock-range-summary")).toHaveText(/共 \d+ 段 · 第1–3 段/)
})
