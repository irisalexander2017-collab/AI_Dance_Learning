# Codex Prompt Log

Record development prompts here when needed.

## 2026-07-03 — Phase 1: video upload and basic player

- Goal: Let a Windows local-web user select and play a dance video with practical learning controls.
- Scope delivered: Browser-local Object URL loading; MP4/MOV/WebM validation; file metadata; playback, pause, timeline, time, volume, mute, fullscreen, fixed speeds, mirror, ±2-second seeking, keyboard shortcuts, and local setting persistence.
- Restrictions observed: No FFmpeg, transcoding, backend video storage, audio or beat analysis, eight-count logic, formal choreography start logic, AI, database, authentication, cloud deployment, or large UI framework.
- Test result: A real 5.055-second MP4 loaded and played. Playback/pause, four speeds, source preservation, mirror, safe seeking, keyboard shortcuts, local persistence, frontend production build, backend health, and browser console checks passed.
- Not tested: MOV and WebM playback because matching test files were unavailable.
- Known issues: Browser codec support can vary, especially for MOV files. Unsupported codecs produce the player error message and require a browser-compatible file. Video files intentionally do not persist across page refresh in Phase 1. The requested Git commit could not be created in the current managed environment because `.git/index.lock` remained write-protected after explicit permission requests.

## Template

- Date:
- Phase:
- Prompt summary:
- Result:
