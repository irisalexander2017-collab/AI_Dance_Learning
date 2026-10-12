# 手机练舞改版测试记录

日期：2026-10-11
范围：当前工作分支 `codex/mobile-practice-controls`，基线 `76fdf7f`。

本记录保留界面改版时的验收事实；后续自动BPM改进见 [自动BPM测试记录](BPM_AUTO_TEST_REPORT.md)，最新完整回归见 [连续设置测试记录](PRACTICE_SETUP_TEST_REPORT.md)。

## 已取得的证据

- 10项Node逻辑测试通过：选段范围、分界顺序、80/100/120/150 BPM合成节拍、无声拒绝、双指与拖动、旧设置迁移。
- 开发版16项真实Chrome网页测试通过：320×568、390×844、844×390、1280×800，中英文操作、底栏边界、无横向溢出、变速、单段/累加、收起/展开、恢复设置。
- 网页回归覆盖音乐/动作标记、自定义分界、非法分界、单段循环、全屏、摄像头、倒计时取消、录制、回看、下载、删除、错误提示、分析取消和存储被禁用。
- 用本机真实舞蹈视频完成导入、播放和节拍分析；请求检查未发现向外传输视频。该测试证明流程可用，不代表每首歌曲的BPM估算都准确。
- 自动录像测试使用Chrome提供的测试摄像头。下载的WebM经FFprobe检查有1280×720 VP9视频与Opus音轨；FFmpeg检测音轨确有非零声音（峰值约−4.4 dB）。
- 默认根路径与GitHub Pages子路径生产构建通过；两种生产页面分别运行同一套17项真实Chrome网页测试，均全部通过，含原生进度条点击、全屏录像回看、再录取消。最终产品代码在这两轮之间未修改。
- npm audit：0漏洞。界面检测仅提示原有Inter字体和旧封面装饰，按Iris要求保留字体与品牌，不扩展改版范围。

## 可复现命令

需要Node 22.18+、已安装Chrome；生成测试媒体另需FFmpeg在PATH中，或设置 `FFMPEG_PATH`。

```powershell
cd frontend
npm.cmd ci
npm.cmd test
npm.cmd run test:fixtures
npm.cmd run test:browser
npm.cmd run build
npm.cmd run build -- --mode github-pages
npm.cmd audit
```

真实舞蹈视频测试需设置 `REAL_DANCE_VIDEO` 为本机文件路径，否则该项跳过，不上传文件。
生产预览可通过 `TEST_BASE_URL` 指向根路径或GitHub Pages子路径，同一测试集可复用。

## 设备边界

手机尺寸和触摸事件在真实桌面Chrome中模拟；不等同于实体手机Safari/Chrome与真实摄像头硬件的完整兼容测试。MVP-08仍保留Iris此前亲测正常的事实，不写成全浏览器已验证。
