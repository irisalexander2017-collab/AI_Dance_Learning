# 数拍声音 / Count voice samples

Folders: `male/` (default, Qwen3-TTS-Flash voice **Neil**), `male2/` (**Aiden**), `female/` (**Serena**).
Each holds 9 clips (`one` … `eight`, `and`), 24 kHz mono 16-bit WAV. `manifest.json` stores `duration` and `anchor`
(seconds from clip start to the perceived onset; the scheduler starts a clip `anchor` early so the hit lands on the beat).

## How they were made
* Generated offline (build time only) with **Alibaba Cloud Model Studio Qwen3-TTS-Flash** (`qwen3-tts-flash`,
  DashScope non-real-time multimodal-generation API, Beijing endpoint `dashscope.aliyuncs.com`), `language_type=English`,
  one request per word ("One." … "Eight." and "And."). Only the resulting audio clips are shipped;
  no API key, no network call and no TTS at run time.
* Post-processing (no time-stretching, no EQ boost, no reverb): 80 Hz high-pass, silence trimmed at the start, the clip ends at the
  first quiet gap (drops the click Qwen files end with), hard cut to 250 ms (numbers) / 150 ms ("and"), 2 ms fade-in and 15 ms
  fade-out, loudness normalised (numbers -17 dBFS RMS, "and" -25 dBFS RMS). Words are never sped up or slowed down, so pitch and
  word length are the natural ones; at slow-motion speeds the app only lengthens the gaps between clips, never the clips.
  `anchor` is the time to 50 % of the word's peak envelope (capped at 0.11 s).

## Licence / terms (please check before commercial release)
* The audio is output of Alibaba Cloud's Qwen-TTS service, generated under the project owner's own Model Studio account.
  **Commercial use and redistribution of generated audio is governed by the Alibaba Cloud Model Studio / Qwen-TTS service terms.
  Verify them before shipping this app commercially.** We have not obtained a legal opinion.
* The previous Kokoro-82M (Apache-2.0) clips were removed from the app in this update (users heard a reverb-like quality). They are
  not shipped any more. Earlier Piper-based clips were removed before that.
* Piper voices lessac / ryan / hfc_* (non-commercial) and amy / kusal / danny (unclear) were never shipped.
