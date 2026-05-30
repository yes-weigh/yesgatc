# YesGATC Certificate Worker

Windows desktop app for **Super Admin** staff to process submitted verifications on the DOCA portal across **all regional centers**.

**Current features:**
- Sign in with Super Admin Aadhar + password (same as the web app admin login)
- List all `submitted` verifications from every RC
- Generate DOCA certificates one job at a time or in batch
- Mark jobs approved in Firebase after DOCA success

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

## Files

| Path | Purpose |
|------|---------|
| `Models/SiteCalibrationRecord.cs` | Verification row (includes RC center name) |
| `Services/FirebaseAuthService.cs` | Super Admin sign-in + role check |
| `Services/FirestoreService.cs` | Load global submitted queue |
| `Services/AutomationService.cs` | Playwright browser automation |

Do not commit `appsettings.local.json` (contains passwords).
