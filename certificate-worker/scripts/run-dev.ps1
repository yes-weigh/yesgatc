# Build and run Certificate Worker locally (Debug).
# From repo root:  npm run worker:dev
# Or directly:    powershell -ExecutionPolicy Bypass -File certificate-worker\scripts\run-dev.ps1

param(
    [string]$Configuration = "Debug"
)

$ErrorActionPreference = "Stop"

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\Yesgatc.CertificateWorker")).Path
$exePath = Join-Path $projectDir "bin\$Configuration\net8.0-windows\Yesgatc.CertificateWorker.exe"

$running = Get-Process -Name "Yesgatc.CertificateWorker" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Closing running Certificate Worker..." -ForegroundColor Yellow
    $running | Stop-Process -Force
    Start-Sleep -Seconds 1
}

$profileMarker = "YesGATC\CertificateWorker\doca-browser"
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$profileMarker*" } |
    ForEach-Object {
        Write-Host "Closing orphaned DOCA Chrome (pid $($_.ProcessId))..." -ForegroundColor Yellow
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Start-Sleep -Seconds 1

Push-Location $projectDir
try {
    if (-not (Test-Path (Join-Path $projectDir "tessdata\eng.traineddata"))) {
        Write-Host "Downloading OCR language data (one-time)..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Path (Join-Path $projectDir "tessdata") -Force | Out-Null
        Invoke-WebRequest -Uri "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata" `
            -OutFile (Join-Path $projectDir "tessdata\eng.traineddata")
    }

    Write-Host "Building ($Configuration)..." -ForegroundColor Cyan
    dotnet build -c $Configuration
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    if (-not (Test-Path $exePath)) {
        throw "Build succeeded but exe was not found: $exePath"
    }

    Write-Host "Starting Certificate Worker. Close the window to stop." -ForegroundColor Green
    & $exePath
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
