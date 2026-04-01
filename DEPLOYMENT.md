# APEXIQ — EC2 Deployment Guide

> Single EC2 instance running NestJS backend + FastAPI AI service + PostgreSQL + Redis + Nginx.
> Estimated setup time: 45–60 minutes (first time).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [EC2 Instance Setup](#3-ec2-instance-setup)
4. [Server Provisioning](#4-server-provisioning)
5. [Clone Repositories](#5-clone-repositories)
6. [Configure Environment Variables](#6-configure-environment-variables)
7. [Build & Start All Services](#7-build--start-all-services)
8. [Run Database Migrations](#8-run-database-migrations)
9. [SSL Certificate (HTTPS)](#9-ssl-certificate-https)
10. [Verify Deployment](#10-verify-deployment)
11. [Updating / Redeploying](#11-updating--redeploying)
12. [Logs & Monitoring](#12-logs--monitoring)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Architecture Overview

```
Internet
    │
    ▼ :80 / :443
┌─────────────────────────────────────────────────────┐
│  EC2 Instance (t3.xlarge, Ubuntu 22.04)             │
│                                                     │
│  ┌──────────┐   proxy   ┌──────────────────────┐   │
│  │  Nginx   │──────────▶│  NestJS Backend :3000 │   │
│  └──────────┘           └──────────┬───────────┘   │
│                                    │ http://        │
│                                    │ ai-service:8000│
│                         ┌──────────▼───────────┐   │
│                         │  FastAPI AI  :8000    │   │
│                         └──────────────────────┘   │
│                                                     │
│  ┌──────────────────┐   ┌────────────────────────┐  │
│  │  PostgreSQL :5432│   │    Redis :6379          │  │
│  └──────────────────┘   └────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Key points:**
- Only ports 80/443 (Nginx) are publicly accessible.
- AI service is **internal only** — accessed by backend via Docker network as `http://ai-service:8000`.
- PostgreSQL and Redis are **internal only** — no host port binding.
- Uploads are stored in a named Docker volume; use Cloudflare R2 for production media.

---

## 2. Prerequisites

- AWS account with EC2 access
- A registered domain name (for SSL)
- DNS `A` record pointing your domain → EC2 public IP
- API credentials ready:
  - Groq API key
  - Google Gemini API key
  - Twilio SID + auth token
  - Firebase service account
  - Cloudflare R2 credentials
  - SerpAPI key (optional)

---

## 3. EC2 Instance Setup

### 3.1 Recommended Instance

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Instance  | t3.large (2 vCPU, 8 GB) | **t3.xlarge (4 vCPU, 16 GB)** |
| Storage   | 30 GB gp3 | **50 GB gp3** |
| OS        | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

> **Why xlarge?** The AI service installs PyTorch + EasyOCR + MediaPipe. The Docker image alone is ~3 GB; at runtime all services together use 6–10 GB RAM.

### 3.2 Launch via AWS Console

1. Go to **EC2 → Launch Instance**
2. Name: `apexiq-prod`
3. AMI: `Ubuntu Server 22.04 LTS (HVM)` (x86_64)
4. Instance type: `t3.xlarge`
5. Key pair: create or select an existing `.pem` key
6. Storage: **50 GB gp3**
7. Security group — add inbound rules:

| Type  | Port | Source    |
|-------|------|-----------|
| SSH   | 22   | Your IP   |
| HTTP  | 80   | 0.0.0.0/0 |
| HTTPS | 443  | 0.0.0.0/0 |

8. Click **Launch Instance**
9. Note the **Public IPv4 address**

### 3.3 Allocate Elastic IP (Recommended)

```
EC2 → Elastic IPs → Allocate → Associate → select apexiq-prod
```

This prevents the IP changing on instance restart.

---

## 4. Server Provisioning

SSH into the instance:

```bash
ssh -i /path/to/your-key.pem ubuntu@<EC2_PUBLIC_IP>
```

### 4.1 Update system

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

### 4.2 Install Docker

```bash
# Install Docker Engine
curl -fsSL https://get.docker.com | sudo sh

# Add ubuntu user to docker group (no sudo needed)
sudo usermod -aG docker ubuntu

# Apply group change — log out and back in, or run:
newgrp docker

# Verify
docker --version
docker compose version
```

### 4.3 Install Git

```bash
sudo apt-get install -y git
```

### 4.4 Install Certbot (for SSL later)

```bash
sudo apt-get install -y certbot
```

---

## 5. Clone Repositories

Both repos must be siblings under the same parent directory so that `docker-compose.prod.yml` can reference the AI service via relative path `../../AI_Study`.

```bash
cd /home/ubuntu

# Backend (this repo)
git clone https://github.com/<your-org>/apexiq-backend.git apexiq-backend
# or with SSH: git clone git@github.com:<your-org>/apexiq-backend.git apexiq-backend

# AI Service (separate repo)
git clone https://github.com/<your-org>/AI_Study.git AI_Study
# or with SSH: git clone git@github.com:<your-org>/AI_Study.git AI_Study
```

Resulting layout:
```
/home/ubuntu/
  apexiq-backend/
    apexiq/              ← backend source + docker-compose.prod.yml
  AI_Study/              ← AI service source + Dockerfile
```

---

## 6. Configure Environment Variables

All services read from a **single** `.env.prod` file placed in the backend directory.

```bash
cd /home/ubuntu/apexiq-backend/apexiq
cp .env.example .env.prod
nano .env.prod
```

Fill in every value below. **Never commit this file to git.**

```dotenv
# ── Database ──────────────────────────────────────────────────────────────────
DB_NAME=apexiq
DB_USERNAME=postgres
DB_PASSWORD=CHANGE_ME_STRONG_PASSWORD

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_PASSWORD=CHANGE_ME_REDIS_PASSWORD
REDIS_TTL=3600

# ── JWT ───────────────────────────────────────────────────────────────────────
JWT_SECRET=CHANGE_ME_64_CHAR_RANDOM_STRING
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=CHANGE_ME_64_CHAR_RANDOM_STRING_2
JWT_REFRESH_EXPIRES_IN=30d

# ── OTP ───────────────────────────────────────────────────────────────────────
OTP_EXPIRES_IN_SECONDS=300
OTP_LENGTH=6
# OTP_DEV_MODE is forced false in docker-compose.prod.yml

# ── Twilio ────────────────────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# ── Firebase ──────────────────────────────────────────────────────────────────
FIREBASE_PROJECT_ID=apexiq-app
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@apexiq-app.iam.gserviceaccount.com

# ── Cloudflare R2 (Media Storage) ─────────────────────────────────────────────
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=your_r2_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret
R2_BUCKET_NAME=apexiq-media
R2_PUBLIC_URL=https://media.yourdomain.com

# ── AI Service Internal API Key ────────────────────────────────────────────────
# Shared secret between backend and AI service
AI_API_KEY=CHANGE_ME_STRONG_AI_API_KEY
AI_TIMEOUT_MS=30000

# ── Groq (AI Service LLM) ─────────────────────────────────────────────────────
GROQ_API_KEY=gsk_your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
LLM_MODEL_FAST=llama-3.1-8b-instant
LLM_MODEL_BALANCED=llama-3.3-70b-versatile
LLM_MODEL_POWER=llama-3.3-70b-versatile

# ── Google Gemini (AI Service) ─────────────────────────────────────────────────
GEMINI_API_KEY=AIzaSy_your_gemini_api_key

# ── SerpAPI (AI Service) ──────────────────────────────────────────────────────
SERPAPI_KEY=your_serpapi_key

# ── Usage Limits ──────────────────────────────────────────────────────────────
USAGE_SOFT_CAP_TOKENS=500000
USAGE_HARD_CAP_TOKENS=1000000

# ── CORS (frontend URLs) ──────────────────────────────────────────────────────
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# ── Rate Limiting ─────────────────────────────────────────────────────────────
THROTTLE_TTL=60
THROTTLE_LIMIT=100
```

Generate strong secrets:
```bash
# Generate 64-char random string for JWT secrets
openssl rand -hex 32
```

### 6.1 Update Nginx domain

Edit `nginx/nginx.conf` and replace `api.yourdomain.com` with your actual domain:

```bash
nano /home/ubuntu/apexiq-backend/apexiq/nginx/nginx.conf
```

---

## 7. Build & Start All Services

```bash
cd /home/ubuntu/apexiq-backend/apexiq

# Pull latest base images
docker compose -f docker-compose.prod.yml --env-file .env.prod pull postgres redis nginx

# Build backend + AI service images (takes 10–20 min first time — AI image downloads PyTorch)
docker compose -f docker-compose.prod.yml --env-file .env.prod build --no-cache

# Start everything in detached mode
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Monitor startup progress:
```bash
docker compose -f docker-compose.prod.yml logs -f
```

Expected startup order (enforced by healthchecks):
```
postgres  → healthy (~15s)
redis     → healthy (~5s)
ai-service → healthy (~60-90s, downloads NLTK data on first run)
backend   → healthy (~30s)
nginx     → started
```

---

## 8. Run Database Migrations

Run once after first deploy (and again after each migration added):

```bash
# Run TypeORM migrations inside the backend container
docker compose -f docker-compose.prod.yml exec backend \
  node dist/node_modules/.bin/typeorm migration:run \
  -d dist/config/database.config.js
```

If the above path fails, use:
```bash
docker compose -f docker-compose.prod.yml exec backend \
  node -e "
    const { AppDataSource } = require('./dist/config/database.config');
    AppDataSource.initialize().then(() => AppDataSource.runMigrations()).then(() => {
      console.log('Migrations done'); process.exit(0);
    }).catch(e => { console.error(e); process.exit(1); });
  "
```

---

## 9. SSL Certificate (HTTPS)

### 9.1 Obtain certificate via Certbot (standalone)

Stop Nginx temporarily so Certbot can bind port 80:

```bash
docker compose -f docker-compose.prod.yml stop nginx

sudo certbot certonly --standalone \
  -d api.yourdomain.com \
  --email your@email.com \
  --agree-tos \
  --non-interactive
```

Certs are saved at:
```
/etc/letsencrypt/live/api.yourdomain.com/fullchain.pem
/etc/letsencrypt/live/api.yourdomain.com/privkey.pem
```

### 9.2 Mount certs into Nginx container

The `docker-compose.prod.yml` already mounts `/etc/letsencrypt` as `certbot_conf`.
Update `nginx/nginx.conf`:

1. In the HTTP server block: **uncomment** the redirect line and **comment out** the temp proxy block.
2. **Uncomment** the entire HTTPS `server {}` block.
3. Replace `api.yourdomain.com` with your actual domain.

```bash
nano /home/ubuntu/apexiq-backend/apexiq/nginx/nginx.conf
```

Restart Nginx:
```bash
docker compose -f docker-compose.prod.yml up -d nginx
```

### 9.3 Auto-renew SSL

```bash
# Test renewal
sudo certbot renew --dry-run

# Add cron for auto-renewal
echo "0 3 * * * root certbot renew --quiet && docker compose -f /home/ubuntu/apexiq-backend/apexiq/docker-compose.prod.yml restart nginx" \
  | sudo tee /etc/cron.d/certbot-renew
```

---

## 10. Verify Deployment

```bash
# All containers running
docker compose -f docker-compose.prod.yml ps

# Expected output:
# apexiq-postgres    running (healthy)
# apexiq-redis       running (healthy)
# apexiq-ai-service  running (healthy)
# apexiq-backend     running (healthy)
# apexiq-nginx       running
```

### 10.1 API health checks

```bash
# Backend health (via Nginx)
curl http://<EC2_IP>/api/v1

# Or with domain
curl https://api.yourdomain.com/api/v1

# AI service root (internal — from inside the backend container)
docker compose -f docker-compose.prod.yml exec backend \
  node -e "require('http').get('http://ai-service:8000', r => console.log(r.statusCode))"
```

### 10.2 WebSocket (Battle Arena)

Test Socket.io connection:
```
ws://api.yourdomain.com/battle
# or wss:// after SSL
```

---

## 11. Updating / Redeploying

### Update backend only

```bash
cd /home/ubuntu/apexiq-backend/apexiq
git pull origin main

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  build --no-cache backend

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d --no-deps backend

# Run new migrations (if any)
docker compose -f docker-compose.prod.yml exec backend \
  node dist/node_modules/.bin/typeorm migration:run -d dist/config/database.config.js
```

### Update AI service only

```bash
cd /home/ubuntu/AI_Study
git pull origin main

cd /home/ubuntu/apexiq-backend/apexiq
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  build --no-cache ai-service

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d --no-deps ai-service
```

### Update everything

```bash
cd /home/ubuntu/apexiq-backend/apexiq
git pull origin main

cd /home/ubuntu/AI_Study
git pull origin main

cd /home/ubuntu/apexiq-backend/apexiq
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  build --no-cache backend ai-service

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

---

## 12. Logs & Monitoring

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Single service
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f ai-service
docker compose -f docker-compose.prod.yml logs -f postgres

# Last 100 lines
docker compose -f docker-compose.prod.yml logs --tail=100 backend

# Resource usage
docker stats
```

### Set up log rotation (prevent disk fill)

```bash
sudo tee /etc/docker/daemon.json > /dev/null <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

sudo systemctl restart docker
```

### Disk usage check

```bash
df -h          # disk usage
docker system df   # Docker-specific usage
```

---

## 13. Troubleshooting

### Container won't start — check logs

```bash
docker compose -f docker-compose.prod.yml logs <service-name>
```

### AI service stuck at startup

The AI service downloads NLTK data and initialises EasyOCR on first run — this can take 2–3 minutes. Check:
```bash
docker compose -f docker-compose.prod.yml logs -f ai-service
```

### Backend can't reach AI service

Verify both are on the same network:
```bash
docker network inspect apexiq_internal
# Both backend and ai-service should appear under "Containers"
```

### Database migration fails

```bash
# Check DB is reachable
docker compose -f docker-compose.prod.yml exec backend \
  node -e "const { Client } = require('pg'); const c = new Client({host:'postgres',user:process.env.DB_USERNAME,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}); c.connect().then(() => { console.log('DB OK'); c.end(); }).catch(console.error);"
```

### Out of disk space

```bash
# Remove unused Docker images, build cache
docker system prune -f

# Remove unused volumes (CAUTION: don't remove named volumes with data)
docker volume prune -f
```

### Out of memory

Check available RAM:
```bash
free -h
```

If the AI service OOM-kills, it needs more RAM. Options:
1. Upgrade to `t3.xlarge` or `m5.large`
2. Reduce AI service workers from 2 to 1 in the Dockerfile CMD

### Restart all services cleanly

```bash
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

---

## Quick Reference

```bash
# Start
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# Stop
docker compose -f docker-compose.prod.yml down

# Restart one service
docker compose -f docker-compose.prod.yml restart backend

# Shell into backend
docker compose -f docker-compose.prod.yml exec backend sh

# Shell into AI service
docker compose -f docker-compose.prod.yml exec ai-service bash

# Shell into PostgreSQL
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d apexiq

# View all container statuses
docker compose -f docker-compose.prod.yml ps
```

---

## File Summary

| File | Location | Purpose |
|------|----------|---------|
| `Dockerfile` | `apexiq-backend/apexiq/` | NestJS multi-stage build |
| `.dockerignore` | `apexiq-backend/apexiq/` | Exclude node_modules, dist from build |
| `docker-compose.prod.yml` | `apexiq-backend/apexiq/` | Orchestrates all 5 services |
| `nginx/nginx.conf` | `apexiq-backend/apexiq/` | HTTP/HTTPS reverse proxy |
| `nginx/proxy_params.conf` | `apexiq-backend/apexiq/` | Shared proxy headers (WebSocket support) |
| `.env.prod` | `apexiq-backend/apexiq/` | **Production secrets** — never commit |
| `Dockerfile` | `AI_Study/` | FastAPI AI service image |
| `.dockerignore` | `AI_Study/` | Exclude venv, pycache, test data |
| `requirements.prod.txt` | `AI_Study/` | Slimmed production dependencies |
