# Download the latest Certificate Worker release from GitHub and install/update on this server.
#
# Prerequisites (once):
#   - GitHub CLI: https://cli.github.com/  then  gh auth login
#   OR set env GITHUB_TOKEN with a PAT that can read repo releases (private repos)
#
# Update (normal):
#   powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 -Start
#
# First install from GitHub only:
#   powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 -FirstInstall -CreateLogonTask -Start
#
# Specific release:
#   powershell -ExecutionPolicy Bypass -File .\pull-update.ps1 -Tag certificate-worker-v1.0.0 -Start

param(
    [string]$Repository = "yes-weigh/yesgatc",
    [string]$InstallPath = "C:\YesGATC\CertificateWorker",
    [string]$UpdatesDir = "C:\YesGATC\updates",
    [string]$Tag = "",
    [string]$AssetName = "Yesgatc.CertificateWorker-win-x64.zip",
    [string]$GitHubToken = "",
    [switch]$Start,
    [switch]$FirstInstall,
    [switch]$CreateLogonTask,
    [switch]$SkipPlaywright
)

$ErrorActionPreference = "Stop"

$TagPrefix = "certificate-worker-v"
$ExtractDir = Join-Path $UpdatesDir "latest"
$ZipPath = Join-Path $UpdatesDir $AssetName
$ExeName = "Yesgatc.CertificateWorker.exe"

function Get-AuthToken {
    param([string]$ExplicitToken)

    if (-not [string]::IsNullOrWhiteSpace($ExplicitToken)) {
        return $ExplicitToken.Trim()
    }

    foreach ($name in @("GITHUB_TOKEN", "GH_TOKEN")) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value.Trim()
        }
    }

    return $null
}

function Resolve-GhExecutable {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($gh) {
        return $gh.Source
    }

    return $null
}

function Get-LatestCertificateWorkerTagFromApi {
    param(
        [string]$Repo,
        [string]$Token
    )

    $headers = @{
        Accept = "application/vnd.github+json"
        "X-GitHub-Api-Version" = "2022-11-28"
        User-Agent = "YesGATC-CertificateWorker-PullUpdate"
    }

    if ($Token) {
        $headers.Authorization = "Bearer $Token"
    }

    $page = 1
    while ($page -le 5) {
        $uri = "https://api.github.com/repos/$Repo/releases?per_page=100&page=$page"
        $releases = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get

        if (-not $releases -or $releases.Count -eq 0) {
            break
        }

        foreach ($release in $releases) {
            if ($release.tag_name -like "$TagPrefix*") {
                return $release.tag_name
            }
        }

        if ($releases.Count -lt 100) {
            break
        }

        $page++
    }

    throw "No GitHub release found with tag prefix '$TagPrefix'. Create one with tag certificate-worker-v1.0.0"
}

function Download-ReleaseAssetWithApi {
    param(
        [string]$Repo,
        [string]$ReleaseTag,
        [string]$AssetFileName,
        [string]$DestinationPath,
        [string]$Token
    )

    $headers = @{
        Accept = "application/vnd.github+json"
        "X-GitHub-Api-Version" = "2022-11-28"
        User-Agent = "YesGATC-CertificateWorker-PullUpdate"
    }

    if ($Token) {
        $headers.Authorization = "Bearer $Token"
    }

    $releaseUri = "https://api.github.com/repos/$Repo/releases/tags/$ReleaseTag"
    $release = Invoke-RestMethod -Uri $releaseUri -Headers $headers -Method Get
    $asset = $release.assets | Where-Object { $_.name -eq $AssetFileName } | Select-Object -First 1

    if (-not $asset) {
        throw "Release $ReleaseTag does not contain asset '$AssetFileName'."
    }

    $downloadHeaders = @{
        Accept = "application/octet-stream"
        User-Agent = "YesGATC-CertificateWorker-PullUpdate"
    }

    if ($Token) {
        $downloadHeaders.Authorization = "Bearer $Token"
    }

    Write-Host "Downloading $AssetFileName from $ReleaseTag ..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $asset.url -Headers $downloadHeaders -OutFile $DestinationPath
}

function Download-ReleaseAsset {
    param(
        [string]$Repo,
        [string]$ReleaseTag,
        [string]$AssetFileName,
        [string]$DestinationDirectory,
        [string]$DestinationPath,
        [string]$Token
    )

    New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null

    if (Test-Path $DestinationPath) {
        Remove-Item $DestinationPath -Force
    }

    $ghPath = Resolve-GhExecutable
    if ($ghPath) {
        Write-Host "Downloading $AssetFileName from $ReleaseTag via GitHub CLI ..." -ForegroundColor Cyan
        & $ghPath release download $ReleaseTag `
            --repo $Repo `
            --pattern $AssetFileName `
            --dir $DestinationDirectory `
            --clobber
        return
    }

    Download-ReleaseAssetWithApi `
        -Repo $Repo `
        -ReleaseTag $ReleaseTag `
        -AssetFileName $AssetFileName `
        -DestinationPath $DestinationPath `
        -Token $Token
}

function Expand-ReleaseZip {
    param(
        [string]$ZipFile,
        [string]$TargetDirectory
    )

    if (Test-Path $TargetDirectory) {
        Remove-Item $TargetDirectory -Recurse -Force
    }

    New-Item -ItemType Directory -Path $TargetDirectory -Force | Out-Null
    Expand-Archive -Path $ZipFile -DestinationPath $TargetDirectory -Force
}

Write-Host "YesGATC Certificate Worker - pull from GitHub Releases" -ForegroundColor Cyan
Write-Host "  Repository: $Repository" -ForegroundColor DarkGray

$token = Get-AuthToken -ExplicitToken $GitHubToken
$releaseTag = $Tag.Trim()

if ([string]::IsNullOrWhiteSpace($releaseTag)) {
    $ghPath = Resolve-GhExecutable
    if ($ghPath) {
        Write-Host "Resolving latest $TagPrefix* release via GitHub CLI ..." -ForegroundColor DarkGray
        $releaseTag = & $ghPath release list --repo $Repository --limit 30 `
            | ForEach-Object { ($_ -split "`t")[0] } `
            | Where-Object { $_ -like "$TagPrefix*" } `
            | Select-Object -First 1
    }

    if ([string]::IsNullOrWhiteSpace($releaseTag)) {
        Write-Host "Resolving latest $TagPrefix* release via GitHub API ..." -ForegroundColor DarkGray
        $releaseTag = Get-LatestCertificateWorkerTagFromApi -Repo $Repository -Token $token
    }
}

if ([string]::IsNullOrWhiteSpace($releaseTag)) {
    throw "Could not determine release tag. Pass -Tag certificate-worker-v1.0.0"
}

Write-Host "  Release:    $releaseTag" -ForegroundColor DarkGray
Write-Host ""

New-Item -ItemType Directory -Path $UpdatesDir -Force | Out-Null
Download-ReleaseAsset `
    -Repo $Repository `
    -ReleaseTag $releaseTag `
    -AssetFileName $AssetName `
    -DestinationDirectory $UpdatesDir `
    -DestinationPath $ZipPath `
    -Token $token

Expand-ReleaseZip -ZipFile $ZipPath -TargetDirectory $ExtractDir

$installedExe = Join-Path $InstallPath $ExeName
$shouldInstall = $FirstInstall -or -not (Test-Path $installedExe)

if ($shouldInstall) {
    $installScript = Join-Path $ExtractDir "install.ps1"
    if (-not (Test-Path $installScript)) {
        throw "First install requires install.ps1 in the release zip. Republish from a recent build."
    }

    Write-Host "Running first-time install to $InstallPath ..." -ForegroundColor Cyan
    $installArgs = @{
        SourcePath = $ExtractDir
        InstallPath = $InstallPath
    }

    if ($CreateLogonTask) {
        $installArgs.CreateLogonTask = $true
    }

    & powershell -ExecutionPolicy Bypass -File $installScript @installArgs
}
else {
    $updateScript = Join-Path $InstallPath "update.ps1"
    if (-not (Test-Path $updateScript)) {
        $updateScript = Join-Path $ExtractDir "update.ps1"
    }

    if (-not (Test-Path $updateScript)) {
        throw "update.ps1 not found in $InstallPath or the release zip."
    }

    Write-Host "Updating installed worker at $InstallPath ..." -ForegroundColor Cyan
    $updateArgs = @{
        SourcePath = $ExtractDir
        InstallPath = $InstallPath
    }

    if ($SkipPlaywright) {
        $updateArgs.SkipPlaywright = $true
    }

    if ($Start) {
        $updateArgs.Start = $true
    }

    & powershell -ExecutionPolicy Bypass -File $updateScript @updateArgs
}

$pullUpdateDest = Join-Path $InstallPath "pull-update.ps1"
Copy-Item $PSCommandPath $pullUpdateDest -Force

Write-Host ""
Write-Host "GitHub pull complete." -ForegroundColor Green
Write-Host "  Installed: $InstallPath"
Write-Host "  Release:   $releaseTag"

if ($Start -and $shouldInstall) {
    $exePath = Join-Path $InstallPath $ExeName
    if (Test-Path $exePath) {
        Start-Process $exePath -WorkingDirectory $InstallPath
        Write-Host "Started $ExeName" -ForegroundColor Green
    }
}
