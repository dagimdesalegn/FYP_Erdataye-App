param(
  [string]$KeystorePath = "android/app/erdataye-release.keystore",
  [string]$Alias = "erdataye",
  [string]$StorePassword,
  [string]$KeyPassword,
  [switch]$GenerateIfMissing
)

$ErrorActionPreference = "Stop"

if (-not $StorePassword) {
  throw "StorePassword is required."
}
if (-not $KeyPassword) {
  throw "KeyPassword is required."
}

if (-not (Test-Path $KeystorePath)) {
  if (-not $GenerateIfMissing) {
    throw "Keystore not found at '$KeystorePath'. Pass -GenerateIfMissing to create one."
  }

  if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) {
    throw "keytool not found. Install JDK and add keytool to PATH."
  }

  $keystoreDir = Split-Path -Parent $KeystorePath
  if ($keystoreDir -and -not (Test-Path $keystoreDir)) {
    New-Item -ItemType Directory -Path $keystoreDir | Out-Null
  }

  & keytool -genkeypair -v `
    -keystore $KeystorePath `
    -alias $Alias `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $StorePassword `
    -keypass $KeyPassword `
    -dname "CN=Erdataye App, OU=Mobile, O=Erdataye, L=Addis Ababa, ST=AA, C=ET"
}

$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $KeystorePath))
$base64 = [System.Convert]::ToBase64String($bytes)

Write-Host "\nSet these GitHub Actions secrets:" -ForegroundColor Cyan
Write-Host "ANDROID_KEY_ALIAS=$Alias"
Write-Host "ANDROID_KEYSTORE_PASSWORD=$StorePassword"
Write-Host "ANDROID_KEY_PASSWORD=$KeyPassword"
Write-Host "ANDROID_KEYSTORE_BASE64=<large base64 value printed below>"
Write-Host "\nANDROID_KEYSTORE_BASE64 value:" -ForegroundColor Yellow
Write-Output $base64
