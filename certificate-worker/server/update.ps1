# Update an existing server install (preserves appsettings.local.json and all data under %LOCALAPPDATA%\YesGATC\CertificateWorker).
#
# Example:
#   powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\update.ps1 `
#     -SourcePath C:\YesGATC\updates\latest

param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,
    [string]$InstallPath = "C:\YesGATC\CertificateWorker",
    [switch]$SkipPlaywright,
    [switch]$Start
)

$ErrorActionPreference = "Stop"

$SourcePath = (Resolve-Path $SourcePath).Path
$exeName = "Yesgatc.CertificateWorker.exe"
$processName = [System.IO.Path]::GetFileNameWithoutExtension($exeName)

if (-not (Test-Path (Join-Path $SourcePath $exeName))) {
    throw "SourcePath does not contain $exeName."
}

Write-Host "Stopping Certificate Worker if running..." -ForegroundColor Cyan
Get-Process -Name $processName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null

$localConfig = Join-Path $InstallPath "appsettings.local.json"
$localConfigBackup = Join-Path $env:TEMP "yesgatc-appsettings.local.json.bak"
$hadLocalConfig = Test-Path $localConfig

if ($hadLocalConfig) {
    Copy-Item $localConfig $localConfigBackup -Force
    Write-Host "Backed up appsettings.local.json" -ForegroundColor DarkGray
}

Write-Host "Copying program files to $InstallPath ..." -ForegroundColor Cyan
robocopy $SourcePath $InstallPath /MIR /XF appsettings.local.json /NFL /NDL /NJH /NJS /NC /NS | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "Robocopy failed with exit code $LASTEXITCODE"
}

if ($hadLocalConfig) {
    Copy-Item $localConfigBackup $localConfig -Force
    Remove-Item $localConfigBackup -Force -ErrorAction SilentlyContinue
    Write-Host "Restored appsettings.local.json" -ForegroundColor DarkGray
}

if (-not $SkipPlaywright) {
    $playwrightScript = Join-Path $InstallPath "playwright.ps1"
    if (Test-Path $playwrightScript) {
        Write-Host "Ensuring Playwright Chromium is installed (may take a minute on first run)..." -ForegroundColor Cyan
        Push-Location $InstallPath
        try {
            & powershell -ExecutionPolicy Bypass -File $playwrightScript install chromium
        }
        finally {
            Pop-Location
        }
    }
}

$updateDest = Join-Path $InstallPath "update.ps1"
if ($PSCommandPath -ne $updateDest) {
    Copy-Item $PSCommandPath $updateDest -Force -ErrorAction SilentlyContinue
}

$pullUpdateSrc = Join-Path $SourcePath "pull-update.ps1"
if (Test-Path $pullUpdateSrc) {
    Copy-Item $pullUpdateSrc (Join-Path $InstallPath "pull-update.ps1") -Force
}

$versionFile = Join-Path $InstallPath "version.txt"
if (Test-Path $versionFile) {
    Write-Host ""
    Write-Host "--- version.txt ---" -ForegroundColor DarkGray
    Get-Content $versionFile | Write-Host
    Write-Host "-------------------" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Update complete." -ForegroundColor Green

if ($Start) {
    $exePath = Join-Path $InstallPath $exeName
    Start-Process $exePath -WorkingDirectory $InstallPath
    Write-Host "Started $exeName" -ForegroundColor Green
}
