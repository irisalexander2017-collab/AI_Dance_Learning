import { analyzeAudioSamples } from '../beats/audioAnalysis.ts'

self.onmessage = (event: MessageEvent<{ samples: Float32Array; full: Float32Array; sampleRate: number }>) => {
  self.postMessage(analyzeAudioSamples(event.data.samples, event.data.full, event.data.sampleRate))
}
