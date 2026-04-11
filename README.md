# Erdataye Emergency Coordination Platform

Erdataye is a real-time emergency response platform that helps coordinate patients, ambulance teams, and hospitals through one connected workflow.

## Live Links

- Public site: https://erdatayee.tech/
- Staff portal: https://staff.erdatayee.tech/staff
- Public repository: https://github.com/dagimdesalegn/FYP_Erdataye-App

## Project Structure

- `app/`: Expo Router screens for patient, driver, hospital, admin, and web routes.
- `components/`: Shared UI components and app-level providers.
- `utils/`: API clients, auth helpers, i18n, notifications, and emergency logic.
- `backend/`: FastAPI backend (auth, profiles, operations, chat) with tests and migrations.
- `website/landing/`: Public landing page HTML/CSS.
- `.github/workflows/`: CI and Android build workflows.

## Core Capabilities

- Emergency request creation and dispatch workflow.
- Live ambulance and patient tracking.
- Hospital assignment and status visibility.
- Family share live tracking page.
- Staff/admin operational interfaces.

## Local Development

### 1) Install dependencies

```bash
npm install
```

### 2) Start Expo app

```bash
npm run start
```

### 3) Run backend

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

## Android Build

- Workflow: [.github/workflows/build-android.yml](.github/workflows/build-android.yml)
- Build guide: [BUILD-INSTRUCTIONS.md](BUILD-INSTRUCTIONS.md)

## Deployment Notes

- Landing deploy script: [scripts/deploy-landing-page.ps1](scripts/deploy-landing-page.ps1)
- Landing source: [website/landing](website/landing)
- Backend runtime and nginx are deployed on VPS.

## Security

- Do not commit `.env` or private keys.
- Keep production secrets in deployment environment settings.
- Rotate credentials immediately if any secret is exposed.
