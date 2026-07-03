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
