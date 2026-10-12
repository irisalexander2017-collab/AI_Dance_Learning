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

## 2026-07-14 — Practice workflow simplification

- Reorganized the normal page around preparation and reduced fullscreen controls to speed, previous/next section, practice range, play/pause, and exit fullscreen.
- Unified teacher-view controls as Mirror, Zoom out, Zoom in, Reset, and Fullscreen. Reset restores the full view, default zoom, and centered position.
- Added click-to-play/pause on the teacher video with a movement threshold so dragging a zoomed view does not toggle playback.
- Made section 1 automatically include the calculated preparation lead-in and removed the separate preparation-range mode.
- Kept previous/next navigation independent from the selected practice-range mode and replaced large range buttons with one compact selector.
- Added explicit confirmation for both music start and dance start. Optional custom sections are collapsed by default; users choose one boundary, move the main video timeline, and confirm the current position. Saved overrides feed playback and recording ranges.
- Removed the full-dance practice-range option and compacted the teacher toolbar against the video edge with short, fixed-size Chinese/English controls.
- Updated Chinese and English guidance. Default and GitHub Pages production builds pass; browser interaction, camera, recording, audio, and download regression remain pending because the browser runner could not reach the Windows local listener.
- Fixed a real-browser visibility regression where the collapsed Custom sections button existed in source and the DOM but its flex item shrank to about 2 px and clipped the 42 px button. The entry now keeps its height and appears after Music and dance starts, before Practice sections.
- Process correction: source inspection and successful builds do not prove that a control is visible or usable. UI completion must report real-browser verification separately; if it has not run, the result must remain explicitly marked unverified before Iris is asked to validate it.
- Verified the fix in Iris's live Chrome page in both Chinese and English: the collapsed entry remained about 44 px high, appeared in the intended order, expanded to show its controls, collapsed without disappearing, and left the drawer scrollable. The page was restored to Chinese with the entry collapsed after testing.

## 2026-10-11 — Mobile-first practice controls

- Replaced the large settings drawer and duplicated controls with a fixed bottom dock and compact menu. Section numbers are separate from the timeline and can be folded manually.
- Added Single / Build-up selection: N only or 1 through N, with preparation included for section 1. Playback once stops at the selected range; repeat retains the two-second rest.
- Added timeline Music start / Dance start actions that confirm the selected position without forcing it to a guessed beat. Both markers generate eight-beat sections.
- Added browser-local tempo estimation, worker processing, cancellation, confidence fallback and manual calibration. No runtime service, paid API or upload was introduced.
- Added multi-pointer zoom/drag with tap suppression, preserving independent teacher framing in single and camera comparison.
- Preserved the recording pipeline and added visible errors/audio fallback notices; recording review safely exits fullscreen.
- Independent review found and fixed manual-tempo overwrite on reimport, stale custom-menu range bypass, stale boundary selection after changing BPM and hidden recording errors. Also fixed non-monotonic boundary offsets and cancelled stale loop timers during calibration.
- Added unit and installed-Chrome browser regression tests, generated-media fixtures and bilingual instructions. Compatible security patches updated PostCSS, nanoid and source-map-js; npm audit reports zero vulnerabilities.
- Verification details are in MOBILE_PRACTICE_TEST_REPORT.md. No commit, push or deployment in this task.

## 2026-10-11 — Automatic BPM recognition improvement

- Replaced the basic low-frequency energy estimator with multi-band spectral-flux onset analysis, centered autocorrelation, harmonic/interval checks and cross-window agreement. Distributed audio sampling now covers the track rather than only the first90 seconds; range is40–240 BPM.
- Fixed old default100/marker settings skipping detection, invalid saved manual BPM becoming a false100, noise false positives and integer-frame half-tempo bias.
- Exposed automatic/manual/unrecognized status in the existing compact dock; only detected or confirmed BPM generates sections. Manual input cancels analysis immediately, while unconfirmed drafts preserve the previous confirmed mode and section.
- Added a shared20-second deadline and cancellation across reading, decoding and Worker computation; compatible same-tempo reanalysis preserves custom boundaries.
- Expanded known-tempo and real-Chrome tests; real Fine China audio measured103.8 against a104 reference. Current verification and limits are recorded in BPM_AUTO_TEST_REPORT.md. No runtime dependency, cloud upload, deployment configuration change, commit, push or deployment was added.

## 2026-10-11 — User-reported three-beat BPM misidentification

- Reproduced shaheem-shegoesby.mp4 at48.7 BPM twice in real Chrome; independent full/mid-band audio analysis supported approximately146–147.
- Balanced normalized spectral bands so a repeating bass motif cannot dominate; rejected nearly tied non-octave candidates and counted failed audible windows in agreement checks while still allowing silent introductions.
- Added six failure-first logic regressions and a real-Chrome first/repeat-import test. All31 logic tests and each production path's25 browser tests passed with both real samples enabled.
- Real She goes by now returns147.3; Fine China remains103.9. Reviewed the mobile screenshot and confirmed downloaded recording includes audible teacher audio. Independent read-only review found no blocking issues.
- No filename special case, fixed BPM multiplier, runtime dependency, external upload, other product UI/recording change, deployment configuration change, commit, push or deployment.

## 2026-10-11 — Continuous Music/Dance setup

- Reproduced premature setup exit in real Chrome when a saved Dance start was mistaken for confirmation in the current session.
- Added a session-only Music→Dance step, reset on entry without clearing saved markers. Music confirmation stays in setup; valid Dance confirmation finishes it. Added short bilingual next-step guidance and renamed the manual exit action to Exit setup.
- Three new failure-first browser cases cover restored markers in both languages and invalid Dance starts with recovery. Read-only review confirmed scope and added preservation assertions.
- One original calibration persistence test raced page reload against the save effect; added observable manual-mode and saved-value assertions, not fixed sleeps or product BPM changes. Final root and GitHub Pages regressions each pass28 tests; all31 logic tests and both builds pass. Downloaded recording retains audible teacher audio.
- Updated current instructions and recorded evidence in PRACTICE_SETUP_TEST_REPORT.md. No style, BPM algorithm, custom-section, recording, dependency or deployment configuration change; no commit, push or deployment. Dev server remains running.

## 2026-10-12 — Vercel release of verified practice updates

- Iris authorized deployment. Product commit43d5826 was pushed normally to master and the existing Vercel Git integration deployed it to production; no configuration change, Alibaba Cloud deployment or choreography-counting feature.
- Fresh31 logic tests,28 local production browser tests and28 Vercel production browser tests passed with no skips. Both build modes passed; npm audit reported0 vulnerabilities. Read-only release review found no blocking issues.
- Privacy browser tests now allow only static same-origin GET resources rather than hard-coding localhost, so production checks still reject API/upload/cross-origin requests. Two real-video tests passed after this test-only adjustment.
- Downloaded online recording has1280×720 VP9 and audible Opus audio. Online JS/CSS/Worker SHA256 match the tested local build. Details are in RELEASE_STATUS.md; current records and moved-project startup path were synchronized.
