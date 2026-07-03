# Codex Prompt Log

Record development prompts here when needed.

## 2026-07-03 — Phase 1: video upload and basic player

- Goal: Let a Windows local-web user select and play a dance video with practical learning controls.
- Scope delivered: Browser-local Object URL loading; MP4/MOV/WebM validation; file metadata; playback, pause, timeline, time, volume, mute, fullscreen, fixed speeds, mirror, ±2-second seeking, keyboard shortcuts, and local setting persistence.
- Restrictions observed: No FFmpeg, transcoding, backend video storage, audio or beat analysis, eight-count logic, formal choreography start logic, AI, database, authentication, cloud deployment, or large UI framework.
- Test result: A real 5.055-second MP4 loaded and played. Playback/pause, four speeds, source preservation, mirror, safe seeking, keyboard shortcuts, local persistence, frontend production build, backend health, and browser console checks passed.
- Not tested: MOV and WebM playback because matching test files were unavailable.
- Known issues: Browser codec support can vary, especially for MOV files. Unsupported codecs produce the player error message and require a browser-compatible file. Video files intentionally do not persist across page refresh in Phase 1. The requested Git commit could not be created in the current managed environment because `.git/index.lock` remained write-protected after explicit permission requests.

## 2026-07-03 — Phase 1.1: portrait cover dragging and fullscreen safety

- Goal: Let users freely inspect any part of a portrait video in cover mode while guaranteeing fullscreen opens with the complete frame.
- Scope delivered: Pointer dragging, cover-overflow boundary calculation, persistent portrait pan, recenter control, portrait-only fullscreen contain override, and automatic restoration after fullscreen exit.
- Restrictions observed: No body-part buttons, tracking, MediaPipe, music analysis, beat or eight-count logic, choreography-start logic, FFmpeg, backend media storage, or new UI framework.
- Test result: Real 720×1280 portrait and 960×540 landscape MP4 layouts were used. Dragging, boundary clamping, no-overflow recentering, speed/mirror/time preservation, reset, persistence, landscape cover regression, production build, and console checks passed.
- Manual verification: Automated fullscreen entry is restricted by the browser test surface, so portrait contain-on-entry and cover/pan restoration-on-exit require user validation in the normal local browser.
- Known issues: The downloaded portrait test media exposed metadata correctly but its codec was not playable in the automated browser; this did not prevent layout and drag verification.

## 2026-07-03 — Phase 2A: manual eight-count practice

- Goal: Build a reliable, manually calibrated eight-count learning workflow before any automatic music analysis.
- Scope delivered: BPM validation, music-one calibration, integer/half-beat timeline, user-confirmed choreography start snapping, learning segments, practice ranges, looping/count-in orchestration, four count modes, beat highlighting, local speech synthesis, and per-video persistence.
- Restrictions observed: No automatic BPM/beat detection, Librosa, Essentia, FFmpeg audio analysis, action recognition, automatic choreography-start judgment, AI service, backend media storage, database, or large UI framework.
- Test result: Timeline generation, half-beat snapping, calibration adjustments, segment generation including incomplete tail, range selection, integer/and highlighting, 0.5× state, storage isolation, production build, and pure-function assertions passed.
- Manual verification: The automation browser rejected Blob media playback even for a locally generated WebM, so actual loop timing, interval/count-in playback, manual-pause cancellation, speech audibility/synchronization, and playback-time highlighting at all speeds require local user testing.
- Known limitation: `speechSynthesis` scheduling is a prototype convenience and is not guaranteed sample-accurate; visible beat highlighting is authoritative.

## 2026-07-03 — Phase 2A.1: simplified practice UI and fullscreen controls

- Goal: Keep the video continuously visible, reduce the practice surface to frequent controls, and make fullscreen practice usable without leaving fullscreen.
- Scope delivered: Removed speech/counting/highlight runtime; added fixed two-second loop and current-segment continuous playback modes; sticky 60vh video; collapsible setup; compact segment/range controls; fullscreen progress/status and persistent collapsible left/right sidebar; Up/Down/L/F shortcuts.
- Restrictions observed: No Phase 2B, automatic BPM/beat analysis, FFmpeg, action recognition, AI, backend video storage, database, or new UI framework.
- Test result: TypeScript compilation and Vite production build passed. Source scan confirmed that speech, count-mode, count-in, beat-strip, and obsolete loop-interval code are absent from the frontend.
- Manual verification: The managed browser could not reach the local development listener, so real-video loop timing, continuous segment advance, shortcut behavior during playback, and fullscreen sidebar behavior require local user testing.
- Known issues: No product-code issue is known from compilation/static checks; fullscreen behavior remains subject to browser fullscreen permissions.

## 2026-07-03 — Phase 2A.1 Blocking Regression Fix

- Goal: Restore the proven Phase 1.1 playback, portrait contain/cover, bounded dragging, reset, and fullscreen restoration behavior without removing Phase 2A.1 learning controls.
- Root cause: The normal play button was conditional on generated learning segments; portrait pan was recovered from one global cross-video value; normal and fullscreen display/pan state were not separated clearly.
- Scope delivered: Always-visible normal playback controls; per-video pan persistence and metadata-time clamping; active contain/cover and object-position binding; restored pointer capture/drag bounds/reset; temporary fullscreen display/pan state; retained eight-count ranges, fixed two-second loop, continuous advance, and sidebar.
- Restrictions observed: No Phase 2B, automatic analysis, speech/count highlighting, backend, new dependency, or unrelated refactor. No Git commit created.
- Test result: TypeScript compilation and Vite production build passed. Static connection checks confirmed one video/ref, three playback buttons using the shared toggle, active object-fit/object-position bindings, pointer capture/release, reset wiring, 2000 ms loop, and continuous branch.
- Manual verification: Both the managed browser and local Chrome control could not reach the Windows development listener; browser policy also blocked a local static test page. Real horizontal/portrait playback, drag visuals, loop/continuous playback, fullscreen restoration, and console checks therefore require user verification and are not reported as passed.

## Template

- Date:
- Phase:
- Prompt summary:
- Result:
