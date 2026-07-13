# Test Checklist

## Phase 0

- [x] Backend starts without errors.
- [x] `GET /health` returns the expected JSON.
- [x] Frontend starts without errors.
- [x] Frontend displays `Frontend running`.
- [x] Frontend reports the real backend connection state.
- [x] Production frontend build succeeds.
- [x] Git commit is created.

## Phase 1

- [x] A real MP4 file can be selected, loaded, and played from a browser Object URL.
- [x] File name, file size, and video duration are displayed.
- [x] Play and pause work.
- [x] Timeline seeking and current/total time display work.
- [x] Volume and mute controls are available; volume persists after refresh.
- [x] Fullscreen control is available.
- [x] 0.5×, 0.65×, 0.8×, and 1× all set the active playback speed.
- [x] Speed changes preserve the video source and do not reload the video.
- [x] Mirror mode toggles without changing the video source or resetting progress.
- [x] Rewind and forward by two seconds work and clamp safely at media boundaries.
- [x] Space, Left, Right, and M keyboard shortcuts work.
- [x] Playback speed, mirror state, and volume persist after refresh and apply when a video is selected again.
- [x] Frontend production build succeeds.
- [x] Backend `GET /health` returns the expected response.
- [x] Browser console has no warnings or errors during the tested flow.
- [ ] MOV playback — not tested; no MOV test file was available.
- [ ] WebM playback — not tested; no WebM test file was available.
- [ ] Git commit `MVP-01: basic video player` is created.

## Phase 1.1

- [x] Landscape, portrait, and square orientation detection uses `videoWidth` and `videoHeight`.
- [x] Portrait cover mode supports smooth vertical mouse dragging.
- [x] Horizontal pan remains centered when the current portrait layout has no horizontal overflow.
- [x] Pan position is clamped to 0–100% so the media cannot be dragged outside its cover bounds.
- [x] Playback time remains unchanged after dragging and resetting the picture.
- [x] Speed changes preserve portrait pan position.
- [x] Mirror changes preserve portrait pan position.
- [x] `重置画面` restores 50% / 50% centering without changing time, speed, mirror, or source.
- [x] Display mode and portrait pan position persist after refresh and video reselection.
- [x] Recovered pan values are clamped and axes without cover overflow are recentered.
- [x] Landscape cover mode remains centered and unchanged by portrait-only dragging behavior.
- [x] Frontend production build succeeds.
- [x] Browser console has no warnings or errors in the final portrait and landscape test tabs.
- [ ] Portrait fullscreen automatically uses contain and shows the complete body — implementation complete; requires user manual verification because browser automation restricts fullscreen.
- [ ] Exiting portrait fullscreen restores the previous cover mode and pan position — implementation complete; requires user manual verification.
- [ ] Playback/pause during drag preservation — existing playback behavior is unchanged, but the downloaded portrait layout sample was not playable in the automated browser codec surface.

## Phase 2A

- [x] BPM accepts 40–240 and clearly rejects invalid values.
- [x] Manual BPM generates integer and half-beat points in real seconds.
- [x] Music-one marking uses the current video time.
- [x] Music-one half-beat and full-beat forward/back adjustments work without reloading media.
- [x] Formal choreography start marking is manual and snaps to the nearest integer beat or `and`.
- [x] Raw click-to-snap time delta is displayed.
- [x] Formal-start half-beat adjustment and confirmation work.
- [x] Continuous eight-beat learning segments are generated from the confirmed start.
- [x] An incomplete final segment is clearly labeled.
- [x] Current-segment selection seeks to the current segment start.
- [x] Previous-plus-current selection uses the previous start and current end.
- [x] From-formal-start selection uses the formal start and current end.
- [x] Full-video selection returns to original video time zero.
- [x] Integer beat strip highlights the current musical count.
- [x] Half-beat strip renders all eight `and` positions and highlights an `and` correctly.
- [x] Beat highlighting responds immediately to manual seeking.
- [x] Existing 0.5× speed state remains intact during timeline operations.
- [x] Integer, half, prep-only, and off modes are available.
- [x] Practice settings are isolated by file name, size, and lastModified.
- [x] Pure assertions pass for snapping, timeline length, eight-beat segments, combined range, and count-in labels.
- [x] Frontend production build succeeds.
- [ ] Current-segment playback and automatic loop — requires user testing because the automation browser rejected Blob playback.
- [ ] Loop intervals and repeated-trigger protection — implementation complete; requires real playback verification.
- [ ] Manual pause cancels loop continuation — implementation complete; requires real playback verification.
- [ ] Integer/half speech and prep-only speech audibility — requires user testing.
- [ ] Speech synchronization precision — prototype limitation; not sample-accurate.
- [ ] Fullscreen beat-strip visibility — requires user testing because browser automation restricts fullscreen.
- [ ] Landscape and portrait playback regression — layout retained; real playback requires user testing in the local browser.

## Phase 2A.1

- [x] Web Speech API hook and runtime are removed.
- [x] Integer/half/prep-only/off controls, count-in overlay, beat strip, and speech scheduling are removed.
- [x] Obsolete loop enable/interval state is removed.
- [x] Loop mode uses one fixed two-second pending restart and cancels it on relevant user/state changes.
- [x] Continuous mode advances only from the current-segment range and stops at the final segment or non-current ranges.
- [x] Beat setup is a compact collapsible `节拍与分段设置` section and collapses after formal-start confirmation.
- [x] Normal-page video stage remains approximately 60vh and sticky while controls scroll.
- [x] Segment list remains compact and horizontal.
- [x] Fullscreen root contains video, progress, status, and custom sidebar markup.
- [x] Fullscreen sidebar has collapsed essential controls and expanded ranges, speeds, mirror, display, reset, side-switch, and exit controls.
- [x] Sidebar left/right choice persists in local storage.
- [x] Portrait fullscreen retain its contain override; landscape fullscreen retains the selected display mode.
- [x] Space, Left, Right, M remain implemented; Up, Down, L, and F are added and ignored in editable/input controls.
- [x] Frontend production build succeeds.
- [x] Static source scan finds no removed speech/count/highlight runtime references in `frontend/src`.
- [ ] Real-video fixed two-second loop and manual-pause cancellation — requires user manual verification.
- [ ] Real-video continuous next-segment advance and final stop — requires user manual verification.
- [ ] Fullscreen sidebar expansion, left/right movement, controls, and exit — requires user manual verification because the managed browser could not reach the local listener.
- [ ] Browser console during real media/fullscreen interaction — requires user manual verification.

## Phase 2A.1 Blocking Regression Fix

- [x] Exactly one `<video>` element and one `videoRef` binding remain.
- [x] Normal-page play/pause is rendered before beat setup or learning-segment generation.
- [x] Normal-page, practice-panel, and fullscreen play buttons all call the same `togglePlayback()` handler.
- [x] Play/pause label state is driven by video `play` and `pause` events.
- [x] `contain`/`cover` is bound to the active video class without changing the source or current time.
- [x] Contain mode always forces centered `object-position`.
- [x] Portrait pan is stored per video; the obsolete cross-video pan key is no longer read.
- [x] Restored pan is clamped after video metadata loads, with axes that have no cover overflow recentered.
- [x] Pointer capture, pointer move, release, cover-overflow calculation, and 0–100% boundary clamping are connected to the real video.
- [x] Reset affects the active normal/fullscreen pan only and does not reload video or modify speed, mirror, or volume.
- [x] Portrait fullscreen initializes temporary display mode to contain; landscape initializes it from the normal selected mode.
- [x] Fullscreen display/pan changes do not overwrite normal-page display/pan, so exit restores the pre-fullscreen state.
- [x] Learning segments, range calculations, fixed 2000 ms loop, and continuous-mode branch remain present and unchanged in behavior.
- [x] Frontend TypeScript and production build succeed.
- [ ] Horizontal MP4 play/pause and contain/cover visual check — requires user verification because the managed browser could not access the Windows local app.
- [ ] Portrait MP4 play/pause, full-body contain, cover drag to upper body/feet, boundaries, and reset visual check — requires user verification for the same environment limitation.
- [ ] Speed/mirror preservation during real portrait playback — requires user verification.
- [ ] Fixed two-second loop and continuous next-segment behavior with real playback — requires user verification.
- [ ] Fullscreen sidebar controls and portrait contain/exit restoration — requires user manual verification.
- [ ] Browser console during real video/fullscreen use — requires user manual verification.

## MVP-07 bilingual public test release

- [x] Chinese and English modes cover the landing page, How It Works, upload state, practice controls, settings, setup, fullscreen controls, camera states, errors, and accessibility labels.
- [x] Selected language persists in localStorage and updates the document language.
- [x] How It Works documents video privacy, beat setup, ranges, playback, camera comparison, camera privacy/shutdown, and teacher zoom/pan.
- [x] Teacher Fit, zoom out, zoom value, zoom in, Reset, and drag entry points exist in normal settings and the fullscreen sidebar.
- [x] Camera comparison has visible on/off entry points in normal and fullscreen controls; learner mirror is independent of teacher mirror.
- [x] Production build uses `/AI_Dance_Learning/` and the brand artwork resolves through Vite `BASE_URL`.
- [x] TypeScript compilation, production build, and Git diff whitespace checks pass.
- [ ] Real portrait and landscape video regression with both languages — manual verification required.
- [ ] Real camera permission, mirrored self-view, repeated open/close, and camera-light shutdown — manual verification required.
- [ ] Fullscreen single/split zoom and pan, segment loop, continuous playback, speed, and mirror regression — manual verification required.

## MVP-08 local practice recording

- [x] User can start recording only after the local camera comparison is active.
- [x] The flow provides 3, 5, and 10 second countdown choices and supports cancel/stop.
- [x] The generated split-screen recording can be reviewed locally at 0.5×, 0.75×, and 1×.
- [x] The review can be downloaded as WebM, deleted, or replaced by another recording.
- [x] The implementation does not request microphone input or upload the recording.
- [x] TypeScript and production builds passed during MVP-08 development.
- [x] Iris personally used the MVP-08 recording flow and confirmed it works normally.
- [ ] Full compatibility across browsers, operating systems, camera devices, codecs, and mobile devices — not verified.
- [ ] Teacher-audio capture in every supported browser/device combination — not verified; the app can report a video-only recording when no capturable teacher-audio track is available.

## Practice workflow simplification

- [x] Teacher-view UI contains Mirror, Zoom out, Zoom in, Reset, and Fullscreen without the former Fit/Fill wording.
- [x] Fullscreen sidebar source contains only speed, previous, next, practice range, play/pause, and exit fullscreen.
- [x] Section 1 current-range calculation automatically includes the preparation lead-in.
- [x] Previous/next navigation does not change the selected practice-range mode.
- [x] Music start and dance start each require confirmation before sections are generated.
- [x] Boundary offsets are stored per video and feed the same learning segments used by playback and recording.
- [x] Full-dance is no longer offered as a practice-range option; older saved values safely fall back to current section.
- [x] Custom sections are collapsed by default and edit one selected boundary through the main video timeline and a confirmation action.
- [x] Music and dance start setup appears first in the preparation drawer with short Chinese/English instructions.
- [x] Teacher controls use fixed compact columns and short labels so English text stays inside its buttons.
- [x] Default production build and GitHub Pages production build pass.
- [x] Real-browser check: collapsed Custom sections entry remains visibly full-height between Music and dance starts and Practice sections in Chinese and English.
- [x] Real-browser check: Custom sections expands and collapses without hiding its entry or affecting drawer scrolling.
- [ ] For future UI changes, verify actual visibility, readable labels, clickability, and expanded/collapsed states in a real browser; DOM/source presence and build success alone are not acceptance evidence.
- [ ] Click versus drag behavior with a real video — browser runner could not reach the Windows local listener.
- [ ] Fullscreen controls, camera, recording, teacher audio, local review, WebM download, and deletion regression — requires real local browser verification.
