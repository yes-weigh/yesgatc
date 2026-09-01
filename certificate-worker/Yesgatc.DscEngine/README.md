# YesGATC DSC Engine

Local Windows EXE for **RC Admin** machines. Not for the VPS.

Sign in with RC Aadhar + password, list certified certificates, select rows, **Sign & upload**. PIN is asked once per app session. Visible stamp. Signed PDF goes to Firebase (`signed-certificate/`). eMAAP upload is a later remote-worker step.

## Token (this machine)

- Hardware: **WD PROXKey** / Watchdata WDIND USB CCID (`VID_163C`)
- Middleware: `C:\Program Files (x86)\Watchdata\WD PROXKey`
- CSP: `PROXKey CSP India V3.0`
- PKCS#11: `C:\Windows\System32\Watchdata\PROXKey CSP India V3.0\WDPKCS.dll`
- Support: https://support.cryptoplanet.in

Certs are **not** registered in the Windows store. Signing talks to the token over PKCS#11.

## Dedicated PC (always-on)

1. Copy the self-contained `DscEngine.exe` onto the RC Windows PC.
2. Plug in that RC’s USB DSC. Install Watchdata / InnaIT middleware if needed.
3. Sign in with **that RC** Aadhar + password. **Save login**.
4. Turn on **Auto-run**, **Start with Windows**, and **Remember PIN on this PC**. Unlock PIN once.
5. Use Windows auto-logon so reboot comes back to the desktop. Token stays plugged in.

Polls unsigned certified seq >2304 and Sign & upload. PIN is DPAPI-protected for this Windows user only — not uploaded.

## Run

```powershell
npm run dsc:dev
```

Probe token without UI:

```powershell
cd certificate-worker\Yesgatc.DscEngine
dotnet run -- --probe
```

## Ship to RCs

```powershell
npm run dsc:publish
```

Zip: `certificate-worker/publish/DscEngine-win-x64.zip` — one self-contained `DscEngine.exe` (no .NET install on the RC PC). WD PROXKey middleware from the token CD is still required.

Framework-dependent zip (needs .NET 8 Desktop Runtime x64):

```powershell
powershell -ExecutionPolicy Bypass -File certificate-worker\scripts\publish-dsc-engine.ps1 -FrameworkDependent
```
