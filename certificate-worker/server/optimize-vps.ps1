# Optimize this Windows Server VPS for YesGATC Certificate Worker.
# Highest impact: Windows Defender exclusions so MsMpEng stops thrashing Chrome/Playwright.
#
# Run elevated (Administrator) PowerShell:
#   powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\optimize-vps.ps1
#
# Options:
#   -InstallPath C:\YesGATC\CertificateWorker
#   -SkipDefender          do not change Defender preferences
#   -SkipVisualEffects     do not set Best Performance visuals
#   -DisableSearchIndexing disable Windows Search indexing on C:\ (optional, reboot may be needed)
#   -ShowOnly              print current exclusions / tips; change nothing

param(
    [string]$InstallPath = "C:\YesGATC\CertificateWorker",
    [switch]$SkipDefender,
    [switch]$SkipVisualEffects,
    [switch]$DisableSearchIndexing,
    [switch]$ShowOnly
)

$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-LocalAppDataYesGatc {
    return Join-Path $env:LOCALAPPDATA "YesGATC\CertificateWorker"
}

function Get-PlaywrightCachePaths {
    $paths = @(
        (Join-Path $env:USERPROFILE "AppData\Local\ms-playwright"),
        (Join-Path $InstallPath "ms-playwright"),
        (Join-Path (Get-LocalAppDataYesGatc) "ms-playwright")
    )
    return $paths | Where-Object { $_ -and (Test-Path $_) }
}

function Get-DesiredExclusionPaths {
    $dataRoot = Get-LocalAppDataYesGatc
    $paths = @(
        $InstallPath,
        $dataRoot,
        (Join-Path $dataRoot "doca-browser"),
        (Join-Path $dataRoot "chrome-system-mirror"),
        (Join-Path $dataRoot "browser-downloads"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data")
    )

    foreach ($p in Get-PlaywrightCachePaths) {
        $paths += $p
    }

    # Normalize + unique (existing dirs preferred; still add install/data even if missing)
    $normalized = foreach ($p in $paths) {
        if ([string]::IsNullOrWhiteSpace($p)) { continue }
        try {
            [System.IO.Path]::GetFullPath($p)
        }
        catch {
            $p
        }
    }

    return $normalized | Select-Object -Unique
}

function Get-DesiredExclusionProcesses {
    return @(
        "Yesgatc.CertificateWorker.exe",
        "chrome.exe",
        "chromium.exe",
        "msedge.exe"
    )
}

function Show-MpExclusions {
    Write-Host ""
    Write-Host "=== Current Defender exclusions ===" -ForegroundColor Cyan
    try {
        $pref = Get-MpPreference
        Write-Host "ExclusionPath:"
        if ($pref.ExclusionPath) {
            $pref.ExclusionPath | ForEach-Object { Write-Host "  $_" }
        }
        else {
            Write-Host "  (none)"
        }

        Write-Host "ExclusionProcess:"
        if ($pref.ExclusionProcess) {
            $pref.ExclusionProcess | ForEach-Object { Write-Host "  $_" }
        }
        else {
            Write-Host "  (none)"
        }
    }
    catch {
        Write-Warning "Could not read Defender preferences: $($_.Exception.Message)"
    }
}

function Set-DefenderExclusions {
    if (-not (Get-Command Add-MpPreference -ErrorAction SilentlyContinue)) {
        Write-Warning "Defender PowerShell module not available (Add-MpPreference). Skip Defender step."
        return
    }

    $paths = Get-DesiredExclusionPaths
    $procs = Get-DesiredExclusionProcesses

    Write-Host ""
    Write-Host "Adding Defender path exclusions..." -ForegroundColor Cyan
    foreach ($path in $paths) {
        try {
            Add-MpPreference -ExclusionPath $path -ErrorAction Stop
            Write-Host "  + path: $path" -ForegroundColor Green
        }
        catch {
            Write-Warning "  path failed ($path): $($_.Exception.Message)"
        }
    }

    Write-Host "Adding Defender process exclusions..." -ForegroundColor Cyan
    foreach ($proc in $procs) {
        try {
            Add-MpPreference -ExclusionProcess $proc -ErrorAction Stop
            Write-Host "  + process: $proc" -ForegroundColor Green
        }
        catch {
            Write-Warning "  process failed ($proc): $($_.Exception.Message)"
        }
    }

    # Reduce scheduled scan fighting the worker during business hours (local time).
    try {
        # 2 = Weekly; day 0 = Sunday; time in minutes from midnight (03:00)
        Set-MpPreference -ScanParameters 1 -ScanScheduleDay 0 -ScanScheduleTime 180 -ErrorAction SilentlyContinue
        Write-Host "Scheduled scan preference set to weekly Sunday ~03:00 (if policy allows)." -ForegroundColor DarkGray
    }
    catch {
        Write-Host "Could not adjust scan schedule (policy may lock it)." -ForegroundColor DarkGray
    }
}

function Set-BestPerformanceVisuals {
    Write-Host ""
    Write-Host "Setting visual effects to Best Performance..." -ForegroundColor Cyan
    # 2 = Adjust for best performance
    $path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects"
    if (-not (Test-Path $path)) {
        New-Item -Path $path -Force | Out-Null
    }
    Set-ItemProperty -Path $path -Name VisualFXSetting -Type DWord -Value 2

    # Also set SystemPropertiesPerformance UserPreferencesMask-style via SystemParametersInfo is complex;
    # the VisualFXSetting registry is the standard "Best performance" radio for the current user.
    Write-Host "  VisualFXSetting=2 (Best performance) for current user." -ForegroundColor Green
    Write-Host "  Tip: System → Advanced system settings → Performance → Settings → Adjust for best performance" -ForegroundColor DarkGray
}

function Disable-WindowsSearchIndexingOnC {
    Write-Host ""
    Write-Host "Disabling Windows Search indexing on C:\ ..." -ForegroundColor Cyan
    try {
        $wsearch = Get-Service -Name WSearch -ErrorAction SilentlyContinue
        if ($wsearch) {
            Stop-Service WSearch -Force -ErrorAction SilentlyContinue
            Set-Service WSearch -StartupType Disabled -ErrorAction SilentlyContinue
            Write-Host "  WSearch service stopped and set to Disabled." -ForegroundColor Green
        }
        else {
            Write-Host "  WSearch service not found (OK on some Server SKUs)." -ForegroundColor DarkGray
        }
    }
    catch {
        Write-Warning "Could not disable WSearch: $($_.Exception.Message)"
    }
}

function Show-ManualChecklist {
    Write-Host ""
    Write-Host "=== Manual checklist (do once on VPS) ===" -ForegroundColor Cyan
    Write-Host "1. Task Manager: confirm Antimalware Service Executable is not stuck at high CPU."
    Write-Host "2. Windows Update: set Active Hours / pause during long queues so downloads do not steal CPU."
    Write-Host "3. Roles/Features: uninstall IIS / Print Server / unused roles if present."
    Write-Host "4. Session: stay signed in (RDP Disconnect OK; Sign out kills Playwright)."
    Write-Host "5. Autostart:"
    Write-Host "     powershell -ExecutionPolicy Bypass -File $InstallPath\pull-update.ps1 -EnsureAutoStart"
    Write-Host "6. Only one Yesgatc.CertificateWorker.exe; close personal Chrome before long runs."
    Write-Host "7. Smoke: one eMAAP login + one job, then resume the full queue."
    Write-Host "8. Captcha: match laptop config in appsettings.local.json (DeepSeek logged-in OR Gemini API key)."
}

# --- main ---

Write-Host "YesGATC Certificate Worker - VPS optimize" -ForegroundColor Cyan
Write-Host "InstallPath: $InstallPath"
Write-Host "DataRoot:    $(Get-LocalAppDataYesGatc)"

if ($ShowOnly) {
    Show-MpExclusions
    Show-ManualChecklist
    exit 0
}

if (-not (Test-IsAdministrator)) {
    Write-Warning "Not running as Administrator. Defender exclusions and some service changes will fail."
    Write-Host "Re-run from elevated PowerShell:" -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -ForegroundColor Yellow
}

if (-not $SkipDefender) {
    Set-DefenderExclusions
}
else {
    Write-Host "Skipping Defender changes (-SkipDefender)." -ForegroundColor DarkGray
}

if (-not $SkipVisualEffects) {
    Set-BestPerformanceVisuals
}
else {
    Write-Host "Skipping visual effects (-SkipVisualEffects)." -ForegroundColor DarkGray
}

if ($DisableSearchIndexing) {
    Disable-WindowsSearchIndexingOnC
}

Show-MpExclusions
Show-ManualChecklist

Write-Host ""
Write-Host "Done. Re-check Task Manager: MsMpEng should no longer dominate CPU during worker runs." -ForegroundColor Green
