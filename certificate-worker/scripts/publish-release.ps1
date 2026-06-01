# Builds a release folder you can copy to the Windows Server.
# Usage (from repo root or certificate-worker folder):
#   powershell -ExecutionPolicy Bypass -File certificate-worker\scripts\publish-release.ps1
#   powershell -ExecutionPolicy Bypass -File certificate-worker\scripts\publish-release.ps1 -SelfContained

param(
    [switch]$SelfContained,
    [string]$Runtime = "win-x64",
    [string]$Configuration = "Release",
    [switch]$KeepWorkerRunning
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Stop-CertificateWorkerIfRunning {
    $processes = Get-Process -Name "Yesgatc.CertificateWorker" -ErrorAction SilentlyContinue
    if (-not $processes) {
        return
    }

    if ($KeepWorkerRunning) {
        throw "Yesgatc.CertificateWorker is running. Close it first, or rerun without -KeepWorkerRunning."
    }

    Write-Host "Stopping Yesgatc.CertificateWorker (file lock release)..." -ForegroundColor Yellow
    $processes | Stop-Process -Force
    Start-Sleep -Seconds 2
}

function New-ZipFromDirectory {
    param(
        [string]$SourceDirectory,
        [string]$DestinationZip
    )

    $destinationDirectory = Split-Path -Parent $DestinationZip
    if (-not [string]::IsNullOrWhiteSpace($destinationDirectory)) {
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }

    if (Test-Path $DestinationZip) {
        Remove-Item $DestinationZip -Force
    }

    $tempZip = "$DestinationZip.part"
    if (Test-Path $tempZip) {
        Remove-Item $tempZip -Force
    }

    [System.IO.Compression.ZipFile]::CreateFromDirectory($SourceDirectory, $tempZip)
    Move-Item $tempZip $DestinationZip -Force
}

function Sync-PublishDirectory {
    param(
        [string]$SourceDirectory,
        [string]$DestinationDirectory
    )

    New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
    robocopy $SourceDirectory $DestinationDirectory /MIR /NFL /NDL /NJH /NJS /NC /NS | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "Could not sync publish folder (robocopy exit code $LASTEXITCODE). Close Certificate Worker and retry."
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Join-Path $scriptDir "..\Yesgatc.CertificateWorker"
$publishRoot = Join-Path $scriptDir "..\publish"
$publishDir = Join-Path $publishRoot $Runtime
$stagingDir = Join-Path $env:TEMP "yesgatc-publish-$Runtime-$(Get-Date -Format 'yyyyMMddHHmmss')"

Write-Host "Publishing Certificate Worker ($Configuration, $Runtime)..." -ForegroundColor Cyan

Stop-CertificateWorkerIfRunning

if (Test-Path $stagingDir) {
    Remove-Item $stagingDir -Recurse -Force
}

$publishArgs = @(
    "publish", $projectDir,
    "-c", $Configuration,
    "-r", $Runtime,
    "-o", $stagingDir,
    "/p:PublishSingleFile=false",
    "/p:DebugType=none",
    "/p:DebugSymbols=false"
)

if ($SelfContained) {
    $publishArgs += @("--self-contained", "true")
    Write-Host "Mode: self-contained (no .NET runtime needed on server, larger download)" -ForegroundColor Yellow
}
else {
    $publishArgs += @("--self-contained", "false")
    Write-Host "Mode: framework-dependent (install .NET 8 Desktop Runtime x64 on the server once)" -ForegroundColor Yellow
}

dotnet @publishArgs

$playwrightScript = Join-Path $stagingDir "playwright.ps1"
if (-not (Test-Path $playwrightScript)) {
    throw "Publish succeeded but playwright.ps1 was not found in $stagingDir"
}

$gitSha = "unknown"
try {
    $gitSha = (git -C (Join-Path $scriptDir "..") rev-parse --short HEAD 2>$null)
    if (-not $gitSha) { $gitSha = "unknown" }
}
catch {
    $gitSha = "unknown"
}

$versionText = @(
    "YesGATC Certificate Worker"
    "Published: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')"
    "Git: $gitSha"
    "Configuration: $Configuration"
    "Runtime: $Runtime"
    "SelfContained: $($SelfContained.IsPresent)"
) -join "`n"

Set-Content -Path (Join-Path $stagingDir "version.txt") -Value $versionText -Encoding UTF8

$serverDir = Join-Path $scriptDir "..\server"
foreach ($serverFile in @("pull-update.ps1", "update.ps1", "install.ps1", "README-SERVER.md")) {
    $serverFilePath = Join-Path $serverDir $serverFile
    if (Test-Path $serverFilePath) {
        Copy-Item $serverFilePath $stagingDir -Force
    }
}

$zipPath = Join-Path $publishRoot "Yesgatc.CertificateWorker-$Runtime.zip"
Write-Host "Creating zip..." -ForegroundColor Cyan
New-ZipFromDirectory -SourceDirectory $stagingDir -DestinationZip $zipPath

Write-Host "Syncing publish folder..." -ForegroundColor Cyan
Sync-PublishDirectory -SourceDirectory $stagingDir -DestinationDirectory $publishDir

Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Folder: $publishDir"
Write-Host "  Zip:    $zipPath"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  GitHub Release: push tag certificate-worker-v1.0.0 (or run Actions > Release Certificate Worker)"
Write-Host "  Server update:  pull-update.ps1 -Start"
Write-Host "  Manual copy:    server\install.ps1 / server\update.ps1 -SourcePath <unzipped-folder>"
