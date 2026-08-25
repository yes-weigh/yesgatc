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

Zip: `certificate-worker/publish/DscEngine-win-x64.zip`

RC needs WD PROXKey middleware + .NET 8 Desktop Runtime x64 (unless `-SelfContained`).
