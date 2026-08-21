# Builds release zips you can copy to Windows.
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

function Stop-NamedProcessIfRunning {
    param([string]$ProcessName)

    $processes = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
    if (-not $processes) {
        return
    }

    if ($KeepWorkerRunning) {
        throw "$ProcessName is running. Close it first, or rerun without -KeepWorkerRunning."
    }

    Write-Host "Stopping $ProcessName (file lock release)..." -ForegroundColor Yellow
    $processes | Stop-Process -Force
    Start-Sleep -Seconds 1
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
        throw "Could not sync publish folder (robocopy exit code $LASTEXITCODE). Close the EXE and retry."
    }
}

function Publish-WorkerFlavor {
    param(
        [string]$Flavor,
        [string]$ZipName,
        [string]$PublishFolderName,
        [string]$ProductLabel,
        [bool]$IncludeServerScripts
    )

    $stagingDir = Join-Path $env:TEMP "yesgatc-publish-$Flavor-$Runtime-$(Get-Date -Format 'yyyyMMddHHmmss')"
    if (Test-Path $stagingDir) {
        Remove-Item $stagingDir -Recurse -Force
    }

    Write-Host "Publishing $ProductLabel ($Configuration, $Runtime, $Flavor)..." -ForegroundColor Cyan

    $publishArgs = @(
        "publish", $projectDir,
        "-c", $Configuration,
        "-r", $Runtime,
        "-o", $stagingDir,
        "/p:PublishSingleFile=false",
        "/p:DebugType=none",
        "/p:DebugSymbols=false",
        "/p:WorkerFlavor=$Flavor"
    )

    if ($SelfContained) {
        $publishArgs += @("--self-contained", "true")
    }
    else {
        $publishArgs += @("--self-contained", "false")
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
        $ProductLabel
        "Published: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')"
        "Git: $gitSha"
        "Configuration: $Configuration"
        "Runtime: $Runtime"
        "Flavor: $Flavor"
        "SelfContained: $($SelfContained.IsPresent)"
    ) -join "`n"

    Set-Content -Path (Join-Path $stagingDir "version.txt") -Value $versionText -Encoding UTF8

    if ($IncludeServerScripts) {
        $serverDir = Join-Path $scriptDir "..\server"
        foreach ($serverFile in @("pull-update.ps1", "update.ps1", "install.ps1", "start-worker.ps1", "register-autostart.ps1", "optimize-vps.ps1", "README-SERVER.md")) {
            $serverFilePath = Join-Path $serverDir $serverFile
            if (Test-Path $serverFilePath) {
                Copy-Item $serverFilePath $stagingDir -Force
            }
        }
    }
    else {
        $rcReadme = @(
            "EmaapEngine - RC private certificate worker"
            ""
            "1. Unzip on the RC Windows PC."
            "2. Install .NET 8 Desktop Runtime x64 if prompted."
            "3. Run EmaapEngine.exe"
            "4. Sign in with this RC Admin Aadhar + portal password."
            "5. Type captcha and OTP in Chrome. eMAAP user/pass is built in."
            "6. Data folder: %LOCALAPPDATA%\YesGATC\EmaapEngine\"
            ""
            "Do not install this on the VPS. VPS uses Yesgatc.CertificateWorker.exe."
        ) -join "`n"
        Set-Content -Path (Join-Path $stagingDir "README-EMAAPENGINE.txt") -Value $rcReadme -Encoding UTF8
    }

    $zipPath = Join-Path $publishRoot $ZipName
    Write-Host "Creating zip $ZipName..." -ForegroundColor Cyan
    New-ZipFromDirectory -SourceDirectory $stagingDir -DestinationZip $zipPath

    $publishDir = Join-Path $publishRoot $PublishFolderName
    Write-Host "Syncing $publishDir..." -ForegroundColor Cyan
    Sync-PublishDirectory -SourceDirectory $stagingDir -DestinationDirectory $publishDir

    Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    return $zipPath
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Join-Path $scriptDir "..\Yesgatc.CertificateWorker"
$publishRoot = Join-Path $scriptDir "..\publish"

Stop-NamedProcessIfRunning -ProcessName "Yesgatc.CertificateWorker"
Stop-NamedProcessIfRunning -ProcessName "EmaapEngine"

if ($SelfContained) {
    Write-Host "Mode: self-contained (no .NET runtime needed, larger download)" -ForegroundColor Yellow
}
else {
    Write-Host "Mode: framework-dependent (install .NET 8 Desktop Runtime x64 once)" -ForegroundColor Yellow
}

$vpsZip = Publish-WorkerFlavor `
    -Flavor "Vps" `
    -ZipName "Yesgatc.CertificateWorker-$Runtime.zip" `
    -PublishFolderName $Runtime `
    -ProductLabel "YesGATC Certificate Worker" `
    -IncludeServerScripts $true

$engineZip = Publish-WorkerFlavor `
    -Flavor "EmaapEngine" `
    -ZipName "EmaapEngine-$Runtime.zip" `
    -PublishFolderName "EmaapEngine-$Runtime" `
    -ProductLabel "EmaapEngine" `
    -IncludeServerScripts $false

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  VPS zip: $vpsZip"
Write-Host "  RC zip:  $engineZip"
Write-Host ""
Write-Host "VPS: pull-update.ps1 -Start"
Write-Host "RC:  unzip EmaapEngine-win-x64.zip and run EmaapEngine.exe"
