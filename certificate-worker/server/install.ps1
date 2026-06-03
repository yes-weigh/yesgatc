# First-time install on Windows Server (run in PowerShell as Administrator is optional;
# scheduled task needs the same Windows user you use for RDP + DOCA login).
#
# Example:
#   Expand-Archive C:\YesGATC\updates\Yesgatc.CertificateWorker-win-x64.zip C:\YesGATC\updates\latest
#   powershell -ExecutionPolicy Bypass -File C:\YesGATC\repo\certificate-worker\server\install.ps1 `
#     -SourcePath C:\YesGATC\updates\latest `
#     -InstallPath C:\YesGATC\CertificateWorker `
#     -CreateLogonTask

param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,
    [string]$InstallPath = "C:\YesGATC\CertificateWorker",
    [switch]$CreateLogonTask,
    [string]$TaskName = "YesGATC Certificate Worker"
)

$ErrorActionPreference = "Stop"

$SourcePath = (Resolve-Path $SourcePath).Path
$exeName = "Yesgatc.CertificateWorker.exe"
$exePath = Join-Path $InstallPath $exeName

if (-not (Test-Path (Join-Path $SourcePath $exeName))) {
    throw "SourcePath does not contain $exeName. Run publish-release.ps1 first and copy the publish folder."
}

Write-Host "Installing Certificate Worker to $InstallPath" -ForegroundColor Cyan
New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null

& "$PSScriptRoot\update.ps1" -SourcePath $SourcePath -InstallPath $InstallPath

$updateDest = Join-Path $InstallPath "update.ps1"
$updateSrc = Join-Path $PSScriptRoot "update.ps1"
if ($updateSrc -ne $updateDest -and (Test-Path $updateSrc)) {
    Copy-Item $updateSrc $updateDest -Force
}

$pullUpdateDest = Join-Path $InstallPath "pull-update.ps1"
$pullUpdateSrc = Join-Path $PSScriptRoot "pull-update.ps1"
if ($pullUpdateSrc -ne $pullUpdateDest -and (Test-Path $pullUpdateSrc)) {
    Copy-Item $pullUpdateSrc $pullUpdateDest -Force
}

$readmeDest = Join-Path $InstallPath "README-SERVER.md"
$readmeSrc = Join-Path $PSScriptRoot "README-SERVER.md"
if ($readmeSrc -ne $readmeDest -and (Test-Path $readmeSrc)) {
    Copy-Item $readmeSrc $readmeDest -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path (Join-Path $InstallPath "appsettings.local.json"))) {
    $example = Join-Path $InstallPath "appsettings.local.json.example"
    if (Test-Path $example) {
        Copy-Item $example (Join-Path $InstallPath "appsettings.local.json")
        Write-Host "Created appsettings.local.json from example - edit it with Super Admin + DOCA credentials." -ForegroundColor Yellow
    }
}

if ($CreateLogonTask) {
    $currentUser = "$env:USERDOMAIN\$env:USERNAME"
    Write-Host "Creating logon scheduled task for $currentUser ..." -ForegroundColor Cyan

    $action = New-ScheduledTaskAction -Execute $exePath -WorkingDirectory $InstallPath
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host "Scheduled task '$TaskName' will start the worker when you sign in via RDP." -ForegroundColor Green
}

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "  Run now:  Start-Process '$exePath'"
Write-Host "  Data dir: $env:LOCALAPPDATA\YesGATC\CertificateWorker (credentials, DOCA browser profile - kept across updates)"
Write-Host ""
Write-Host "After first launch: sign in, complete DOCA captcha in Chrome, enable Auto worker, leave the session open or use -CreateLogonTask."
