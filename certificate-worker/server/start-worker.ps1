# Starts YesGATC Certificate Worker if it is not already running.
param(
    [string]$InstallPath = "C:\YesGATC\CertificateWorker"
)

$ErrorActionPreference = "Stop"

$processName = "Yesgatc.CertificateWorker"
$exePath = Join-Path $InstallPath "$processName.exe"

if (-not (Test-Path $exePath)) {
    Write-Error "Worker not found at $exePath"
    exit 1
}

$running = Get-Process -Name $processName -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "$processName already running (PID $($running.Id))."
    exit 0
}

Start-Process $exePath -WorkingDirectory $InstallPath
Write-Host "Started $processName."
