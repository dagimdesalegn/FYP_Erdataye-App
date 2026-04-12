# GitHub Actions Android Signing Secrets

The workflow `.github/workflows/build-android.yml` now expects these repository secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_KEY_ALIAS`

## 1) Generate or load a keystore and print secret values

Run in PowerShell:

```powershell
./scripts/prepare-android-github-secrets.ps1 `
  -KeystorePath "android/app/erdataye-release.keystore" `
  -Alias "erdataye" `
  -StorePassword "<your_store_password>" `
  -KeyPassword "<your_key_password>" `
  -GenerateIfMissing
```

This prints all values, including `ANDROID_KEYSTORE_BASE64`.

## 2) Add secrets in GitHub

Repository -> Settings -> Secrets and variables -> Actions -> New repository secret

Create the four secrets with the printed values.

## 3) Trigger workflow

Push a commit or run workflow manually from Actions tab.

If secrets are missing, the workflow will fail early with clear missing-secret messages.
