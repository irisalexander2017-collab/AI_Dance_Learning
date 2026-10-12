# Mobile practice implementation plan

> Execute inline in this task; verify behavior and real browser flows before handoff.

Goal: keep video visible with a fixed, collapsible dock, separate section numbers, timeline start marking, pinch framing and local tempo analysis.

Architecture: retain video/camera/recording; extract dock and audio analysis modules; keep per-video settings compatible.

Tech stack: React, TypeScript, Vite, browser audio APIs. No cloud upload or paid API.

Spec: Iris's approved proposal in this task.

## Acceptance

- Preserve fonts, palette, camera, recording/audio, review, download and both build modes.
- Dock stays in viewport in portrait, landscape and fullscreen while video zooms independently.
- Single selects N only; cumulative selects 1 through N. Selecting never collapses the dock.
- Setup timeline offers Music start and Dance start; choosing confirms the current position.
- Local analysis has loading/cancellation/calibration and never overwrites user calibration.
- Pinch/drag never toggle playback; taps do.

## Tasks

- [x] Add behavior tests for tempo, ranges and gestures; initial run exposed seven failures, including non-monotonic boundary offsets.
- [x] Implement local audio analysis; verify tempos, silence, decoding and cancellation.
- [x] Implement dock, menu, markers and gestures; retain recorder pipeline.
- [x] Run builds and real browser regression; debug, update project records. Detailed results are in ../../MOBILE_PRACTICE_TEST_REPORT.md.

## Verification

Node tests use hand-derived ranges and synthesized beats. Browser checks at 390x844, 844x390 and desktop cover both languages, viewport bounds, selection, seeking, persistence, fullscreen, camera, countdown, recording/audio, review, download and deletion. Separate synthetic fixtures from real music/hardware evidence.

Current: implementation and verification complete from baseline 76fdf7f; 10 logic tests pass, both root-path and GitHub Pages production pages pass all 17 browser tests. Independent review's four important findings were fixed and have browser regressions. Fonts and palette retained; real camera hardware/mobile browser compatibility is not implied. No required implementation remains. No commit/push/deployment. Next: Iris can experience the running local page; repository integration requires separate authorization.
