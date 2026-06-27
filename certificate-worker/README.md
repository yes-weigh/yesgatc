# YesGATC Certificate Worker

Windows desktop app for **Super Admin** staff to process submitted verifications on the DOCA portal across **all regional centers**.

**Current features:**
- Sign in with Super Admin Aadhar + password (same as the web app admin login)
- List all `submitted` verifications from every RC
- Generate DOCA certificates one job at a time or in batch
- Mark jobs approved in Firebase after DOCA success
- **Auto worker** — listens to Firestore in real time (onSnapshot-style), processes jobs unattended, retries failures after a configurable delay (default 15 seconds)
- **Browser recovery** — reopens Chrome if the DOCA window was closed or the RDP session disconnected

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download)
- Super Admin account (create with `npm run seed:super-admin` in the repo root)
- DOCA portal credentials

## Setup

1. Copy local credentials (optional — you can also type them in the app):

   ```powershell
   cd certificate-worker\Yesgatc.CertificateWorker
   copy appsettings.local.json.example appsettings.local.json
   ```

   Edit `appsettings.local.json` with your Super Admin Aadhar and password.

2. Install Playwright browsers (one-time):

   ```powershell
   cd certificate-worker\Yesgatc.CertificateWorker
   dotnet build
   powershell -ExecutionPolicy Bypass -File bin\Debug\net8.0-windows\playwright.ps1 install chromium
   ```

## Run

**One command from repo root (recommended for local dev):**

```powershell
npm run worker:dev
```

Builds Debug, closes any running instance, then launches the app. Close the window to stop — the terminal returns immediately (no stuck `dotnet run`).

**Alternative:**

```powershell
cd certificate-worker\Yesgatc.CertificateWorker
dotnet run
```

Or open `certificate-worker/Yesgatc.CertificateWorker.slnx` in Visual Studio and press F5.

## How it works

- Uses Firebase Auth REST API with `{aadhar}@yesgatc.auth` and verifies `role == super_admin` in Firestore
- Reads all `siteCalibrations` where `status == submitted` (every RC)
- Resolves customer/product data using each job's `rcId` (not the signed-in user)
- Playwright automates the DOCA IC verification form
- **DOCA session persistence:** Chromium profile at `%LOCALAPPDATA%\YesGATC\CertificateWorker\doca-browser`
- **Local credentials:** Super Admin + DOCA saved at `%LOCALAPPDATA%\YesGATC\CertificateWorker\credentials.local.json`

### DOCA captcha OCR (optional AI)

By default the worker uses **OpenAI vision** (`gpt-4o-mini`) when an API key is set, with **Tesseract fallback** if the API fails.

Add to `appsettings.local.json`:

```json
"Automation": {
  "CaptchaOcr": {
    "Provider": "OpenAI",
    "ApiKey": "sk-...",
    "Model": "gpt-4o-mini"
  }
}
```

Or set environment variable `OPENAI_API_KEY`. Use `"Provider": "Tesseract"` for local-only OCR (no API).

OpenRouter and other OpenAI-compatible APIs: set `ApiBaseUrl` (e.g. `https://openrouter.ai/api/v1`).

## Windows Server (unattended)

**Full guide:** [server/README-SERVER.md](server/README-SERVER.md)

### GitHub Releases (recommended)

**Dev PC — publish a release:**

```powershell
git tag certificate-worker-v1.0.0
git push origin certificate-worker-v1.0.0
```

**Server — update:**

```powershell
powershell -ExecutionPolicy Bypass -File C:\YesGATC\CertificateWorker\pull-update.ps1 -Start
```

One-time on server: `gh auth login` (private repo).

### Manual zip copy

1. On dev PC: `powershell -ExecutionPolicy Bypass -File certificate-worker\scripts\publish-release.ps1`
2. Copy `certificate-worker\publish\Yesgatc.CertificateWorker-win-x64.zip` to the server
3. On server: extract zip, then run `C:\YesGATC\CertificateWorker\update.ps1 -SourcePath <extracted-folder> -Start`

Install path: `C:\YesGATC\CertificateWorker\`  
Data (kept across updates): `%LOCALAPPDATA%\YesGATC\CertificateWorker\`

1. Set credentials in `appsettings.local.json` (Super Admin + DOCA).
2. In `appsettings.json`, keep `AutoWorker.Enabled: true` (default).
3. Sign in once via RDP, complete DOCA login/captcha in Chrome, then leave the app running.
4. If DOCA logs out or captcha is needed, RDP in, complete login — the auto worker detects the dashboard and resumes.
5. Closing Chrome no longer breaks the next run; the worker reopens it automatically.

Auto worker settings (`AutoWorker` section in `appsettings.json`):

| Setting | Default | Purpose |
|---------|---------|---------|
| `UseRealtimeListener` | true | Firestore snapshot listener instead of polling |
| `ListenerTokenRefreshMinutes` | 45 | Reconnect listener before auth token expires |
| `PollIntervalSeconds` | 5 | Fallback poll when realtime is off or unavailable |
| `RetryDelaySeconds` | 15 | Wait after a failed job before retry |
| `MaxPostApprovalRetries` | 3 | Max retries for **approved** jobs (Phase 2 signed PDF upload). Status stays `approved` in Firebase. Submitted jobs retry without cap. |
| `SkipBatchConfirmation` | true | No dialog when processing batches |

`Automation.DocaScrape.Enabled` defaults to **false** — certification uses **Chrome 1 only**. Set `true` to allow GATC list scraping (Chrome 2) from web admin.

## Files

| Path | Purpose |
|------|---------|
| `Models/SiteCalibrationRecord.cs` | Verification row (includes RC center name) |
| `Services/FirebaseAuthService.cs` | Super Admin sign-in + role check |
| `Services/FirestoreService.cs` | Load global submitted queue |
| `Services/AutomationService.cs` | Playwright browser automation |

Do not commit `appsettings.local.json` (contains passwords).
