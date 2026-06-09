# Register Windows Scheduled Task so Certificate Worker starts after sign-in and after VM reboot.
#
# Example (run once on the server as the same user you use for RDP + DOCA):
#   powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\register-autostart.ps1
#
# Requires an interactive desktop session (Chrome/Playwright). After a host reboot, either:
#   - sign in via RDP (task runs at logon), or
#   - configure Windows auto-logon for this user (see README-SERVER.md).

param(
    [string]$InstallPath = "C:\YesGATC\CertificateWorker",
    [string]$TaskName = "YesGATC Certificate Worker",
    [int]$StartupDelayMinutes = 2
)

$ErrorActionPreference = "Stop"

$startScript = Join-Path $InstallPath "start-worker.ps1"
$exePath = Join-Path $InstallPath "Yesgatc.CertificateWorker.exe"

if (-not (Test-Path $startScript)) {
    if (-not (Test-Path $exePath)) {
        throw "Install path is missing start-worker.ps1 and $exePath"
    }
    throw "start-worker.ps1 not found in $InstallPath. Update the worker from a recent release zip."
}

$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -InstallPath `"$InstallPath`"" `
    -WorkingDirectory $InstallPath

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$startupTrigger.Delay = "PT$StartupDelayMinutes`M"

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger @($logonTrigger, $startupTrigger) `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' for $currentUser" -ForegroundColor Green
Write-Host "  - At logon (RDP sign-in)" -ForegroundColor DarkGray
Write-Host "  - At startup (+ $StartupDelayMinutes min delay, after VM reboot when this user has a session)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "After a host/node reboot: sign in via RDP once, or configure Windows auto-logon for unattended restart." -ForegroundColor Yellow
