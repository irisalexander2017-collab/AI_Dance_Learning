# AI Dance Learning

Turn dance videos into simple 8-count practice sessions.

This repository currently contains the Phase 0 local development skeleton: a React + TypeScript + Vite frontend and a FastAPI backend health endpoint.

## Requirements

- Windows PowerShell
- Node.js with npm
- Python 3.12 or newer

## Start locally

From the project root, open two PowerShell windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\start_backend.ps1
```

```powershell
powershell -ExecutionPolicy Bypass -File .\start_frontend.ps1
```

Or start both in separate hidden PowerShell processes:

```powershell
powershell -ExecutionPolicy Bypass -File .\start_all.ps1
```

Open http://127.0.0.1:5173. The API health endpoint is http://127.0.0.1:8000/health.
