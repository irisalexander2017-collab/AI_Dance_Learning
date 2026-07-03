$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Frontend = Join-Path $Root "frontend"

Push-Location $Frontend
try {
    if (-not (Test-Path "node_modules")) {
        npm.cmd install
    }
    npm.cmd run dev
}
finally {
    Pop-Location
}
