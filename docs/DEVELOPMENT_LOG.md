# Development Log

## 2026-07-03 — Phase 0

- Established the React, TypeScript, and Vite frontend skeleton.
- Established the FastAPI backend with a health endpoint.
- Added Windows startup scripts and baseline project documentation.
- Phase 0 completed.
- Local Git commit created successfully: `ec44868 MVP-00: project setup`.

## 2026-07-03 — Phase 1

- Added browser-local MP4, MOV, and WebM file selection with clear file metadata and load errors.
- Added a large desktop-first video player with timeline seeking, time display, volume, mute, and fullscreen controls.
- Added 0.5×, 0.65×, 0.8×, and 1× playback speeds without reloading the media.
- Added horizontal mirror mode, safe two-second rewind/forward controls, and keyboard shortcuts.
- Persisted playback speed, mirror state, and volume in browser local storage.
- Verified the player with a real MP4 sample; MOV and WebM were not tested because no test files were available.
- Verified the existing backend health endpoint remained unchanged and healthy.

## 2026-07-03 — Phase 1.1

- Added automatic landscape, portrait, and square detection from video metadata.
- Added persisted `完整画面` (`contain`) and `放大填充` (`cover`) display modes.
- Added free mouse dragging for portrait video in cover mode, with persisted position and bounded movement.
- Added `重置画面` to recenter the portrait crop without reloading or changing playback settings.
- Portrait fullscreen now uses an effective contain override while preserving the user's normal-page mode and pan position for restoration after exit.
- Landscape videos retain their existing contain/cover behavior, including the selected mode in fullscreen.
- Verified real portrait dragging, boundary clamping, reset, state preservation, persistence, landscape cover behavior, production build, and clean browser console output.
- Fullscreen entry/exit restoration requires user manual verification because the automated browser restricts fullscreen control.

## 2026-07-03 — Phase 2A

- Added manual BPM input and a real-second beat timeline containing integer beats and half-beat `and` points.
- Added manual music-one marking with half-beat and full-beat calibration controls.
- Added user-confirmed formal choreography start marking, nearest integer/half-beat snapping, delta display, and confirmation.
- Added continuous eight-beat learning segments with incomplete-final-segment labeling; media remains one original file.
- Added current, previous-plus-current, from-formal-start, and full-video practice ranges.
- Added loop settings, four-beat visual/voice count-in, integer/half/prep-only/off count modes, and an in-player beat strip.
- Added browser-local English speech synthesis through an isolated hook; screen timing remains authoritative.
- Added per-video practice persistence keyed by file name, size, and last-modified time.
- Pure timeline assertions and browser interaction tests passed. Automated media playback, loop timing, speech audibility, and fullscreen beat-strip visibility require user verification because the automation browser rejected Blob media playback/fullscreen.

## 2026-07-03 — Phase 2A.1

- Removed Web Speech API integration, all count modes, count-in scheduling, and beat-strip highlighting, including the now-unused speech hook.
- Replaced configurable loop/count orchestration with two explicit modes: fixed two-second loop and continuous current-segment advance.
- Added cancellation of pending loop restarts on manual pause, range changes, segment changes, video replacement, and playback-mode changes.
- Kept the video visible in a sticky approximately 60vh practice area; collapsed low-frequency beat setup automatically after formal-start confirmation.
- Added a custom fullscreen root containing video, progress, compact status, and a collapsible left/right sidebar whose side is persisted locally.
- Added Up/Down segment navigation, L playback-mode switching, and F fullscreen switching while preserving input-field shortcut guards.
- Frontend production build passed. Local browser automation could not connect to the development listener, so media/fullscreen behavior requires user manual verification.

## 2026-07-03 — Phase 2A.1 Blocking Regression Fix

- Restored an always-visible normal-page playback row independent of whether learning segments have already been generated.
- Kept one real video element and one video ref; normal-page, practice-panel, fullscreen-sidebar, Space, and media events use the same playback state and toggle handler.
- Replaced the cross-video global portrait pan recovery with per-video pan persistence. New videos default to center; restored values are clamped after metadata loads.
- Reconnected `contain`/`cover` to the active video class and `object-position` to the active normal/fullscreen pan state.
- Restored pointer capture, cover-overflow boundary calculation, pan persistence, and context-aware reset without reloading or changing playback settings.
- Added temporary fullscreen display/pan state: portrait enters with contain, landscape retains its selected mode, and exiting restores normal-page mode/pan automatically.
- Preserved learning-segment generation, manual BPM/beat setup, four practice ranges, fixed two-second loop, continuous next-segment behavior, compact layout, and fullscreen sidebar.
- Production build passed. The managed browser could not access the local listener and blocked the local static test page, so real-media normal-page and fullscreen verification remains manual.

## 2026-07-05 — MVP-07 release-readiness pass

- Completed the FrameTune / 帧琢 bilingual landing page, practice workspace, settings drawer, fullscreen sidebar, status messages, errors, accessibility labels, and help text without adding a localization dependency.
- Expanded the bilingual How It Works guide to cover local video use, manual beat setup, practice ranges, playback controls, camera privacy, camera shutdown, and teacher Fit/zoom/reset/drag behavior.
- Added camera comparison with a local mirrored self-view and clean MediaStream shutdown; camera frames are not uploaded or recorded.
- Added independent single-view and camera-split teacher framing with 1.00×–3.00× zoom and bounded two-axis dragging in normal and fullscreen layouts.
- Confirmed the user-facing application is frontend-only; the Phase 0 FastAPI health endpoint is not used by current frontend features.
- Added GitHub Pages deployment for the `AI_Dance_Learning` repository subpath and verified the production asset paths locally.
- TypeScript and Vite production build passed. Real camera hardware, fullscreen, and media interaction regression tests remain manual where browser automation is restricted.

## 2026-07-13 — MVP-08 local practice recording

- Added user-initiated local recording for the teacher-and-learner split view, with a 3, 5, or 10 second countdown and recording from the selected practice-range start.
- Added local review at 0.5×, 0.75×, or 1×, WebM download, deletion, and record-again actions.
- Practice recording uses the teacher-video audio when the browser exposes a capturable audio track. It does not request or record microphone or room audio.
- Recordings are generated in browser memory and are not uploaded or automatically saved; only the user-triggered WebM download creates a file.
- TypeScript and production builds passed during MVP-08 development. Iris personally used the recording flow and confirmed it works normally.
- This confirmation is not a full browser/device compatibility test. Other browsers, operating systems, camera devices, codecs, and mobile behavior remain unverified unless tested separately.
