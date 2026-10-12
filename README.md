# 帧琢 FrameTune

FrameTune is a browser-local dance-practice tool for breaking choreography into focused sections, slowing and looping playback, mirroring the teacher, comparing against a live self-view, reframing the teacher video, and recording a local split-screen practice review.

The current public test version is frontend-only. Selected dance videos, camera frames, and generated practice recordings remain on the user's device and are not uploaded. Recording is started only by the user, includes the teacher-video audio when the browser supports it, and does not capture microphone or room audio. A recording can be reviewed, downloaded as WebM, or deleted locally.

## Requirements

Public test version: [FrameTune on Vercel](https://frametune-neon.vercel.app/). Release verification: [2026-10-12 release record](docs/RELEASE_STATUS.md).

- Windows PowerShell
- Node.js with npm
- Python 3.12 or newer only if you want to run the legacy Phase 0 health-check API

## Start locally

From the project root, start the frontend:

```powershell
powershell -ExecutionPolicy Bypass -File .\start_frontend.ps1
```

Open http://127.0.0.1:5173.

The current app does not require the backend to run.

## Practice workflow

The video stays above a fixed dock. Tap Speed for presets; Single + 3 practices section 3, while Build-up + 3 practices sections 1–3. The arrow folds or opens section numbers without hiding playback controls.

Importing a video automatically analyzes its audio locally for BPM (40–240). The dock shows the detected or manually confirmed tempo; failure never masquerades as a default 100 BPM. Menu → Practice setup: seek and confirm Music start, then seek to the first move and confirm Dance start without reopening the menu. Saved starts do not skip either step. Both markers plus a detected/confirmed BPM generate eight-beat sections. Beat calibration is a fallback; Custom sections are optional in the menu. Pinch to zoom and drag to move; desktop zoom/reset controls are in Menu → View. Recording remains local.

See [current status](docs/CURRENT_STATUS.md), [continuous setup evidence](docs/PRACTICE_SETUP_TEST_REPORT.md), [BPM accuracy and browser evidence](docs/BPM_AUTO_TEST_REPORT.md), and [earlier mobile test evidence](docs/MOBILE_PRACTICE_TEST_REPORT.md). Node 22.18+ is required for the test commands; Chrome and FFmpeg are needed for browser/media regression tests.

The FastAPI health endpoint is no longer required by the user-facing app. It can still be started separately for legacy development checks:

```powershell
powershell -ExecutionPolicy Bypass -File .\start_backend.ps1
```

## Production build

```powershell
cd frontend
npm.cmd ci
npm.cmd run build
```

The static build is written to `frontend/dist`. GitHub Pages deployment is handled by `.github/workflows/deploy-pages.yml`.
