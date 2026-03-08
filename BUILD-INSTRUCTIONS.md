# Erdataya Ambulance App - Build & Distribution Guide

## ✅ Completed Improvements

### 1. Custom Modal System

**All system popups replaced with beautiful in-app modals:**

- ✅ Replaced 40+ `Alert.alert` calls with custom themed modals
- ✅ Replaced all `window.alert` and `window.confirm` for web
- ✅ Animated entrance with scale + fade effects
- ✅ Auto-icon detection (Error → red, Success → green, Warning → yellow)
- ✅ Dark mode support matching app theme
- ✅ Consistent branded experience across all screens

**Files Updated:**

- `components/custom-modal.tsx` - Beautiful animated modal component
- `components/modal-context.tsx` - Global modal state provider
- `app/_layout.tsx` - Wrapped app with ModalProvider
- Updated 12 screen files with new modal calls

### 2. Android Build Configuration

**Created `eas.json` with 4 build profiles:**

- `development` - Debug APK for testing
- `preview` - Internal APK for pre-release
- `production` - Production APK for distribution
- `production-aab` - Google Play AAB bundle

---

## 🚀 How to Build Android APK/AAB

### Prerequisites

1. Install Expo CLI globally (if not already):

   ```bash
   npm install -g @expo/cli eas-cli
   ```

2. Create Expo account (free):
   - Go to https://expo.dev/signup
   - Sign up with email/GitHub

3. Login to EAS CLI:
   ```bash
   eas login
   ```

### Build Commands

#### 1. Development APK (Debug - for testing)

```bash
eas build --profile development --platform android
```

- **Size:** ~50-80 MB
- **Use:** Local testing, debugging
- **Installs on:** Any Android device

#### 2. Preview APK (Internal release)

```bash
eas build --profile preview --platform android
```

- **Size:** ~30-50 MB
- **Use:** Share with testers before public release
- **Installs on:** Any Android device

#### 3. Production APK (Shareable install file)

```bash
eas build --profile production --platform android
```

- **Size:** ~25-40 MB (optimized)
- **Use:** Public distribution via link/file
- **Installs on:** Any Android device
- **Best for:** Sharing without Google Play

#### 4. Production AAB (Google Play Store)

```bash
eas build --profile production-aab --platform android
```

- **Size:** ~20-30 MB
- **Use:** Upload to Google Play Console
- **Installs:** Only via Google Play Store
- **Required for:** Play Store submission

---

## 📦 Build Process (What Happens)

1. **Upload Source** - EAS uploads your code to Expo servers
2. **Install Dependencies** - npm packages installed on cloud
3. **Compile Native** - Gradle builds Android native binaries
4. **Sign APK/AAB** - Expo signs with auto-generated keystore
5. **Download Link** - Get shareable URL + file download

**Build Time:** 10-20 minutes (cloud build)

---

## 🔧 First Build Setup

When you run your first build, EAS will ask:

```
? Would you like to automatically create an EAS project for @yourname/erdataya?
› Yes

? Generate a new Android Keystore?
› Yes
```

**Choose "Yes" to both** - EAS handles everything automatically.

---

## 📥 After Build Completes

You'll see:

```
✔ Build finished
   https://expo.dev/accounts/yourname/projects/erdataya/builds/abc123

   APK: https://expo.dev/artifacts/eas/abc123.apk (34 MB)
```

**Download Options:**

1. **Direct Download** - Click the APK link, download to phone
2. **QR Code** - Scan QR on your Android device to install
3. **Share Link** - Send URL to anyone to download

---

## 📱 Installing on Android Device

### Option 1: Direct Install (Recommended)

1. Download APK to phone
2. Open file in Files app
3. Tap "Install"
4. Allow "Install from Unknown Sources" if prompted
5. App installs in ~10 seconds

### Option 2: ADB Install (via USB)

```bash
adb install your-app.apk
```

### Option 3: Web Distribution

Host APK on:

- Google Drive (public link)
- Dropbox
- Your own server
- Firebase Hosting

---

## 🔑 Important Notes

### Keystore (Signing Key)

- **Auto-generated** by EAS on first build
- **Stored securely** in Expo cloud
- **Same keystore** used for all future builds
- **Updates work** if using same keystore

### App Updates

To push new version:

1. Update version in `app.json`:
   ```json
   {
     "expo": {
       "version": "1.0.1",
       "android": {
         "versionCode": 2
       }
     }
   }
   ```
2. Run build command again
3. Users install new APK (overwrites old version)

### Environment Variables

Your `.env` file is **automatically included** in builds:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_GEMINI_API_KEY`

---

## 🎨 Build Customization (Optional)

Edit `app.json` before building:

```json
{
  "expo": {
    "name": "Erdataya Ambulance",
    "version": "1.0.0",
    "android": {
      "package": "com.erdataya.ambulance",
      "versionCode": 1,
      "permissions": ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
      "adaptiveIcon": {
        "backgroundColor": "#E6F4FE"
      }
    }
  }
}
```

---

## 🐛 Troubleshooting

### Build Fails

```bash
# Clear cache and retry
eas build --profile production --platform android --clear-cache
```

### Need Logs

```bash
# View build logs
eas build:view
```

### Different Package Name

Edit `app.json`:

```json
"android": {
  "package": "com.yourname.erdataya"
}
```

Then rebuild:

```bash
eas build --profile production --platform android
```

---

## 📊 Build Size Optimization

Current bundle sizes:

- **Web build:** `FYP_Erdataye-App-web-dist.zip` (2.81 MB)
- **Android APK:** ~30-40 MB (estimated)
- **Android AAB:** ~20-30 MB (estimated)

To reduce size:

1. Remove unused dependencies
2. Enable Hermes engine (already enabled)
3. Use AAB instead of APK for Play Store

---

## 🚦 Quick Start (3 Commands)

```bash
# 1. Login to Expo
eas login

# 2. Build production APK
eas build --profile production --platform android

# 3. Wait 10-15 minutes, get download link
```

**That's it!** Share the APK link with users.

---

## 📞 Support & Resources

- **EAS Build Docs:** https://docs.expo.dev/build/introduction/
- **Expo Dashboard:** https://expo.dev/
- **Build Status:** Check online dashboard for progress
- **Pricing:** Free tier = 30 builds/month (plenty for this project)

---

## ✨ Next Steps

1. **Test modals** - Run `npm start`, press `w` for web or `a` for Android
2. **Build APK** - Run `eas build --profile production --platform android`
3. **Share with users** - Send download link to testers
4. **Iterate** - Update code, bump version, rebuild

**Your app is now production-ready with beautiful custom modals and shareable Android builds! 🎉**
