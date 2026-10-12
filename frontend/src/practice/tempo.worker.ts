import { estimateTempo } from './tempoAnalysis'

self.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  self.postMessage(estimateTempo(event.data.samples, event.data.sampleRate))
}
