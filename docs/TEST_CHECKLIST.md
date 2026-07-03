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
