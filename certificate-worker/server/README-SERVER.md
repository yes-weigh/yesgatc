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

Keep the repo scripts on the server (optional) or copy only `server\update.ps1` and `server\pull-update.ps1` into `C:\YesGATC\CertificateWorker\` for easy re-runs.

---

## GitHub Releases (recommended — no manual zip copy)

Releases are published from GitHub Actions when you push a tag or run the workflow manually.

### Dev PC — create a release

**Option A — push a tag (after committing your changes):**

```powershell
cd D:\yesgatc\yesgatcin
git tag certificate-worker-v1.0.0
git push origin certificate-worker-v1.0.0
```

GitHub Actions builds the zip and attaches it to the release automatically.

**Option B — manual workflow run:**

1. GitHub → **Actions** → **Release Certificate Worker** → **Run workflow**
2. Enter tag e.g. `certificate-worker-v1.0.0`

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

This downloads the latest `certificate-worker-v*` release, extracts it, runs `update.ps1` (keeps your config + DOCA session), and starts the app.

**Specific version:**

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 `
  -Tag certificate-worker-v1.0.0 `
  -Start
```

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

---

## Troubleshooting

| Issue | What to do |
|-------|------------|
| App won't start | Install .NET 8 Desktop Runtime, or republish with `-SelfContained` |
| DOCA browser missing | Run `powershell -File C:\YesGATC\CertificateWorker\playwright.ps1 install chromium` |
| Queue not updating | Check status line: should say *watching Firestore live*; verify network to Firebase |
| Lost DOCA login | RDP in and log in again — profile is under `%LOCALAPPDATA%\YesGATC\CertificateWorker\doca-browser` |
