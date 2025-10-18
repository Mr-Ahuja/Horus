# Horus

Overview
- Service/tooling named after “Horus”; add domain (monitoring, vision, etc.).

Highlights
- Modular design; intended for service or CLI usage

Quickstart
- Add runtime, dependencies, and a minimal run command

Notes
- Describe core modules, configuration, and deployment strategy.

Deployment
- Hosted on Firebase Hosting. Config files: `.firebaserc`, `firebase.json`.
- GitHub Actions:
  - `.github/workflows/ci.yml` validates static files on PRs and non-main pushes.
  - `.github/workflows/firebase-deploy.yml` deploys previews on PRs (same-repo) and production on `main` pushes.

GitHub Actions secrets and variables
- Secrets (Repository secrets):
  - `FIREBASE_TOKEN` — Firebase CI token used for deployments only.
- Variables (Actions variables):
  - `FIREBASE_API_KEY`
  - `FIREBASE_AUTH_DOMAIN`
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_STORAGE_BUCKET`
  - `FIREBASE_MESSAGING_SENDER_ID`
  - `FIREBASE_APP_ID`
  - `FIREBASE_MEASUREMENT_ID`

How envs are injected
- The deploy workflow generates `env.js` during the job from the above variables. `index.html` loads `env.js` if present.

Local usage
- Open `index.html` directly or via any static server. A room hash is auto-generated; share the URL to invite the other peer.
