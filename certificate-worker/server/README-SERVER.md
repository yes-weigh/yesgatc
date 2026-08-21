# Certificate Worker — Windows Server deployment

Simple layout for RDP-based unattended processing on a Windows Server.

## One-time server prerequisites

1. **Windows Server with desktop experience** (you already use RDP — good).
2. **.NET 8 Desktop Runtime (x64)** — only if you publish *without* `-SelfContained`:
   https://dotnet.microsoft.com/download/dotnet/8.0 → *Desktop Runtime*
3. **Google Chrome** (recommended) — Playwright can use installed Chrome via `BrowserChannel` in `appsettings.json`, or it uses bundled Chromium after `playwright install chromium`.

## Folder layout on the server

| Path | Purpose |
|------|---------|
| `C:\YesGATC\CertificateWorker\` | Program files (exe, dlls, configs) — **replaced on each update** |
| `C:\YesGATC\updates\` | Drop new zip / extracted publish folders here |
| `%LOCALAPPDATA%\YesGATC\CertificateWorker\` | **Never deleted on update** — saved login, DOCA browser session, PDFs, stamping images |

Keep the repo scripts on the server (optional) or copy `server\update.ps1`, `server\pull-update.ps1`, and `server\optimize-vps.ps1` into `C:\YesGATC\CertificateWorker\` for easy re-runs.

---

## GitHub Releases (recommended — no manual zip copy)

Releases are published from GitHub Actions when you push a tag or run the workflow manually.

### Dev PC — create a release

**Tag format:** `certificate-worker-v{major}.{minor}.{patch}` (current latest: check with `git tag -l "certificate-worker-v*"`).

| Change type | Bump |
|-------------|------|
| Bug fix, small worker change | patch (`v1.0.40` → `v1.0.41`) |
| New feature | minor |
| Breaking change | major |

**Option A — push a tag (after committing your changes on `main`):**

```powershell
cd D:\yesgatc\yesgatcin
git add certificate-worker/
git commit -m "fix(worker): cap post-approval retries at 3"
git push origin main

git tag certificate-worker-v1.0.41
git push origin certificate-worker-v1.0.41
```

GitHub Actions (`.github/workflows/certificate-worker-release.yml`) builds the zip and attaches it to the release.

**Option B — manual workflow run:**

1. GitHub → **Actions** → **Release Certificate Worker** → **Run workflow**
2. Enter tag e.g. `certificate-worker-v1.0.41`

Check **Releases** on the repo: `Yesgatc.CertificateWorker-win-x64.zip`

### Server — one-time GitHub auth

Install [GitHub CLI](https://cli.github.com/) on the server, then:

```powershell
gh auth login
```

For a **private** repo this is required. Alternatively set a read-only PAT:

```powershell
[Environment]::SetEnvironmentVariable("GITHUB_TOKEN", "ghp_xxxx", "User")
```

(restart PowerShell after setting)

### Server — first install from GitHub

Copy `certificate-worker\server\pull-update.ps1` to the server once (from this repo, or from any release zip after a manual download). Then:

```powershell
New-Item -ItemType Directory -Path C:\YesGATC\CertificateWorker -Force

powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 `
  -FirstInstall `
  -CreateLogonTask `
  -Start
```

### Server — every update (one command)

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 -Start
```

Downloads the **latest** `certificate-worker-v*` release, extracts, runs `update.ps1` (keeps `appsettings.local.json` + DOCA browser session), starts the app.

**Pin a specific version** (recommended after a release):

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 `
  -Tag certificate-worker-v1.0.41 `
  -Start
```

**After auto-start script changes**, or any `-Start` pull (now auto-registers):

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 -Start
```

Or explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 -EnsureAutoStart
```

**What `update.ps1` keeps:** `appsettings.local.json`, `%LOCALAPPDATA%\YesGATC\CertificateWorker\` (credentials, DOCA login, cached PDFs).  
**What it replaces:** exe, dlls, default `appsettings.json` (merge new keys like `MaxSubmitRetries` / `MaxPostApprovalRetries` if you customized the old file).

---

## First-time install (manual zip copy)

### On your dev PC

```powershell
cd D:\yesgatc\yesgatcin
powershell -ExecutionPolicy Bypass -File certificate-worker\scripts\publish-release.ps1
```

This creates:

- `certificate-worker\publish\win-x64\` — folder to copy
- `certificate-worker\publish\Yesgatc.CertificateWorker-win-x64.zip` — zip for RDP/USB

Copy the **zip** to the server (e.g. `C:\YesGATC\updates\`).

### On the server (RDP)

```powershell
Expand-Archive C:\YesGATC\updates\Yesgatc.CertificateWorker-win-x64.zip C:\YesGATC\updates\latest -Force

# Copy server scripts from repo once, or run from repo checkout:
powershell -ExecutionPolicy Bypass -File D:\path\to\certificate-worker\server\install.ps1 `
  -SourcePath C:\YesGATC\updates\latest `
  -InstallPath C:\YesGATC\CertificateWorker `
  -CreateLogonTask
```

Edit secrets (once):

```powershell
notepad C:\YesGATC\CertificateWorker\appsettings.local.json
```

Start the app:

```powershell
Start-Process C:\YesGATC\CertificateWorker\Yesgatc.CertificateWorker.exe
```

**First run checklist**

1. Sign in as Super Admin.
2. Complete DOCA login + captcha in the Chrome window that opens.
3. Enable **Auto worker**.
4. Leave the app running (or rely on the logon scheduled task after you sign in).

---

## Updating after you change the app

### GitHub Releases (recommended)

**Dev PC — publish:**

```powershell
git tag certificate-worker-v1.0.1
git push origin certificate-worker-v1.0.1
```

Or: GitHub → Actions → **Release Certificate Worker** → Run workflow.

**Server — update:**

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 -Start
```

See [server/README-SERVER.md](server/README-SERVER.md) for `gh auth login` and first install.

### Manual zip copy (fallback)

Every release is the same three steps:

### 1. Dev PC — build release

```powershell
powershell -ExecutionPolicy Bypass -File certificate-worker\scripts\publish-release.ps1
```

### 2. Server — copy new zip

Copy `Yesgatc.CertificateWorker-win-x64.zip` to `C:\YesGATC\updates\` and extract:

```powershell
Expand-Archive C:\YesGATC\updates\Yesgatc.CertificateWorker-win-x64.zip C:\YesGATC\updates\latest -Force
```

### 3. Server — run update (keeps your config + DOCA session)

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\update.ps1 `
  -SourcePath C:\YesGATC\updates\latest `
  -Start
```

`update.ps1`:

- Stops the running worker
- Replaces program files under `C:\YesGATC\CertificateWorker\`
- **Keeps** `appsettings.local.json`
- **Does not touch** `%LOCALAPPDATA%\YesGATC\CertificateWorker\` (credentials, DOCA login, cached PDFs)
- Re-runs Playwright Chromium install if needed
- Optionally starts the app again (`-Start`)

**Tip:** Copy `server\update.ps1` into `C:\YesGATC\CertificateWorker\update.ps1` during install so you never hunt for the repo on the server.

---

## Optional: self-contained publish (no .NET on server)

Larger zip, but the server does not need .NET installed:

```powershell
powershell -ExecutionPolicy Bypass -File certificate-worker\scripts\publish-release.ps1 -SelfContained
```

---

## RDP / session notes

- Playwright runs **visible Chrome** (`Headless = false`) — the server user must be **logged in** (RDP session active or disconnected but not signed out).
- Do **not** sign out of Windows — that closes the interactive session and stops the worker.
- If DOCA asks for captcha or a new password, RDP in, fix it in Chrome, and the auto worker resumes.
- Closing Chrome is OK — the worker reopens it on the next job.
- **CPU 100% with low memory?** Open Task Manager first — if **Antimalware Service Executable** (`MsMpEng`) is high, run [VPS performance tuning](#vps-performance-tuning-4-gb--defender) below before blaming the worker.

---

## VPS performance tuning (4 GB / Defender)

Dedicated automation box checklist. **Biggest win on a busy queue:** stop Windows Defender from scanning Chrome/Playwright/worker I/O in real time.

### Symptom

| Task Manager | Meaning |
|--------------|---------|
| CPU ~100%, Memory ~50–60% | CPU starved — often Defender, not RAM |
| `Antimalware Service Executable` ≫ other processes | Real-time scan thrashing worker folders |

### One command (Administrator PowerShell)

Copy `optimize-vps.ps1` onto the server (from a release zip / `pull-update`), then:

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\optimize-vps.ps1
```

What it does:

- **Defender path exclusions:** `C:\YesGATC\CertificateWorker\`, `%LOCALAPPDATA%\YesGATC\CertificateWorker\` (incl. `doca-browser`, `chrome-system-mirror`), Playwright cache dirs, Chrome User Data
- **Defender process exclusions:** `Yesgatc.CertificateWorker.exe`, `chrome.exe`, `chromium.exe`, `msedge.exe`
- Prefers weekly scan schedule (Sunday ~03:00) when policy allows
- Sets current-user visual effects to **Best performance**
- Prints current exclusions + manual checklist

Show current exclusions only (no changes):

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\optimize-vps.ps1 -ShowOnly
```

Optional — disable Windows Search indexing (saves background CPU/disk):

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\optimize-vps.ps1 -DisableSearchIndexing
```

**Security note:** Exclusions reduce scanning on those paths/processes. Fine for a locked-down single-purpose VPS; do **not** turn Defender off entirely on a public host unless you accept that risk.

### Manual Windows trim

1. **Visual effects:** System → Advanced system settings → Performance → Settings → **Adjust for best performance** (script sets the registry equivalent for the logged-in user).
2. **Windows Update:** set Active Hours / pause during long certificate queues so downloads do not steal CPU mid-run.
3. **Roles/Features:** remove unused roles (IIS, Print Server, etc.) if present.
4. Close **personal Chrome** and any second worker instance before long runs.

### Session + autostart (required for Playwright UI)

| Do | Do not |
|----|--------|
| RDP **Disconnect** (session stays) | **Sign out** (kills Chrome + worker) |
| `pull-update.ps1 -EnsureAutoStart` | Expect worker with nobody logged in |
| Optional Sysinternals Autologon for reboot recovery | Leave Evaluation license unused forever without a plan |

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 -EnsureAutoStart
```

See [Auto-start after VM / node reboot](#auto-start-after-vm--node-reboot) below.

### Captcha config (ops only)

Match whatever works on your laptop in `C:\YesGATC\CertificateWorker\appsettings.local.json` (DeepSeek signed-in in the worker Chrome profile, **or** Gemini API key). No code change required for tuning.

### Verification (after optimize)

1. Task Manager → sort by CPU → **Antimalware Service Executable** should not stay dominant (>10–15% sustained) while the worker runs.
2. Smoke: one eMAAP login + **one** job succeeds.
3. Then resume the full queue (e.g. 69 jobs).
4. Memory during one Chrome + worker should stay usable (roughly under ~80% on 4 GB).

---

## Auto-start after VM / node reboot
The worker is a **desktop app** (Chrome + DOCA). It cannot run with no Windows user session. After a host provider reboots the VM, use a **scheduled task** so the worker starts again when the session is available.

### One-time setup (on the server, as your RDP user)

After updating to a release that includes `register-autostart.ps1`:

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 -EnsureAutoStart
```

Or directly:

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\register-autostart.ps1
```

This registers task **YesGATC Certificate Worker** with:

- **At logon** — starts when you sign in via RDP
- **At startup** (+ 2 minute delay) — starts after reboot when this user has an interactive session
- **Restart on failure** — retries if the process exits

Verify in Task Scheduler (`taskschd.msc`) → Task Scheduler Library → *YesGATC Certificate Worker*.

Test without rebooting:

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\start-worker.ps1
```

### After a provider reboot

| Scenario | What happens |
|----------|----------------|
| You **RDP in** after reboot | Task runs at logon → worker starts |
| **Auto-logon** configured for the worker user | Startup trigger runs ~2 min after boot |
| Nobody signs in | Worker stays stopped until someone logs in |

### Optional: unattended auto-logon (advanced)

For a dedicated VM that must recover without manual RDP, configure **automatic sign-in** for the same Windows user that runs the worker (e.g. `Sysinternals Autologon` or `netplwiz`). Restrict RDP access and use a strong password. Only do this on a single-purpose automation server.

**Do not** sign out — use **Disconnect** on RDP so the session stays active.

---

## Troubleshooting

| Issue | What to do |
|-------|------------|
| App won't start | Install .NET 8 Desktop Runtime, or republish with `-SelfContained` |
| DOCA browser missing | Run `powershell -File C:\YesGATC\CertificateWorker\playwright.ps1 install chromium` |
| Queue not updating | Check status line: should say *watching Firestore live*; verify network to Firebase |
| Lost DOCA login | RDP in and log in again — profile is under `%LOCALAPPDATA%\YesGATC\CertificateWorker\doca-browser` |
| Worker not running after VM reboot | Run `register-autostart.ps1` or `pull-update.ps1 -EnsureAutoStart`, then RDP in once (or configure auto-logon) |
| CPU 100%, memory OK, MsMpEng high | Run `optimize-vps.ps1` as Administrator — see [VPS performance tuning](#vps-performance-tuning-4-gb--defender) |
| Queue freezes / Chrome sluggish | Confirm single worker instance; close extra Chrome; Defender exclusions applied |
