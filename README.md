# 帧琢 FrameTune

FrameTune is a browser-local dance-practice tool for breaking choreography into focused sections, slowing and looping playback, mirroring the teacher, comparing against a live self-view, reframing the teacher video, and recording a local split-screen practice review.

The current public test version is frontend-only. Selected dance videos, camera frames, and generated practice recordings remain on the user's device and are not uploaded. Recording is started only by the user, includes the teacher-video audio when the browser supports it, and does not capture microphone or room audio. A recording can be reviewed, downloaded as WebM, or deleted locally.

## Requirements

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
