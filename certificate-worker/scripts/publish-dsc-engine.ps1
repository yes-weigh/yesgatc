# Zip DSC Engine for RC Windows PCs (copy, do not install on the VPS).
# Default: one self-contained exe (no .NET runtime install on the RC PC).
#   npm run dsc:publish
#   powershell -ExecutionPolicy Bypass -File certificate-worker\scripts\publish-dsc-engine.ps1
# Framework-dependent (needs .NET 8 Desktop Runtime x64):
#   powershell -ExecutionPolicy Bypass -File certificate-worker\scripts\publish-dsc-engine.ps1 -FrameworkDependent

param(
    [switch]$FrameworkDependent,
    [string]$Runtime = "win-x64",
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Stop-NamedProcessIfRunning {
    param([string]$ProcessName)
    $processes = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
    if ($processes) {
        Write-Host "Stopping $ProcessName..." -ForegroundColor Yellow
        $processes | Stop-Process -Force
        Start-Sleep -Seconds 1
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Join-Path $scriptDir "..\Yesgatc.DscEngine"
$publishRoot = Join-Path $scriptDir "..\publish"
$stagingDir = Join-Path $env:TEMP "yesgatc-publish-dsc-$Runtime-$(Get-Date -Format 'yyyyMMddHHmmss')"

Stop-NamedProcessIfRunning -ProcessName "DscEngine"

if (Test-Path $stagingDir) {
    Remove-Item $stagingDir -Recurse -Force
}

$selfContained = -not $FrameworkDependent
$publishArgs = @(
    "publish", $projectDir,
    "-c", $Configuration,
    "-r", $Runtime,
    "-o", $stagingDir,
    "/p:DebugType=none",
    "/p:DebugSymbols=false"
)

if ($selfContained) {
    $publishArgs += @(
        "--self-contained", "true",
        "/p:PublishSingleFile=true",
        "/p:IncludeNativeLibrariesForSelfExtract=true",
        "/p:IncludeAllContentForSelfExtract=true",
        "/p:EnableCompressionInSingleFile=true"
    )
    Write-Host "Mode: one self-contained exe (no .NET install on RC PC)" -ForegroundColor Yellow
}
else {
    $publishArgs += @("--self-contained", "false", "/p:PublishSingleFile=false")
    Write-Host "Mode: framework-dependent (.NET 8 Desktop Runtime x64)" -ForegroundColor Yellow
}

Write-Host "Publishing DSC Engine..." -ForegroundColor Cyan
dotnet @publishArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$gitSha = "unknown"
try {
    $gitSha = (git -C (Join-Path $scriptDir "..") rev-parse --short HEAD 2>$null)
    if (-not $gitSha) { $gitSha = "unknown" }
}
catch {
    $gitSha = "unknown"
}

@(
    "YesGATC DSC Engine"
    "Published: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')"
    "Git: $gitSha"
    "Runtime: $Runtime"
    "SelfContained: $selfContained"
    "SingleFile: $selfContained"
    ""
    "Local RC machine only. Do not install on the VPS."
    "1. Copy DscEngine.exe onto the RC Windows PC (or unzip this folder)."
    "2. Install WD PROXKey middleware from the token CD if missing. That is not .NET."
    "3. Plug in WD PROXKey."
    "4. Run DscEngine.exe. No .NET Desktop Runtime install."
    "5. Sign in with that RC Admin Aadhar + password."
    "6. Select unsigned certified certificates, Sign and upload, enter PIN once."
    "Data: %LOCALAPPDATA%\YesGATC\DscEngine\"
) | Set-Content -Path (Join-Path $stagingDir "README-DSCENGINE.txt") -Encoding UTF8

New-Item -ItemType Directory -Path $publishRoot -Force | Out-Null
$zipPath = Join-Path $publishRoot "DscEngine-$Runtime.zip"
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}
[System.IO.Compression.ZipFile]::CreateFromDirectory($stagingDir, $zipPath)

$publishDir = Join-Path $publishRoot "DscEngine-$Runtime"
if (Test-Path $publishDir) {
    Remove-Item $publishDir -Recurse -Force
}
Copy-Item $stagingDir $publishDir -Recurse
Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Zip: $zipPath"
Write-Host "  Folder: $publishDir"
