$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Venv = Join-Path $Root ".venv"

if (-not (Test-Path $Venv)) {
    python -m venv $Venv
}

$Python = Join-Path $Venv "Scripts\python.exe"
& $Python -m pip install -r (Join-Path $Root "backend\requirements.txt")
& $Python -m uvicorn app.main:app --app-dir (Join-Path $Root "backend") --host 127.0.0.1 --port 8000
