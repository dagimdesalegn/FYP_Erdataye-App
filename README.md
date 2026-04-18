# Erdataye Emergency Coordination Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![React Native](https://img.shields.io/badge/React%20Native-20232A?logo=react&logoColor=61DAFB)](https://reactnative.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Supabase](https://img.shields.io/badge/Supabase-181818?logo=supabase&logoColor=3ECF8E)](https://supabase.com/)

Erdataye is a real-time emergency coordination platform connecting patients, ambulance teams, and hospitals in one workflow designed for urgent response.

<p align="center">
	<a href="https://erdatayee.tech/" target="_blank">
		<img src="https://img.shields.io/badge/Visit%20Public%20Landing%20Page-1A73E8?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Visit Public Landing Page" />
	</a>
	<a href="https://github.com/dagimdesalegn/FYP_Erdataye-App" target="_blank">
		<img src="https://img.shields.io/badge/View%20Source%20Code-111827?style=for-the-badge&logo=github&logoColor=white" alt="View Source Code" />
	</a>
</p>

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

### Frontend (Expo + React Native)

- app/: route-based screens for patient, driver, hospital, admin, and web entry points
- components/: reusable UI primitives, shared state wrappers, map and modal components
- hooks/: auth guards and theme hooks
- utils/: network clients, auth/session helpers, emergency workflows, i18n, notifications

### Backend (FastAPI + Supabase)

- backend/main.py: API bootstrap, middleware, and router registration
- backend/routers/: domain routers for auth, profiles, operations, and chat
- backend/services/: Supabase and service integrations
- backend/migrations/: SQL migrations for operational schema changes
- backend/tests/: API and concurrency test coverage

### Delivery and Ops

- .github/workflows/: CI, CodeQL scan, and Android build pipeline
- website/landing/: production landing page assets
- render.yaml: deployment/runtime configuration

## App Flow

1. Patient submits emergency request from mobile app with location + profile context.
2. Backend validates request and persists incident state in Supabase.
3. Dispatch logic assigns/updates hospital and ambulance candidates.
4. Driver and hospital dashboards receive near-real-time updates.
5. Live tracking stream updates patient and staff tracking views.
6. Incident closes after handover and status transitions are recorded.

## Technical Highlights

- Route-driven frontend with role-based screens and guarded navigation.
- Hybrid emergency workflow: request intake, dispatch, tracking, and handover.
- Structured backend routers for modular domain isolation.
- Test-ready backend package with dedicated API and concurrency tests.
- CI + security automation integrated in GitHub Actions.

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
