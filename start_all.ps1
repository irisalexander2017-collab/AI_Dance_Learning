$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $Root "start_backend.ps1")
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $Root "start_frontend.ps1")
Write-Host "Starting backend at http://127.0.0.1:8000 and frontend at http://127.0.0.1:5173"
