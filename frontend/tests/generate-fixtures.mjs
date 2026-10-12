import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
mkdirSync('.test-artifacts', { recursive: true })
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
for (const [name, size, audio, duration = 24] of [
  ['practice-100bpm.mp4', '320x480', 'aevalsrc=0.7*sin(2*PI*110*t)*exp(-mod(t\\,0.6)/0.016):s=22050:d=24'],
  ['practice-silent.mp4', '640x360', 'anullsrc=r=22050:cl=mono'],
  ['practice-late-128bpm.mp4', '160x90', 'aevalsrc=if(gte(t\\,96)\\,0.7*sin(2*PI*110*(t-96))*exp(-mod(t-96\\,0.46875)/0.016)\\,0):s=22050:d=126', 126],
]) {
  const result = spawnSync(ffmpeg, ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size='+size+':rate=15','-f','lavfi','-i',audio,'-t',String(duration),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','.test-artifacts/'+name], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error('Fixture generation failed. Install FFmpeg or set FFMPEG_PATH.')
}
