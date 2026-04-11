# Erdataye Emergency Coordination Platform

Erdataye is a real-time emergency coordination platform connecting patients, ambulance drivers, hospitals, and responders.

## Repository

- GitHub: https://github.com/dagimdesalegn/FYP_Erdataye-App

## What is included

- Expo/React Native app (mobile + web)
- FastAPI backend (auth, profiles, emergency operations, chat)
- Landing page files and nginx configs
- Tests for key frontend and backend flows

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Run Expo app:

```bash
npm run start
```

3. Backend setup:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

## Build Android

- Local/CI Android build workflow: [.github/workflows/build-android.yml](.github/workflows/build-android.yml)
- Additional details: [BUILD-INSTRUCTIONS.md](BUILD-INSTRUCTIONS.md)

## Deploy landing page to VPS

Use the included PowerShell script:

```powershell
.\scripts\deploy-landing-page.ps1 -Password "<your-vps-root-password>"
```

Landing assets are in [website/landing](website/landing).
