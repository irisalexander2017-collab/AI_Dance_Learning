# BPM节奏误判修复 Implementation Plan

> **For agentic workers:** This is one tightly coupled debugging task; execute inline using test-driven-development and systematic-debugging, then request an independent code review.

**Goal:** 修复 shaheem-shegoesby.mp4 被识别为48.7 BPM的问题，不牺牲其他已验证速度和错误处理。

**Architecture:** 保留本地FFT/Worker流程、40–240 BPM范围和现有返回接口。验证多频段证据，避免低频重复支配候选；分片一致性不能靠丢弃失败片段后仅剩一个结果冒充。

**Tech Stack:** TypeScript、浏览器Web Audio、Node测试、Playwright/Chrome。

**Spec:** 用户本轮“你修啊”；此前只读诊断：网页两次48.7，独立音轨主候选约146–147，原曲公开参考146。

## Global Constraints

- 不以文件名、歌曲名或固定乘数选择BPM；不上传媒体、不加服务或运行时依赖。
- 不改录像、摄像头、声音、下载、字体颜色和部署配置；不提交、push、部署。
- 保护现有未提交工作；修复前快照在 frontend/.test-artifacts/before-ambiguity-fix.zip。
- 未能可靠区分时宁可提示无法识别，不把模糊估计伪装成确定结果。

## Task 1: 修复并验收

Files: frontend/src/practice/tempoAnalysis.ts；frontend/tests/practice.test.ts；frontend/tests/browser/practice.spec.ts；当前状态、BPM测试记录、开发与经验记录。

Interface: estimateTempo(samples: Float32Array, sampleRate: number): TempoEstimate | null 保持不变。

- [x] 添加低频每三拍重复、其他频段每拍重复的合成测试；字面期望132/146/178，容差2 BPM。
- [x] 添加本机真实视频测试，BPM_REGRESSION_VIDEO指定文件，字面参考146；网页旧Fine China参考104仍保留。
- [x] 在原算法上运行新测试，确认因48.7/低频循环误判失败，而非环境错误。
- [x] 在内存中核对频段证据假设，然后最小修改候选和有效片段判断。
- [x] 所有逻辑测试通过；真实视频不再输出48.7，参考误差小于2；静音、噪声、混合速度与原速度范围仍通过。
- [x] 独立只读代码审查，处理重要问题。
- [x] 根路径和GitHub Pages生产模式分别运行完整真实Chrome回归，覆盖中英文小屏及录像声音下载。
- [x] 更新当前事实、测试与误判经验；检查部署配置无差异，开发服务器继续运行。

## Progress

已完成。31项逻辑测试、两种生产路径各25项网页回归通过，均无跳过。She goes by首次/再次导入147.3，Fine China103.9；独立审查无阻挡问题；开发页面HTTP200。唯一下一动作：交付本地修复，请用户刷新并重新导入视频。未提交或部署。
