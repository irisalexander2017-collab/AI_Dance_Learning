# 自动BPM识别测试记录

日期：2026-10-11
范围：本地工作分支 `codex/mobile-practice-controls`；未提交、push或部署。

最新完整网页回归与连续起点设置修复见 [练习设置测试记录](PRACTICE_SETUP_TEST_REPORT.md)。下面保留BPM修复时的测试事实。

## 用户样本误判修复（BPM验收）

- 用户反馈的 shaheem-shegoesby.mp4 在独立Chrome中连续两次输出48.7 BPM。独立全频/中频起音分析主候选约146.7 BPM；同名原曲公开参考146：[SongBPM](https://songbpm.com/%40wheretat/she-goes-by-qha2o)。参考不是文件身份或全曲库准确率证明。
- 低频权重0.65过高，三拍低音重复压过其他频段主拍；两个候选接近同分仍被接受；两片段只剩一片有效时仍被当作稳定结果。
- 平衡归一化频段、先排除低支持候选、拒绝近同分非二倍关系候选；失败的有声音片段保留在一致性分母，静音片头仍可排除。不按文件名或固定乘数识别。
- 新增三种已知132/146/178 BPM低音循环、真实失败视频、模糊候选和片段支持不足共六项逻辑回归。先观察六项失败，再修复；31项全部通过，无跳过。
- 根路径与GitHub Pages各25项真实Chrome生产网页回归全部通过，无跳过。She goes by首次与再次导入均为147.3 BPM（对146参考误差1.3，小于2）；Fine China复测103.9 BPM（对104参考误差0.1）。两种路径结果一致。
- 独立只读审查无Critical/Important问题。手机尺寸截图也已检查，BPM直接显示在原底栏，无新增按钮或遮挡。
- 本轮下载录像含1280×720 VP9与Opus，178560个音频采样，平均约−25.0 dB、峰值−4.2 dB；音轨确有声音。摄像头仍是Chrome测试摄像头。
- 仅改节拍算法、回归测试及直接相关记录；本轮未改其他产品功能或部署配置，未提交、push、部署。原视频未进入Git。

## 前一轮验收（保留历史证据）

- 25项Node测试通过：40/50/80/100/120/150/190/220/240 BPM节拍，含旋律与细分节拍的92/128/172 BPM音频，长静音片头，静音、持续单音、三个随机种子的白噪声及不同速度片段拒绝，以及原有范围、手势、保存逻辑。
- 根路径和GitHub Pages子路径生产页面各24项真实Chrome网页测试全部通过，无跳过项。
- 真实本机舞蹈视频 `lylebeniga-finechina.mp4` 自动得到103.8 BPM，对照音乐制作方标注的104 BPM，误差0.2 BPM；测试要求误差小于2 BPM。参考：[Tency Music的Fine China作品页面](https://www.tencymusic.com/music-licensing/chris-brown/fine-china.html)。这是一个真实音乐样本的核对，不是全曲库准确率。
- 网页覆盖旧默认100重新识别、同速度保留自定义分界、输入草稿不被异步覆盖、未确认草稿不覆盖已确认模式/选段、解码挂起20秒后恢复、手动确认、分析取消、未知BPM不生成假100分段。
- 回归覆盖320×568、390×844、844×390、1280×800，中英文、无横向溢出、固定底栏、单段/累加、音乐与动作标记、自定义分界、变速、循环、全屏、摄像头、录像、回看、下载、删除、再录取消。
- 录像测试使用Chrome测试摄像头。根路径生产回归下载的WebM含1280×720 VP9视频和Opus音轨，音轨平均约−25.0 dB、峰值−4.4 dB，确有声音。
- 真实视频网页请求检查未发现上传，未发现JavaScript异常。节拍分析不连接外部服务。
- 独立只读审查发现的噪声误判、保存值/分界丢失、超时范围及草稿状态问题已补回归并修复。

## 实现与边界

导入后自动读取视频声音，在完整音轨上分布选择最多5个24秒片段（最多分析120秒），不只听片头。通过分频声音变化提取起音，检查重复节奏和多个片段是否一致，识别范围40–240 BPM。持续单音、无声和没有稳定节拍的噪声不冒充成功结果。

方法参考频谱变化与起音自相关的常用原则，未引入或移植librosa库：[起音文档](https://librosa.org/doc/0.11.0/generated/librosa.onset.onset_strength.html)、[速度估算文档](https://librosa.org/doc/0.11.0/generated/librosa.feature.tempo.html)。内部confidence是算法评分，不是经过统计验证的准确率百分比。

视频至少需要约8秒、可由浏览器解码的声音；文件上限150 MiB。读取、解码和计算共享20秒等待限制，取消或超时后应用停止等待、关闭分析音频环境并终止Worker。浏览器原生解码内部不能由应用强制中断，长视频/大文件仍可能消耗较多内存。

识别失败会显示原因或重试入口，不展示默认100为识别结果，也不据此自动分段。手动校准是备用操作，明确确认后才保存；已有手动选择不被自动覆盖。已保存的自动结果会在重新导入时重分析。

音乐和动作起点仍由用户标记。八拍分段按固定BPM计算，不自动识别舞蹈动作、第1拍/第8拍或变速歌曲的每个拍点。复杂音乐仍可能出现快慢一倍误判，允许校准和自定义分界。

手机尺寸和触摸在真实桌面Chrome中模拟；不等于所有实体手机、Safari及真实摄像头硬件已验证。

## 复现

在 `frontend` 运行：

这次完整测试在同一测试终端设置两个本机样本，避免真实样本项跳过：

```powershell
$env:REAL_DANCE_VIDEO = Join-Path $env:USERPROFILE 'Desktop\视频跳舞\dance videos\lylebeniga-finechina.mp4'
$env:REAL_EXPECTED_BPM = '104'
$env:BPM_REGRESSION_VIDEO = Join-Path $env:USERPROFILE 'Desktop\视频跳舞\dance videos\shaheem-shegoesby.mp4'
```

```powershell
npm.cmd test
npm.cmd run test:fixtures
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

另一个终端设置 `TEST_BASE_URL=http://127.0.0.1:4173/`，再运行网页测试。子路径预览必须使用与构建一致的模式：

```powershell
npm.cmd run test:browser
npm.cmd run build -- --mode github-pages
npm.cmd run preview -- --mode github-pages --host 127.0.0.1 --port 4174 --strictPort
```

测试依赖已安装Chrome；生成媒体需要FFmpeg或设置 `FFMPEG_PATH`。
生产预览测试通过 `TEST_BASE_URL` 指向根路径或 `/AI_Dance_Learning/` 子路径。
首次子路径预览漏传模式参数，脚本请求返回HTML；核对响应类型后用正确模式启动，最终24项全部通过，未改部署配置。
真实样本测试设置 `REAL_DANCE_VIDEO` 为本机文件，`REAL_EXPECTED_BPM=104`；不设置则该项跳过。
新增失败样本由 `BPM_REGRESSION_VIDEO` 指定，不设置则逻辑和网页对应项跳过。31/31与25/25结果均设置了全部样本参数；逻辑真实音轨测试同样需要FFmpeg或正确的 `FFMPEG_PATH`。
