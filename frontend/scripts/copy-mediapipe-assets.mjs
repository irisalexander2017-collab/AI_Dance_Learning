// Copies the self-hosted MediaPipe runtime (wasm + classic bundle) from node_modules into public/mediapipe.
// Runs automatically before dev/build/preview/browser tests. Generated files are git-ignored.
import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', '@mediapipe', 'tasks-vision')
const target = join(root, 'public', 'mediapipe')
if (!existsSync(source)) { console.warn('[mediapipe] @mediapipe/tasks-vision is not installed; run npm install.'); process.exit(0) }
mkdirSync(join(target, 'wasm'), { recursive: true })
cpSync(join(source, 'vision_bundle.js'), join(target, 'vision_bundle.js'))
for (const name of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  cpSync(join(source, 'wasm', name), join(target, 'wasm', name))
}
console.log('[mediapipe] runtime copied to public/mediapipe')
