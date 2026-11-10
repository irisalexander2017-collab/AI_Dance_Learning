# CHANGES — 慢放 / 拖动自动播放 / 老师数拍子 / BPM / 自由分段 / 数拍机制修复

所有路径相对 `frontend/`。依赖：新增 `@mediapipe/tasks-vision` 1.1.1（固定版本）。

## 新增
- `src/pose/`：`types`, `poseCache`（IndexedDB）, `poseClient`（Worker 客户端）, `motionAccents`（手腕/脚踝/躯干速度重音）, `usePoseAccents`
- `src/beats/`：`metadata`（MP4 tmpo、ID3 TBPM）, `onset`, `tempoCandidates`, `audioAnalysis`, `phase`（相位/八拍起拍/`refineTempo`）, `anchor`（第一拍解析）, `grid`（拍点与 1–8/& 标签）, `countSettings`（按视频保存）, `BpmPanel.tsx`
- `src/coach/`：`clock`, `countVoice`, `wav`, `countScheduler`（AudioContext 提前调度、慢放拉长间隔）, `useCountCoach`, `BeatOverlay`, `BeatStrip`, `CountSettingsPanel`
- `src/practice/`：`customSegments.ts`, `CustomCuts.tsx`（自由分段）
- `public/pose-worker.js`、`public/models/pose_landmarker_lite.task`、`public/mediapipe/`（构建时复制，git 忽略）、`public/count-voice/{male,female}/*.wav` + `manifest.json` + `README.md`
- `scripts/copy-mediapipe-assets.mjs`
- 测试：`tests/beats.test.ts`（19 项）、`tests/browser/coach.spec.ts`（8 项）、`tests/browser/real-videos.spec.ts`（2 项，文件不存在则跳过）

## 修改
- `src/App.tsx`：速度档位 0.25–1；时间轴 pointerup/touchend 后自动播放；BPM 小数字 + 展开编辑；数拍菜单/快捷按钮/节拍显示；自由分段与八拍分段切换；帮助文案（中英）
- `src/practice/tempoAnalysis.ts`、`tempo.worker.ts`：onset 与元数据优先的检测流程
- `src/practice/savedPractice.ts`、`beatTimeline.ts`：自由切点与八拍分段分别保存
- `src/styles.css`：追加数拍/BPM/自由分段样式
- `package.json`、`tsconfig.app.json`（allowImportingTsExtensions，供 node --test）、根 `.gitignore`
- `tests/browser/practice.spec.ts`：2 处断言因“拖动后自动播放”新要求而更新（带注释，未删除任何测试）

## 验证
tsc、build 通过；`npm test` 49 通过 / 1 跳过；Playwright 36 通过 / 2 跳过。详见 `../../验收报告.md`。

## 数拍机制修复（2026-10-24）
数拍不再由音频 BPM 网格直接生成，改为由老师动作决定数字拍层级、第 1 拍和拍内动作；原声可静音。路径相对 `frontend/`。

### 新增
- `src/beats/motionTempo.ts`：纯函数核心。`detectDanceStart`（动作起点，忽略前 0.6 s）、`motionPeriod`/`analyzeMotion`（自相关周期）、`chooseNumberLevel`（在音乐 BPM 的 ×4…÷4 里选与动作周期最吻合的层级，带置信度 margin）、`lockFirstBeat`（起点加相位微调与吸附）、`quantizeSubBeats`/`subStats`（拍内动作量化到 1/4、1/3、1/2、2/3、3/4）。
- `src/beats/countPlan.ts`：`planCount` 把上面几项和手动设置合成网格；手动优先，固定模式走旧逻辑。
- `src/beats/countInfo.ts`：BPM 面板里的小提示文案。
- `tests/motion.test.ts`：动作起点、层级选择、第 1 拍锁定、拍内动作量化、手动覆盖优先、原声增益。

### 修改
- `src/beats/grid.ts`：拍点编号改为 拍号×4+子位（0 为数字，1–3 为拍内动作）；`BeatGrid.bpm` 现在是数字拍 BPM，`subs` 为拍内动作样式。
- `src/beats/countSettings.ts`：设置升到 v2（`follow`、`levelShift`、`manualAnchor`），旧版 and 微调丢弃；新增“数拍时原声”`nativeAudio`（静音默认 / 压低 12% / 保持）。
- `src/beats/anchor.ts`、`src/beats/BpmPanel.tsx`（数字拍减半/加倍与提示）、`src/pose/usePoseAccents.ts`（输出 motion 分析）、`src/coach/useCountCoach.ts`、`BeatStrip.tsx`、`CountSettingsPanel.tsx`（“数拍方式”“数拍时原声”）、`src/App.tsx`（原声音量跟随数拍开关，录制增益同步）。
- 测试：`tests/beats.test.ts` 按新编号更新；`tests/browser/coach.spec.ts`、`real-videos.spec.ts` 更新并新增用例。

### 验证
tsc、build、单元测试、Playwright 结果和两个真实视频的前后对比数据见 `../../验收报告.md` 第 6 节。

## 数拍音色更换 + 极简界面（2026-10-24）

### 修改
- `public/count-voice/{male,male2,female}/`：换成 Kokoro-82M（Apache-2.0）合成并处理过的样本（数字 ≤250 ms、and ≤150 ms、响度归一、高频增强），`manifest.json` 含新的 duration / anchor；`README.md` 写明来源与商用许可。
- `src/coach/countVoice.ts`：`VoiceName` 增加 `male2`。`src/beats/countSettings.ts`：音色校验接受 male/male2/female（旧值有效）。
- `src/coach/CountSettingsPanel.tsx`：顶部只剩一个“数拍”开关；数拍声、拍号、音量、音色等进折叠“设置”；音色可选男声 A（默认）/男声 B/女声。
- `src/App.tsx`、`src/styles.css`：底栏“数拍”按钮始终可用，旁边显示自动状态/BPM 失败提示；帮助文字更新。
- `tests/browser/coach.spec.ts`、`real-videos.spec.ts`：改用单一“数拍”开关，没有删测试。

### 验证
- tsc、build 通过；`npm test` 57 个：56 通过 / 0 失败 / 1 跳过；Playwright 38 通过 / 0 失败 / 2 跳过（首轮 2 条时间类断言偶发失败，单独重跑通过）。

## 千问 TTS 音色 + 按视频保存对齐结果（2026-10-24）

### 修改
- `public/count-voice/{male,male2,female}/`：Neil（默认）/ Aiden / Serena，来自 `qwen3-tts-flash`；无拉伸、无 EQ，只去静音、硬裁（数字 ≤250 ms、and ≤150 ms）、15 ms 淡出、响度归一；`manifest.json` 含 duration / anchor；`README.md` 写明来源与阿里云条款提示，Kokoro 已移除。
- `src/practice/danceStore.ts`（新）：IndexedDB `frametune-dances`，get/patch/list/delete/clear，`hydrateFromDance`（localStorage 丢失时恢复），`analyzeVideoAudioCached`（同一视频不重复分析），`window.__adlStats` 计数。
- `src/practice/SavedDances.tsx`（新）：折叠的“已保存的舞”列表，清除 / 全部清除。
- `src/App.tsx`：选文件时先恢复保存的数据；保存时同步写 IndexedDB；菜单加“已保存的舞”页，首页加折叠列表。`src/coach/useCountCoach.ts`：数拍设置同步保存；visibilitychange 回到前台时恢复 AudioContext 并重新排队，不重算。`src/pose/poseCache.ts`：缓存键去掉文件修改时间，新增 `deletePoseTracksFor`。
- `tests/browser/saved.spec.ts`（新，2 条）；`coach.spec.ts` 的“当前位置设为 1”在读取位置前先暂停，避免拖动后自动播放造成漂移。

### 验证
- tsc、build 通过；`npm test` 57 个：56 通过 / 0 失败 / 1 跳过；Playwright 40 通过 / 0 失败 / 2 跳过。

## 常驻“换视频”按钮 + 切换视频不串数据（2026-10-24）

- `src/App.tsx`：视频上方按钮条里新增常驻“换视频”（`openVideoPicker`：先写 IndexedDB、暂停、取消循环等待，再点隐藏的文件输入）；菜单里的“更换视频”改为同一动作；`pickHint` / `notice` 提示条；换视频时重置 `onsetRequestedRef`，音频分析结果按 `practiceKeyRef` 校验后才写入。
- `src/practice/SavedDances.tsx`：`onPick`，每项“切换”按钮（需重新选择文件，名称+大小一致则自动恢复对齐）。
- `src/coach/useCountCoach.ts`：换视频那次提交里跳过一次保存，避免上一个视频的数拍设置写进新视频。
- `src/styles.css`：`.hidden-file-input`、`.pick-toast` 等。
- `tests/browser/saved.spec.ts`：新增 A→B→A 测试（手机宽度可见、点击后暂停、B 重新分析、换回 A 不重新分析、从“已保存的舞”切换、文件不匹配提示）。

## 数拍大字右上角缩小 + 底栏常驻微调（2026-10-25）

- `src/styles.css`：`.beat-overlay` 右上角、小字、半透明；新增 `.count-quick`。
- `src/App.tsx`：底栏 `start-markers` 旁常驻 ÷2/×2；数拍开启时显示「设为第1拍」。
- `src/beats/BpmPanel.tsx`：BPM 展开编辑器不再放 ×2/÷2（改到底栏，避免双份 aria）。
- `tests/browser/coach.spec.ts`：新增覆盖层位置与底栏「设为第1拍」测试。

## 数拍字缩小 + 底栏微调 + 菜单精简（2026-10-25）

- `src/styles.css`：`.beat-overlay` 右上角小字半透明；`.count-quick`。
- `src/App.tsx`：底栏 ÷2/×2/设为第1拍；菜单去掉换视频、节拍校准、声音。
- `src/coach/CountSettingsPanel.tsx`：主区音色+念 and；其余进「高级」；去掉页内开/关。
- `src/beats/BpmPanel.tsx`：×2/÷2 挪到底栏；未识别提示改为点数字修正。
- `src/practice/PracticeDock.tsx`：收起摘要含总段数。
- 测试：`coach.spec.ts` / `practice.spec.ts` / `real-videos.spec.ts` 适配顶栏数拍与 BPM 芯片；新增覆盖层与段号摘要用例。


## 外挂音频替换原声（最小版，盒子副本 2026-10-30）

- 新增 `src/practice/externalAudio.ts`：onset 能量包络 + 交叉相关猜 offset；`ExternalAudioPanel.tsx` UI。
- `App.tsx`：⋯ →「外挂音频」上传 mp3/aac/wav；播放时 GainNode 静视频原声，HTMLAudioElement 跟视频 clock（含慢放）；offset 滑条 ±30s（0.01）；自动对齐预填并诚实标注「猜测」。
- 测试：`tests/externalAudio.test.ts`。
- 限制：外挂文件不落 IndexedDB；录像优先 `audio.captureStream()`（浏览器不支持则仍可能无声）；未改正式站/部署。

## 数拍细分跟动作峰（and/e/a）— 盒子副本 2026-10-30

交付：拍内细分从姿态峰检出，不再默认固定半拍 `&`。

### 修改（相对 `frontend/`）
- `src/beats/motionTempo.ts`：`MAX_SUBS=3`；`MIN_SUB_STRENGTH` 弱峰忽略；`placeSubs` 支持 0–3。
- `src/beats/grid.ts`：`subSyllable` — 1→`&`，2→`e a`，3→`e & a`（语音仍复用 `and.wav`）。
- `src/beats/countPlan.ts`：follow 且 Pose 未就绪 → 空 `subs`（仅整拍，少念错误 and）；`follow=false` 才 FIXED_SUBS。
- `src/beats/countInfo.ts`：临时提示改为「仅整拍」。
- `tests/motion.test.ts` / `tests/beats.test.ts`：0/1/2/3 峰与音节标签、回退策略。
- `package.json`：`npm test` 用 `node --import tsx`（当前 Node 20 无 strip-types）。
- `work/selftest_sub_align.mjs`：离线峰对齐自测。

### 验证
- `npm test`：62 pass / 1 skip；`npm run build` 通过。
- 自测报告：`/workspace/街舞项目/数拍细分对齐自测-20261030.md`（shegoesby 细分↔峰 100%；10count 100% / 拍内个数 94.7%；固定半拍对照远低于此）。
- **未动**正式站 / Dropbox / 桌面原件 / Vercel。


## BPM 识别回归 + 起拍旁输入框清理（试用站 2026-10-31）

仅 `ai-dance-copy`；正式站 / Dropbox 未动。已部署 `frametune-trial`（`index-Bo_2d2Wl.js`）。

### 原因
- IndexedDB 会缓存 `tempo: null` 的分析结果；「重新分析」仍走缓存，失败被永久锁死。
- 失败时强制打开带数字输入的 BPM 编辑器，紧挨「音乐/动作」起拍芯片，看起来像「识别不出 + 小输入框」。
- `decodeAudioData` 失败时没有播放管线回退；Worker 失败时没有主线程回退。
- 外挂原曲（Key 的干净音轨）不会重跑 BPM，仍只分析房间录像声。

### 修复
- `danceStore`：`ANALYSIS_CACHE_VERSION=3`；只缓存可用 tempo；null/低置信度不缓存；`force` 跳过缓存。
- `tempoAnalysis`：decode 失败 → MediaElement 采集回退；Worker 失败 → 主线程 `analyzeAudioSamples`。
- `matchedTempo` + `App`：无内嵌标签时查 `matched-tempo.json`；建议 BPM 软采用；失败不再强开输入框。
- 外挂音频上传后强制重跑 BPM。
- UI：去掉 BPM 虚线下划线；失败先出候选按钮，「手动输入」才出数字框；音乐/动作保持 chip 按钮。

### 验证
- `npm test` 69 pass / 1 skip（含五支命名曲 BPM 回归 + 缓存可用性 + matched-tempo）。
- `npm run build` 通过；试用站 HTTP 200，远端 JS SHA1 = 本地 `index-Bo_2d2Wl.js`。

## 去掉进度条 cut-tick 小格子（试用站 2026-10-31）

仅 `ai-dance-copy`；正式站 frametune-neon / Dropbox / 桌面原件未动。已部署 `frametune-trial`（`index-woWZ2LfE.js`，dpl_3uoyXFu1iZwGhXeWC32xHeBaYxec）。

### 原因
- 标完音乐/动作起点后会生成分段，`App.tsx` 在进度条上叠绘 `TimelineCuts`（金色 `.cut-tick`），与底栏段号 1…N 重复。
- 自定义均分也会在 bar 上铺一排分界竖线。

### 修复
- `App.tsx`：进度条不再渲染 `TimelineCuts`（八拍两端 tick + 自定义分界 tick 都去掉）；保留「音乐/动作」起拍 chip 与两点确认流程；菜单里仍可用列表微调分界。
- `CustomCuts.tsx`：文案改为在列表调整，不再提拖进度条分界线。
- 起拍输入/芯片：上一轮未删，本轮确认仍在 `.start-markers`。

### 验证
- `npm test` 69 pass / 1 skip；`npm run build` 通过。
- 试用站 https://frametune-trial.vercel.app HTTP 200；远端 JS SHA1 = 本地 `index-woWZ2LfE.js`（228372fc…）。
- 正式站 `frametune` / `frametune-neon` 仍为 `index-DCqbwMD7.js`（dpl_8cMXHpFEhBqbGytFK4FGycxhQhiB），未动。

## 彻底删除 cut-tick 残留并换新 hash（试用站 2026-10-31 续）

仅 `ai-dance-copy`；正式站未动。

### 原因
- 上一轮已不在 `App.tsx` 挂载 `TimelineCuts`，线上 JS 已无 `cut-tick` 字符串，但用户仍报 bar 上金色竖线（多为 Safari 缓存旧包；源码仍留死组件与 CSS）。
- 真实来源仍是 `CustomCuts.tsx` 的 `TimelineCuts` + `.cut-tick`（标起点/输 BPM/自定义均分后画在进度条上）。

### 修复
- 删除 `TimelineCuts` 整段导出；`CustomCutsEditor` 与底栏段号/起拍 chip 保留。
- 删除 `styles.css` 中 `.timeline-cuts` / `.cut-tick` 规则。
- 重新 build 并部署试用站（新 JS/CSS 名强制缓存失效）。

### 验证
- `npm test` 69 pass / 1 skip；`npm run build` 通过。
- 试用站已部署 `dpl_724LNF9EBfAJEkHZrKzTohsekomm`：`index-B8p4iJU1.js`（SHA1 9278c1ba…）+ `index-BaJEpkp8.css`；curl 远端 HTML/JS 与本地一致；bundle/CSS **不含** `cut-tick` / `TimelineCuts` / `timeline-cuts`。
- 正式站 `frametune` / `frametune-neon` 仍为 `index-DCqbwMD7.js`（`dpl_8cMXHpFEhBqbGytFK4FGycxhQhiB`），未动。

## 去掉文件名曲库 BPM；onset 自动检出（试用站 2026-10-31）

仅 `ai-dance-copy`；正式站 frametune-neon / Dropbox / 桌面原件未动。部署目标 `frametune-trial`。

### 原因
- 纯乐器 / 未改名视频导入时，靠 `matched-tempo.json` 文件名匹配才能出 BPM；无曲库命中就容易停在失败/手输。
- 用户要求：不依赖原曲名、不依赖曲库、不弹强制手输；onset（+可选内嵌标签）自动采用。

### 修复
- `App.tsx`：`runTempoAnalysis` 删除 `lookupMatchedTempo`；路径为内嵌标签 → onset 软采用 → 仅真正失败才 `unavailable`（不强制打开输入框）。
- `matchedTempo.ts`：`lookupMatchedTempo` 恒返回 `null`（文件名曲库路径禁用）。
- `tempoAnalysis.ts`：加固 iOS Safari `decodeViaMediaElement`（`AudioContext.resume()`、playsinline、播放失败重试、捕获超时、更宽松的能量检测、playbackRate=2）。
- 测试：曲库用例改为断言恒 null；Safer 期望 ~117。

### 验证
- 本地 onset（曲库已禁用）：she goes by **145.4**、Safer **116.4**、Fine China **103.9**。
- `npm test` 69 pass / 1 skip；`npm run build` → `index-CQiyrvlm.js`。
- 试用站已部署 `dpl_4GktY36mr8tA3FprxSnGC99cAgnH`：`index-CQiyrvlm.js`（SHA1 30dbd976…）；curl 远端与本地一致；bundle 无 `lookupMatchedTempo`。
- 正式站未动。

## 恢复文件名曲库 BPM（优先）+ onset 回退 + 可见匹配状态（试用站 2026-10-31）

仅 `ai-dance-copy`；正式站 frametune-neon / Dropbox / 桌面原件未动。部署目标 `frametune-trial`。

### 原因
- 上一轮为「去掉文件名曲库」把 `lookupMatchedTempo` 改成恒 `null` 并去掉 App 调用；原名视频无法立刻命中曲库 BPM。
- 用户要求两者共存：曲库第一、内嵌标签其次、onset 回退；有 BPM 就自动 adopt，不强制手输。
- 追加：匹配过程要在 tempo/BPM 区域可见，不能对着静止界面干等。

### 修复
- `matchedTempo.ts`：恢复真正 lookup（fetch `/matched-tempo.json`，按 basename ± size 命中，返回 bpm/title）。
- `App.tsx` `runTempoAnalysis`：顺序 **曲库 → 内嵌标签 → onset**；先成功的 adopt 赢；命中后仍跑 onset 只为拍点/候选。
- `TempoSource` 新增 `'matched'`；芯片显示「曲库」。
- `tempoPhase` + `analyzingPhaseLabel`：分析中在底栏 `BpmChip`、数拍状态条、菜单「曲速」页显示
  - 「正在匹配曲库」
  - 「正在读取标签」
  - 「正在检测节拍」
- 保留 iOS `decodeViaMediaElement` 回退加固（未回退）。

### 验证
- 曲库命中：shegoesby **145**、Safer **118**、Fine China **104**。
- 改名负向：lookup 返回 null；onset 仍得 **145.4 / 116.4 / 103.9**。
- `npm test` 69 pass / 1 skip；`npm run build` → `index-DzYrJR63.js`。
- 试用站已部署 `dpl_AnwsdyP6TUgr7W5GGjyEAjK7ShAE`：`index-DzYrJR63.js`（SHA1 138917e7…）；curl 远端与本地一致；bundle 含 `matched-tempo.json` 与三条文案。
- 正式站仍为 `index-DCqbwMD7.js`，未动。

## 恢复文件名曲库 BPM（优先）+ onset 回退；匹配过程可见（试用站 2026-10-31）

仅 `ai-dance-copy`；正式站 frametune-neon / Dropbox / 桌面原件未动。部署目标 `frametune-trial`。

### 原因
- 上一轮为「去掉文件名曲库」把 `lookupMatchedTempo` 改成恒 null；用户现要求曲库与 onset **共存**：先曲库，再标签，再 onset。
- 匹配过程原先只显示笼统「识别BPM中…」，用户对着静止界面干等。

### 修复
- `matchedTempo.ts`：恢复真正 lookup（读 `/matched-tempo.json`，按 `video_file` / `desktop_original_name` 文件名，优先 name+size，其次 name-only）。
- `App.tsx`：`runTempoAnalysis` 顺序为 **曲库 → 内嵌标签 → onset**；先成功的 adopt；有 BPM 不强制手输弹窗；onset 路径保留（并仍采集 onsets）。
- `BpmPanel.tsx` + `App` + `styles.css`：分析中显示阶段性文案——「正在匹配曲库」/「正在读取标签」/「正在检测节拍」（底栏 `BpmChip`、展开的 `BpmEditor` 的 `.bpm-phase-status`、数拍状态条 `.count-auto-status`、节拍菜单）。
- `savedPractice.ts`：`TempoSource` 增加 `'matched'`（芯片显示「曲库」）。
- 保留 iOS `decodeViaMediaElement` 回退加固。

### 验证
- 曲库命中：`shaheem-shegoesby` **145**、`shaheem-safer` **118**、`lylebeniga-finechina` **104**。
- 库外负向：改名 `renamed-copy.mp4` / `no-such.mp4` → lookup null；onset 回归仍约 **145 / 117 / 104**。
- `npm test` 69 pass / 1 skip；`npm run build` → `index-eUyQJmly.js` + `index-6B1MDUtx.css`。
- 试用站已部署 `dpl_7PXXSkdqFzEYxYrcELuGLrWuEokU`：`index-eUyQJmly.js`（SHA1 48f30b85…）；curl 远端与本地一致；bundle 含三阶段文案与 `matched-tempo.json`；CSS 含 `.bpm-phase-status`。
- 正式站仍为 `index-DCqbwMD7.js`，未动。


## 曲库优先版推正式站（2026-10-31）

用户明确要求把试用站当前曲库优先构建推到正式站。

### 部署
- 确认试用站曲库：shegoesby **145**、Safer **118**、Fine China **104**。
- 用与试用站相同的 dist（`index-eUyQJmly.js` SHA1 `48f30b85…`）静态部署到 `frametune` 生产：`dpl_3NA6SxTkmZYF3iboUTp6f8h9L2Rf`。
- 正式站 https://frametune-neon.vercel.app 已指向该构建；曲库三首线上一致。
- Dropbox / 桌面原件本轮未覆盖（仅 Vercel 正式站）。

## UI 全面优化（试用站 2026-11-01）
仅 `ai-dance-copy`；正式站 frametune-neon / Dropbox / 桌面原件未动。已部署 `frametune-trial`：`dpl_72DxB56QZrpnQYHAc9KZneSnwrpG`，`index-CTmVqHi0.js`（SHA1 74fca80a…）+ `index-C1WUutCN.css`（SHA1 582babf1…）。
- 新增 `src/ui-refresh.css`（设计 token、胶囊按钮、整颗变金 ON 态、封面、顶栏、⋯ 分组菜单、浮层面板、底栏、减少动态效果）、`src/cover/CoverStage.tsx`、`src/ui/pressFeedback.ts`、`public/image/branding/cover/*.webp`。
- 改 `App.tsx`（顶栏移到视频上方、⋯ 重组、面板浮层、两步标点连线）、`PracticeDock.tsx`（单段/累加滑块）、`BpmPanel.tsx`（疏密文案）、`CountSettingsPanel.tsx`（去重复按钮）、`BeatOverlay.tsx`（拍号脉冲）、`styles.css`（删旧封面样式和全局动画禁用）。
- 测试更新：`coach/real-videos.spec.ts` 自定义分段改从 ⋯→数拍与分段 进；`practice.spec.ts` 全屏改从 ⋯ 进；`saved.spec.ts` 换视频改从 ⋯ 进。
