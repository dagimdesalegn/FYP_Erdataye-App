# Erdataye Emergency Coordination Platform

[![Platform](https://img.shields.io/badge/platform-Expo%20%2B%20FastAPI-0A66C2)](https://expo.dev/)
[![Security](https://img.shields.io/badge/security-enabled-success)](./SECURITY.md)
[![CodeQL](https://img.shields.io/badge/CodeQL-active-2EA44F)](.github/workflows/codeql.yml)
[![Dependabot](https://img.shields.io/badge/dependabot-enabled-8250DF)](.github/dependabot.yml)

Erdataye is a real-time emergency coordination platform connecting patients, ambulance teams, and hospitals in one workflow designed for urgent response.

> Privacy note: Public production URLs and direct operational links are intentionally hidden in this README.

## Product Snapshot

| Area | Description |
| --- | --- |
| Emergency Intake | Create emergency requests with patient context and location |
| Dispatch | Route incidents to available ambulance and hospital resources |
| Live Tracking | Track ambulance and patient movement in real time |
| Staff Operations | Support admin and hospital operational workflows |
| First Aid Guidance | Provide immediate guidance while response is in progress |

## Access

- Public landing page: available by request
- Staff dashboard URL: private
- Repository: [FYP_Erdataye-App](https://github.com/dagimdesalegn/FYP_Erdataye-App)

## Architecture

- app/: Expo Router screens for patient, driver, hospital, admin, and web routes
- components/: shared UI components and app-level providers
- utils/: API clients, auth helpers, i18n, notifications, and emergency logic
- backend/: FastAPI backend (auth, profiles, operations, chat) with tests and migrations
- website/landing/: landing page assets (HTML/CSS)
- .github/workflows/: CI and Android build workflows

## Quick Start

### 1. Install frontend dependencies

```bash
npm install
```

### 2. Start Expo app

```bash
npm run start
```

### 3. Start backend API

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## Quality Checks

```bash
npm run lint
npm run test
cd backend && python -m pytest tests -v
```

## Build and Deploy

- Android workflow: [.github/workflows/build-android.yml](.github/workflows/build-android.yml)
- Build guide: [BUILD-INSTRUCTIONS.md](BUILD-INSTRUCTIONS.md)
- Landing deploy script: [scripts/deploy-landing-page.ps1](scripts/deploy-landing-page.ps1)
- Landing source: [website/landing](website/landing)

## Security

- Security policy: [SECURITY.md](SECURITY.md)
- Never commit .env files or private keys
- Keep production secrets in deployment environment variables
- Rotate credentials immediately if any secret is exposed
