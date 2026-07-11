#!/usr/bin/env bash
# Run on the EC2 server: bash ~/eddva_backend/scripts/check-prod-env.sh
# Checks every env var required for production and reports PASS / WARN / FAIL

set -a
[ -f /home/ubuntu/eddva_backend/.env ] && source /home/ubuntu/eddva_backend/.env
set +a

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
FAIL=0; WARN=0

pass() { echo -e "${GREEN}  ✅ PASS${NC}  $1"; }
warn() { echo -e "${YELLOW}  ⚠️  WARN${NC}  $1"; WARN=$((WARN+1)); }
fail() { echo -e "${RED}  ❌ FAIL${NC}  $1"; FAIL=$((FAIL+1)); }

required() {
  local key=$1 val="${!1}"
  if [ -z "$val" ]; then fail "$key is NOT SET — app will crash"; else pass "$key is set"; fi
}

should_not_be() {
  local key=$1 bad=$2 val="${!1}"
  if [ "$val" = "$bad" ]; then
    fail "$key=$val — DANGEROUS in production"
  else
    pass "$key is safe ($key=${val:-'(unset, default ok)'})"
  fi
}

optional() {
  local key=$1 default=$2 val="${!1}"
  if [ -z "$val" ]; then
    warn "$key not set — using default: $default"
  else
    pass "$key is set"
  fi
}

echo ""
echo "════════════════════════════════════════════"
echo "  PRODUCTION ENV AUDIT — $(date)"
echo "════════════════════════════════════════════"

echo ""
echo "── DATABASE ─────────────────────────────────"
required COACHING_DB_URL
required SCHOOL_DB_URL
should_not_be DB_SYNC true

echo ""
echo "── AUTH / JWT ───────────────────────────────"
required JWT_SECRET
required JWT_REFRESH_SECRET
optional SCHOOL_JWT_SECRET "(derived from JWT_SECRET — set explicitly)"

echo ""
echo "── SERVER ───────────────────────────────────"
[ "${PORT}" = "3000" ] && pass "PORT=3000" || fail "PORT=${PORT:-unset} — must be 3000 in production"
[ "${NODE_ENV}" = "production" ] && pass "NODE_ENV=production" || fail "NODE_ENV=${NODE_ENV:-unset} — must be production"

echo ""
echo "── OTP / MAIL (SECURITY CRITICAL) ──────────"
should_not_be OTP_DEV_MODE true
[ "${MAIL_DEV_MODE}" = "false" ] && pass "MAIL_DEV_MODE=false (emails will send)" || warn "MAIL_DEV_MODE=${MAIL_DEV_MODE:-unset} — emails are NOT being sent (default is true)"
optional MAIL_HOST "smtp.gmail.com"
optional MAIL_USER "(no sender configured)"
optional MAIL_PASS "(no sender configured)"

echo ""
echo "── LIVE STREAMING ───────────────────────────"
required RTMP_SECRET
optional STREAMING_SERVER_IP "13.127.31.213 (hardcoded default)"
optional LIVE_CDN_BASE_URL "(no CDN base — HLS playback will fail)"
optional LIVE_CDN_BASE_URL_480 "(no 480p CDN)"
optional LIVE_CDN_BASE_URL_360 "(no 360p CDN)"

echo ""
echo "── AI SERVICE ───────────────────────────────"
[ "${AI_BASE_URL}" = "http://localhost:8000" ] || [ -z "$AI_BASE_URL" ] && warn "AI_BASE_URL=${AI_BASE_URL:-localhost:8000} — is AI service on this server?" || pass "AI_BASE_URL=$AI_BASE_URL"
[ "${AI_API_KEY}" = "apexiq-dev-secret-key-2026" ] && warn "AI_API_KEY is using the dev default — change it" || pass "AI_API_KEY is set (non-default)"
optional NESTJS_INTERNAL_URL "http://localhost:3000 (AI usage logging)"

echo ""
echo "── STORAGE (AWS S3 / R2) ────────────────────"
optional AWS_ACCESS_KEY_ID "(uploads will fail)"
optional AWS_SECRET_ACCESS_KEY "(uploads will fail)"
optional S3_BUCKET_NAME "eddva-assets"
optional R2_ACCESS_KEY_ID "(live recordings to R2 will fail)"
optional R2_SECRET_ACCESS_KEY "(live recordings to R2 will fail)"
optional R2_PUBLIC_URL "https://media.apexiq.in"

echo ""
echo "── REDIS ────────────────────────────────────"
optional REDIS_HOST "localhost"
optional REDIS_PORT "6379"
optional REDIS_PASSWORD "(no password)"
[ -z "$REDIS_URL" ] && warn "REDIS_URL not set (needed by AI service deploy)" || pass "REDIS_URL is set"

echo ""
echo "── INTERNAL ─────────────────────────────────"
optional INTERNAL_API_KEY "(AI bridge auth)"

echo ""
echo "════════════════════════════════════════════"
echo -e "  ${RED}FAIL: $FAIL${NC}  ${YELLOW}WARN: $WARN${NC}"
echo "════════════════════════════════════════════"
echo ""

if [ $FAIL -gt 0 ]; then
  echo -e "${RED}❌ $FAIL critical issue(s) found — fix before deploying to production${NC}"
  exit 1
else
  echo -e "${GREEN}✅ No critical failures. $WARN warning(s) to review.${NC}"
fi
