# Build and run DSC Engine locally (Debug).
# From repo root:  npm run dsc:dev
# Or directly:    powershell -ExecutionPolicy Bypass -File certificate-worker\scripts\run-dsc-dev.ps1

param(
    [string]$Configuration = "Debug"
)

$ErrorActionPreference = "Stop"

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\Yesgatc.DscEngine")).Path
$exePath = Join-Path $projectDir "bin\$Configuration\net8.0-windows\DscEngine.exe"

$running = Get-Process -Name "DscEngine" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Closing running DSC Engine..." -ForegroundColor Yellow
    $running | Stop-Process -Force
    Start-Sleep -Seconds 1
}

Push-Location $projectDir
try {
    Write-Host "Building DSC Engine ($Configuration)..." -ForegroundColor Cyan
    dotnet build -c $Configuration
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    if (-not (Test-Path $exePath)) {
        throw "Build succeeded but exe was not found: $exePath"
    }

    Write-Host "Starting DSC Engine. Close the window to stop." -ForegroundColor Green
    & $exePath
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
