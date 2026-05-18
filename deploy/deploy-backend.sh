#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BACKEND DEPLOY SCRIPT  (runs on EC2 — called by GitHub Actions)
# ─────────────────────────────────────────────────────────────────────────────
set -e

APP_DIR="/home/ubuntu/apexiq-backend"
REPO="https://github.com/$GITHUB_REPOSITORY.git"   # set by GH Actions env

echo "[deploy-backend] Starting deployment..."

# ── Pull latest code ──────────────────────────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch --all
  git reset --hard origin/main
else
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

# ── Copy .env (already placed by setup or CI secret) ─────────────────────────
# The CI pipeline writes .env before calling this script.

# ── Install dependencies (ci = exact lock file) ───────────────────────────────
npm ci --omit=dev

# ── Build ─────────────────────────────────────────────────────────────────────
npm run build

# ── Create log dir ────────────────────────────────────────────────────────────
mkdir -p /home/ubuntu/logs

# ── Start / reload via PM2 ───────────────────────────────────────────────────
if pm2 list | grep -q "apexiq-backend"; then
  pm2 reload deploy/ecosystem.config.js --env production
else
  pm2 start deploy/ecosystem.config.js --env production
fi

pm2 save
echo "[deploy-backend] Done ✓"
