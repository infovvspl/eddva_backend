# EDDVA Platform — Complete Deployment Guide

> **Stack:** NestJS (backend) · React/Vite (frontend) · Django (AI service)  
> **Domain:** `eddva.in`  
> **Infrastructure:** 2 × AWS EC2 on Ubuntu 22.04, PM2, Nginx, Let's Encrypt SSL  
> **CI/CD:** GitHub Actions (auto-deploy on every push to `main`)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites — Accounts & Tools](#2-prerequisites)
3. [EC2 Instances — Launch & Configure](#3-ec2-instances)
4. [Security Groups](#4-security-groups)
5. [Domain & DNS Setup](#5-domain--dns-setup)
6. [App Server Setup (Instance 1)](#6-app-server-setup-instance-1)
7. [AI Server Setup (Instance 2)](#7-ai-server-setup-instance-2)
8. [**Frontend Deployment — Complete Guide**](#8-frontend-deployment--complete-guide)
9. [Environment Variables Reference](#9-environment-variables-reference)
10. [SSL — HTTPS with Let's Encrypt](#10-ssl--https-with-lets-encrypt)
11. [GitHub Repositories & Secrets](#11-github-repositories--secrets)
12. [CI/CD Pipelines Explained](#12-cicd-pipelines-explained)
13. [First Manual Deploy (All 3 Services)](#13-first-manual-deploy-all-3-services)
14. [Post-Deploy Verification](#14-post-deploy-verification)
15. [Monitoring & Logs](#15-monitoring--logs)
16. [Rollback Procedure](#16-rollback-procedure)
17. [Cost Estimate](#17-cost-estimate)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET / USERS                        │
└────────────────────┬──────────────────────┬─────────────────────┘
                     │                      │
          eddva.in   │          api.eddva.in│
          (HTTPS 443)│          (HTTPS 443) │
                     ▼                      ▼
┌────────────────────────────────────────────────────────────────┐
│               INSTANCE 1  —  App Server  (t3.small)            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      NGINX                              │   │
│  │  eddva.in  ──►  /var/www/eddva-frontend/dist  (static)  │   │
│  │  api.eddva.in  ──►  localhost:3000  (proxy)             │   │
│  └─────────────────────────────┬───────────────────────────┘   │
│                                 │                               │
│  ┌──────────────────────────────▼──────────────────────────┐   │
│  │           PM2 — NestJS Backend   (port 3000)            │   │
│  │           2 × cluster instances, auto-restart           │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                                      │  AI calls (port 8000)
                                      │  via PRIVATE IP
                                      ▼
┌────────────────────────────────────────────────────────────────┐
│               INSTANCE 2  —  AI Server  (t3.medium)            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │       PM2 — Django/Gunicorn  (port 8000)                │   │
│  │       3 × workers, 120s timeout                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                     │                      │
            PostgreSQL│              Cloudflare R2
            (Supabase)│              (media files)
```

### Service Port Map

| Service | Server | Port | Public URL |
|---|---|---|---|
| React Frontend | Instance 1 / Nginx | 80/443 | `https://eddva.in` |
| NestJS API | Instance 1 / Nginx proxy | 3000 (internal) | `https://api.eddva.in` |
| Django AI | Instance 2 | 8000 (private only) | No public domain |
| PostgreSQL | Supabase (external) | 5432 | Supabase pooler URL |

---

## 2. Prerequisites

### Accounts you need

| What | Where | Used for |
|---|---|---|
| AWS Account | aws.amazon.com | EC2 instances |
| GitHub Account | github.com | Code hosting + CI/CD |
| Supabase Account | supabase.com | PostgreSQL database (already set up) |
| Cloudflare R2 Account | cloudflare.com | Media file storage (PDF, video, images) |
| Domain `eddva.in` | Your registrar | DNS management |
| Groq API Key | console.groq.com | AI LLM inference (fast, free tier available) |
| Razorpay Account | razorpay.com | Payments |
| Agora Account | console.agora.io | Live classes / video |
| Firebase Project | console.firebase.google.com | Push notifications |
| Twilio Account | twilio.com | SMS OTP |

### Tools on your local machine

```bash
# You just need:
# 1. SSH client (built into Mac/Linux/Windows terminal)
# 2. Git (to push code)
# 3. A text editor to fill in secrets
```

---

## 3. EC2 Instances

### 3.1 Launch Instance 1 — App Server

1. Go to **AWS Console → EC2 → Launch Instance**
2. Fill in:
   - **Name:** `eddva-app-server`
   - **AMI:** Ubuntu Server 22.04 LTS (HVM), SSD — `ami-0xxxxx` (choose the latest in ap-south-1)
   - **Instance type:** `t3.small` (2 vCPU, 2 GB RAM)
   - **Key pair:** Create new → name it `eddva-key` → download `eddva-key.pem` → **keep this safe, you cannot re-download it**
   - **Network settings:**
     - Allow SSH from your IP (or 0.0.0.0/0 for now, tighten later)
     - Allow HTTP (port 80) from anywhere
     - Allow HTTPS (port 443) from anywhere
   - **Storage:** 20 GB gp3 (sufficient for code + logs)
3. Click **Launch Instance**
4. Note the **Public IPv4 address** — e.g. `13.233.XX.XX`

### 3.2 Launch Instance 2 — AI Server

Repeat but with:
- **Name:** `eddva-ai-server`
- **Instance type:** `t3.medium` (2 vCPU, 4 GB RAM) — AI needs more RAM for Whisper and LLM
- **Same key pair:** `eddva-key` (reuse it)
- **Network settings:**
  - Allow SSH from your IP
  - **Do NOT add HTTP/HTTPS** — AI server is private
  - Add custom TCP rule: port 8000, source = **App Server private IP** (set this after both instances are up)
- **Storage:** 30 GB gp3 (ML libraries are large)

### 3.3 Save your IPs

After both instances are running, note:

```
APP_SERVER_PUBLIC_IP   = 13.233.XX.XX     (for your browser, DNS, SSH)
APP_SERVER_PRIVATE_IP  = 172.31.XX.XX     (for AI server security group rule)
AI_SERVER_PUBLIC_IP    = 15.206.XX.XX     (for SSH only)
AI_SERVER_PRIVATE_IP   = 172.31.YY.YY    (NestJS calls this for AI)
```

> **Where to find private IP:** EC2 console → click the instance → look for "Private IPv4 address"

### 3.4 Fix the SSH key permissions (Mac/Linux)

```bash
chmod 400 ~/Downloads/eddva-key.pem
```

### 3.5 Test SSH access

```bash
# Test App Server
ssh -i ~/Downloads/eddva-key.pem ubuntu@13.233.XX.XX

# Test AI Server
ssh -i ~/Downloads/eddva-key.pem ubuntu@15.206.XX.XX
```

You should get an Ubuntu welcome message. Type `exit` to leave.

---

## 4. Security Groups

### App Server Security Group

| Type | Protocol | Port | Source | Purpose |
|---|---|---|---|---|
| SSH | TCP | 22 | Your IP / 0.0.0.0 | Admin access |
| HTTP | TCP | 80 | 0.0.0.0/0 | HTTP (Nginx) |
| HTTPS | TCP | 443 | 0.0.0.0/0 | HTTPS (Nginx + SSL) |

### AI Server Security Group

| Type | Protocol | Port | Source | Purpose |
|---|---|---|---|---|
| SSH | TCP | 22 | Your IP | Admin access |
| Custom TCP | TCP | 8000 | App Server Private IP | NestJS → Django AI calls |

> **How to add the 8000 rule:** EC2 → Security Groups → AI server's security group → Inbound rules → Edit → Add rule → Type: Custom TCP, Port: 8000, Source: (App Server private IP)/32

---

## 5. Domain & DNS Setup

You own `eddva.in`. Add these DNS **A records** in your domain registrar or Cloudflare:

| Record Type | Name | Value | TTL |
|---|---|---|---|
| A | `eddva.in` | `13.233.XX.XX` (App Server public IP) | 300 |
| A | `www` | `13.233.XX.XX` | 300 |
| A | `api` | `13.233.XX.XX` | 300 |

> **Note:** DNS changes take 5–30 minutes to propagate. You can check with `nslookup eddva.in`

**The AI server gets no domain** — it's accessed only by the NestJS backend via its private IP.

---

## 6. App Server Setup (Instance 1)

SSH into the App Server and run these commands **one by one**. This is a one-time setup.

### 6.1 Update the system

```bash
ssh -i ~/Downloads/eddva-key.pem ubuntu@13.233.XX.XX

sudo apt-get update -y && sudo apt-get upgrade -y
```

### 6.2 Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should print v20.x.x
npm --version    # should print 10.x.x
```

### 6.3 Install PM2 globally

```bash
sudo npm install -g pm2

# Make PM2 start automatically on server reboot
sudo pm2 startup systemd -u ubuntu --hp /home/ubuntu
# ↑ This prints a command — RUN THAT COMMAND. It looks like:
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

### 6.4 Install and configure Nginx

```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 6.5 Install Certbot (for SSL)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

### 6.6 Configure firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'    # opens ports 80 and 443
sudo ufw --force enable
sudo ufw status                 # should show SSH, Nginx Full as ALLOW
```

### 6.7 Create Nginx config files

```bash
# Frontend config (eddva.in)
sudo nano /etc/nginx/sites-available/eddva-frontend
```

Paste this exactly:

```nginx
server {
    listen 80;
    server_name eddva.in www.eddva.in;

    root /var/www/eddva-frontend/dist;
    index index.html;

    # React SPA — all client-side routes go to index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Aggressive cache for built assets (Vite adds content hash to filenames)
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf|webp)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript image/svg+xml;
}
```

```bash
# API config (api.eddva.in)
sudo nano /etc/nginx/sites-available/eddva-api
```

Paste this exactly:

```nginx
upstream nestjs {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name api.eddva.in;

    # Allow large file uploads (videos, PDFs)
    client_max_body_size 2G;
    proxy_read_timeout    300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout    300s;

    # REST API
    location /api {
        proxy_pass         http://nestjs;
        proxy_http_version 1.1;
        proxy_set_header   Connection '';
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Socket.IO — live classes and battle arena WebSocket
    location /socket.io {
        proxy_pass         http://nestjs;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;  # keep WS alive for 24h
    }

    # Battle arena WebSocket
    location /battle {
        proxy_pass         http://nestjs;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
    }

    # Swagger docs (remove this block in production if you want)
    location /docs {
        proxy_pass         http://nestjs;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
    }
}
```

### 6.8 Enable Nginx configs

```bash
sudo ln -sf /etc/nginx/sites-available/eddva-frontend /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/eddva-api       /etc/nginx/sites-enabled/

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test config — must say "syntax is ok" and "test is successful"
sudo nginx -t

# Apply
sudo systemctl reload nginx
```

### 6.9 Create app directories

```bash
sudo mkdir -p /var/www/eddva-frontend/dist
sudo chown -R ubuntu:ubuntu /var/www/eddva-frontend
mkdir -p /home/ubuntu/apexiq-backend
mkdir -p /home/ubuntu/logs
```

### 6.10 Clone the backend repo

```bash
cd /home/ubuntu
git clone https://github.com/infovvspl/apexiq-backend.git apexiq-backend
```

> If the repo is private, you'll need to set up a **Deploy Key**. See [Section 10.2](#102-deploy-keys-for-private-repos).

---

## 7. AI Server Setup (Instance 2)

SSH into the AI Server:

```bash
ssh -i ~/Downloads/eddva-key.pem ubuntu@15.206.XX.XX
```

### 7.1 Update system and install Python 3.11 + system libraries

```bash
sudo apt-get update -y && sudo apt-get upgrade -y

sudo apt-get install -y \
  python3.11 python3.11-venv python3.11-dev python3-pip \
  build-essential git \
  libglib2.0-0 libsm6 libxrender1 libxext6 libgl1 \
  poppler-utils libpoppler-dev \
  portaudio19-dev libsndfile1 ffmpeg \
  curl

# Confirm Python version
python3.11 --version   # should print Python 3.11.x
```

### 7.2 Install Node.js + PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
sudo pm2 startup systemd -u ubuntu --hp /home/ubuntu
# ↑ Run the command it prints
```

### 7.3 Configure firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow from 172.31.XX.XX to any port 8000   # ← App Server PRIVATE IP
sudo ufw --force enable
```

> Replace `172.31.XX.XX` with the **App Server's private IP**

### 7.4 Create directories

```bash
mkdir -p /home/ubuntu/ai-service
mkdir -p /home/ubuntu/ai-service/data/uploads
mkdir -p /home/ubuntu/logs
```

### 7.5 Clone the AI repo

```bash
git clone https://github.com/infovvspl/AI_Study.git /home/ubuntu/ai-service
```

### 7.6 Set up Python virtual environment

```bash
cd /home/ubuntu/ai-service
python3.11 -m venv venv

# Activate venv
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install production dependencies (this takes 3–5 minutes)
pip install -r requirements.prod.txt

# Specifically install gunicorn (production WSGI server)
pip install gunicorn

deactivate
```

### 7.7 Create the .env file

```bash
nano /home/ubuntu/ai-service/.env
```

Paste and fill in (see [Section 8.3](#83-ai-service-env) for all values):

```env
GROQ_API_KEY=gsk_your_key_here
GEMINI_API_KEY=AIzaSy_your_key_here
SERPAPI_KEY=your_serpapi_key
OLLAMA_URL=http://213.192.2.90:40077
OLLAMA_MODEL=edvav2
WHISPER_MODEL=base
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
DJANGO_SECRET_KEY=generate-a-50-char-random-string-here
DJANGO_DEBUG=false
ALLOWED_HOSTS=172.31.XX.XX,localhost,127.0.0.1
AI_API_KEY=same-key-as-nestjs-AI_API_KEY
DB_ENGINE=django.db.backends.postgresql
DB_NAME=postgres
DB_USER=postgres.utiqzdnyrrprcdghqkgv
DB_PASSWORD=your-supabase-password
DB_HOST=aws-1-ap-south-1.pooler.supabase.com
DB_PORT=5432
```

### 7.8 Run Django migrations

```bash
cd /home/ubuntu/ai-service
source venv/bin/activate
python manage.py migrate --noinput
python manage.py collectstatic --noinput
deactivate
```

### 7.9 Start AI service with PM2

```bash
cd /home/ubuntu/ai-service
pm2 start deploy/ecosystem.config.js
pm2 save

# Confirm it's running
pm2 status
# Should show: ai-service | online
```

### 7.10 Test it locally on AI server

```bash
curl http://localhost:8000/api/v1/notes/health/
# Should return: {"status": "ok"} or similar
```

---

## 8. Frontend Deployment — Complete Guide

> The frontend is a **static site** after build. `npm run build` produces a `dist/` folder of plain HTML, JS, and CSS. Nginx on **Instance 1 (App Server)** serves those files directly — no Node.js process, no PM2 needed for the frontend.

### 8.1 How it works

```text
Your code (eddva_frontend repo)
        │
        │  npm run build
        ▼
    dist/
    ├── index.html
    ├── assets/
    │   ├── index-Bx92Ka3.js      ← all JS bundled + content-hashed
    │   ├── index-D3kPq1.css      ← all CSS bundled + content-hashed
    │   └── ...images, fonts
        │
        │  scp dist/ → EC2
        ▼
Instance 1: /var/www/eddva-frontend/dist/
        │
        │  Nginx reads files from disk
        ▼
https://eddva.in   ← users see the app
```

### 8.2 One-time directory setup on Instance 1

SSH into the App Server and run once:

```bash
ssh -i ~/Downloads/eddva-key.pem ubuntu@<APP_SERVER_PUBLIC_IP>

# Create the directory Nginx will serve from
sudo mkdir -p /var/www/eddva-frontend/dist

# Give your ubuntu user write access (CI/CD needs to scp files here)
sudo chown -R ubuntu:ubuntu /var/www/eddva-frontend
```

### 8.3 Nginx config for the frontend

The config was created in Section 6.7. Verify it exists:

```bash
sudo cat /etc/nginx/sites-available/eddva-frontend
```

It must contain:

```nginx
server {
    listen 80;
    server_name eddva.in www.eddva.in;

    root /var/www/eddva-frontend/dist;
    index index.html;

    # React SPA — all routes (e.g. /student/dashboard) must fall back to index.html
    # Without this, refreshing any page gives 404
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Long-term cache for Vite's content-hashed assets
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf|webp)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript image/svg+xml;
}
```

Confirm it is enabled:

```bash
ls -la /etc/nginx/sites-enabled/
# Must show: eddva-frontend -> /etc/nginx/sites-available/eddva-frontend

# If missing, enable it:
sudo ln -sf /etc/nginx/sites-available/eddva-frontend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 8.4 Frontend environment variables

The React app reads variables starting with `VITE_` at **build time** — they are baked into the JS bundle. They are **not** read at runtime from a `.env` file on the server.

Create `.env.production` in the `eddva_frontend` root **on your local machine** (or let CI create it from GitHub Secrets):

```env
# Points the app at the production API
VITE_API_BASE_URL=https://api.eddva.in/api/v1
VITE_SOCKET_URL=https://api.eddva.in

# Agora App ID for live classes — must match backend AGORA_APP_ID
VITE_AGORA_APP_ID=3d96e2d23e1e48348e5a20934a884701

# Sarvam AI speech API key
VITE_SARVAM_API_KEY=sk_your_sarvam_key_here
```

> **Important:** Never commit `.env.production` to git. The CI pipeline creates it from GitHub Secrets on every deploy.

### 8.5 Build the frontend

```bash
# On your LOCAL machine (or CI runner)
cd /path/to/eddva_frontend

# Install dependencies
npm ci

# Build for production — reads .env.production automatically
npm run build

# dist/ folder is created. Check it:
ls dist/
# index.html   assets/   ...
```

The build takes about 30–60 seconds. When done, `dist/` is ~2–5 MB of static files.

### 8.6 Manual deploy — upload dist/ to the server

```bash
# From your LOCAL machine, upload the dist/ folder to Instance 1
scp -i ~/Downloads/eddva-key.pem -r dist/ ubuntu@<APP_SERVER_PUBLIC_IP>:/var/www/eddva-frontend/

# This copies dist/ INTO /var/www/eddva-frontend/ so the result is:
# /var/www/eddva-frontend/dist/index.html   ✓

# Reload Nginx to pick up new files
ssh -i ~/Downloads/eddva-key.pem ubuntu@<APP_SERVER_PUBLIC_IP> "sudo systemctl reload nginx"
```

**Verify it works:**

```bash
curl -I https://eddva.in
# Expected: HTTP/2 200

# Open in browser: https://eddva.in
```

### 8.7 Automatic deploy via GitHub Actions (CI/CD)

After adding GitHub Secrets (Section 11), every push to `main` on the `eddva_frontend` repo will:

1. Spin up a GitHub-hosted Ubuntu runner
2. Run `npm ci` and `npm run build` with the production env vars injected from Secrets
3. SCP the `dist/` folder directly to `/var/www/eddva-frontend/` on Instance 1
4. SSH in and run `sudo systemctl reload nginx`

The workflow file is at `eddva_frontend/.github/workflows/deploy.yml`. No PM2 involved at any point.

### 8.8 Frontend Nginx sudo permission

The CI pipeline needs to run `sudo systemctl reload nginx` without a password prompt. Grant it once on the App Server:

```bash
ssh -i ~/Downloads/eddva-key.pem ubuntu@<APP_SERVER_PUBLIC_IP>

# Allow ubuntu user to reload nginx without sudo password
echo "ubuntu ALL=(ALL) NOPASSWD: /usr/sbin/nginx, /bin/systemctl reload nginx, /bin/systemctl restart nginx" \
  | sudo tee /etc/sudoers.d/nginx-reload

sudo chmod 440 /etc/sudoers.d/nginx-reload
```

### 8.9 Verify the full frontend flow end-to-end

```bash
# 1. Homepage loads
curl -s -o /dev/null -w "%{http_code}" https://eddva.in
# Expected: 200

# 2. React routes work (refresh on a deep page should NOT 404)
curl -s -o /dev/null -w "%{http_code}" https://eddva.in/student/dashboard
# Expected: 200  (Nginx serves index.html, React Router handles the route)

# 3. API calls from browser work (check browser DevTools Network tab)
# GET https://api.eddva.in/api/v1  → should return JSON, not CORS error

# 4. Correct JS bundle is loaded (no old cached version)
# Hard-refresh browser: Ctrl+Shift+R
```

### 8.10 What to do if frontend shows a blank page after deploy

```bash
# SSH into App Server and check:
ssh ubuntu@<APP_SERVER_PUBLIC_IP>

# 1. Are the files actually there?
ls /var/www/eddva-frontend/dist/
# Must show: index.html  assets/  ...

# 2. Is Nginx pointing at the right path?
sudo cat /etc/nginx/sites-available/eddva-frontend | grep root
# Must show: root /var/www/eddva-frontend/dist;

# 3. Any Nginx errors?
sudo tail -20 /var/log/nginx/error.log

# 4. Check browser console for errors
# Usually: VITE_API_BASE_URL is wrong → API calls failing → app crashes
```

---

## 9. Environment Variables Reference

### 9.1 NestJS Backend `.env`

Create this file at `/home/ubuntu/apexiq-backend/.env` on the App Server:

```env
# ── App ──────────────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
API_PREFIX=api/v1

# ── Database (Supabase PostgreSQL) ────────────────────────────────────────────
# Get from: Supabase Dashboard → Settings → Database → Connection string
DB_HOST=aws-1-ap-south-1.pooler.supabase.com
DB_PORT=5432
DB_USERNAME=postgres.utiqzdnyrrprcdghqkgv     # your actual supabase username
DB_PASSWORD=your-actual-supabase-password
DB_NAME=postgres
DB_SSL=true
DB_SYNC=false         # NEVER true in production — use migrations
DB_LOGGING=false

# ── Redis ─────────────────────────────────────────────────────────────────────
# If you have no Redis, leave as localhost — the app falls back to in-memory cache
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TTL=3600

# ── JWT ───────────────────────────────────────────────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=generate-a-64-char-random-hex-string
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=generate-a-different-64-char-random-hex-string
JWT_REFRESH_EXPIRES_IN=30d

# ── OTP ───────────────────────────────────────────────────────────────────────
OTP_EXPIRES_IN_SECONDS=300
OTP_LENGTH=6
OTP_DEV_MODE=false          # false = real SMS goes out via Twilio

# ── Twilio (SMS OTP & WhatsApp) ───────────────────────────────────────────────
# Get from: twilio.com → Console → Account Info
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# ── Firebase (Push Notifications) ────────────────────────────────────────────
# Get from: Firebase Console → Project Settings → Service Accounts → Generate new private key
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_LONG_KEY_HERE\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com

# ── Cloudflare R2 (Media Storage) ────────────────────────────────────────────
# Get from: Cloudflare Dashboard → R2 → Manage R2 API Tokens
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=apexiq-media
R2_PUBLIC_URL=https://media.eddva.in         # your R2 custom domain or public bucket URL

# ── AI Service ────────────────────────────────────────────────────────────────
# AI_BASE_URL = AI Server's PRIVATE IP (not public IP, not domain)
AI_BASE_URL=http://172.31.YY.YY:8000         # ← AI Server private IP
AI_API_KEY=apexiq-dev-secret-key-2026        # must match AI_API_KEY in AI service .env
AI_TIMEOUT_MS=60000                          # 60s timeout for AI calls

# ── Razorpay (Payments) ───────────────────────────────────────────────────────
# Get from: Razorpay Dashboard → Settings → API Keys
# Use rzp_live_... keys in production
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_razorpay_secret

# ── Rate Limiting ─────────────────────────────────────────────────────────────
THROTTLE_TTL=60
THROTTLE_LIMIT=200

# ── Agora (Live Classes) ──────────────────────────────────────────────────────
# Get from: console.agora.io → Your Project → App ID and App Certificate
AGORA_APP_ID=3d96e2d23e1e48348e5a20934a884701
AGORA_APP_CERTIFICATE=your_agora_certificate_if_using_token_security

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_ORIGINS=https://eddva.in,https://www.eddva.in,https://cds.eddva.in
```

### 9.2 React Frontend `.env.production`

This file is **created by the CI pipeline** from GitHub Secrets. For local builds:

```env
VITE_API_BASE_URL=https://api.eddva.in/api/v1
VITE_SOCKET_URL=https://api.eddva.in
VITE_AGORA_APP_ID=3d96e2d23e1e48348e5a20934a884701
VITE_SARVAM_API_KEY=sk_your_sarvam_key_here
```

### 9.3 Django AI Service `.env`

```env
# ── LLM API Keys ──────────────────────────────────────────────────────────────
# Groq: console.groq.com → API Keys (fast inference, free tier)
GROQ_API_KEY=gsk_your_groq_key_here

# Google Gemini: console.cloud.google.com → API & Services → Credentials
GEMINI_API_KEY=AIzaSy_your_gemini_key_here

# SerpAPI: serpapi.com → Dashboard → API Key (for web search in AI features)
SERPAPI_KEY=your_serpapi_key_here

# ── Ollama (your custom edvaqwen model on RunPod) ─────────────────────────────
OLLAMA_URL=http://213.192.2.90:40077
OLLAMA_MODEL=edvav2

# ── Whisper (audio transcription) ────────────────────────────────────────────
# base = good balance of speed and accuracy on CPU
WHISPER_MODEL=base
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

# ── Django ────────────────────────────────────────────────────────────────────
# Generate: python -c "import secrets; print(secrets.token_urlsafe(50))"
DJANGO_SECRET_KEY=your-generated-50-char-secret-key

DJANGO_DEBUG=false

# Add both the private IP and public IP of the AI server
ALLOWED_HOSTS=172.31.YY.YY,15.206.XX.XX,localhost,127.0.0.1

# The key NestJS sends in Authorization: Bearer <key>
# Must match AI_API_KEY in NestJS .env
AI_API_KEY=apexiq-dev-secret-key-2026

# ── Database (same Supabase as backend, or a separate DB) ────────────────────
DB_ENGINE=django.db.backends.postgresql
DB_NAME=postgres
DB_USER=postgres.utiqzdnyrrprcdghqkgv
DB_PASSWORD=your-supabase-password
DB_HOST=aws-1-ap-south-1.pooler.supabase.com
DB_PORT=5432
```

---

## 10. SSL — HTTPS with Let's Encrypt

**Do this after DNS has propagated** (verify: `nslookup eddva.in` returns your App Server IP).

SSH into the App Server:

```bash
ssh -i ~/Downloads/eddva-key.pem ubuntu@13.233.XX.XX

# Issue certificates for all domains at once
sudo certbot --nginx -d eddva.in -d www.eddva.in -d api.eddva.in

# Follow prompts:
# - Enter your email (for expiry reminders)
# - Agree to Terms of Service: Y
# - Share email with EFF: N (up to you)
# - Choose to redirect HTTP to HTTPS: 2 (Redirect)
```

Certbot automatically:
- Gets a free 90-day SSL certificate
- Edits your Nginx configs to add HTTPS
- Sets up auto-renewal (runs twice a day via cron)

**Verify renewal works:**

```bash
sudo certbot renew --dry-run
# Should say: "Congratulations, all renewals succeeded"
```

---

## 11. GitHub Repositories & Secrets

### 10.1 Add GitHub Secrets

For each repo, go to: **GitHub → Repository → Settings → Secrets and variables → Actions → New repository secret**

#### Secrets needed in the Backend repo (`apexiq-backend`)

| Secret Name | Value |
|---|---|
| `APP_SERVER_HOST` | `13.233.XX.XX` (App Server public IP) |
| `APP_SERVER_SSH_KEY` | Full contents of `eddva-key.pem` (including `-----BEGIN...` lines) |
| `DB_HOST` | `aws-1-ap-south-1.pooler.supabase.com` |
| `DB_PORT` | `5432` |
| `DB_USERNAME` | `postgres.utiqzdnyrrprcdghqkgv` |
| `DB_PASSWORD` | Your Supabase password |
| `DB_NAME` | `postgres` |
| `JWT_SECRET` | 64-char random hex |
| `JWT_REFRESH_SECRET` | Different 64-char random hex |
| `AI_BASE_URL` | `http://172.31.YY.YY:8000` (AI Server private IP) |
| `AI_API_KEY` | `apexiq-dev-secret-key-2026` (or your key) |
| `R2_ACCOUNT_ID` | Your Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Your R2 access key |
| `R2_SECRET_ACCESS_KEY` | Your R2 secret key |
| `R2_BUCKET_NAME` | `apexiq-media` |
| `R2_PUBLIC_URL` | `https://media.eddva.in` |
| `RAZORPAY_KEY_ID` | `rzp_live_xxxx` |
| `RAZORPAY_KEY_SECRET` | Your Razorpay secret |
| `AGORA_APP_ID` | Your Agora App ID |
| `AGORA_APP_CERTIFICATE` | Your Agora App Certificate |
| `FIREBASE_PROJECT_ID` | Your Firebase project ID |
| `FIREBASE_PRIVATE_KEY` | The full private key with newlines |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email |

#### Secrets needed in the Frontend repo (`eddva_frontend`)

| Secret Name | Value |
|---|---|
| `APP_SERVER_HOST` | `13.233.XX.XX` |
| `APP_SERVER_SSH_KEY` | Same `eddva-key.pem` contents |
| `VITE_AGORA_APP_ID` | Same Agora App ID |
| `VITE_SARVAM_API_KEY` | Your Sarvam API key |

#### Secrets needed in the AI repo (`AI_Study`)

| Secret Name | Value |
|---|---|
| `AI_SERVER_HOST` | `15.206.XX.XX` (AI Server public IP) |
| `AI_SERVER_SSH_KEY` | Same `eddva-key.pem` contents |
| `GROQ_API_KEY` | Your Groq API key |
| `GEMINI_API_KEY` | Your Google Gemini API key |
| `SERPAPI_KEY` | Your SerpAPI key |
| `DJANGO_SECRET_KEY` | 50-char random string |
| `AI_ALLOWED_HOSTS` | `172.31.YY.YY,15.206.XX.XX,localhost,127.0.0.1` |
| `AI_API_KEY` | Same key as NestJS `AI_API_KEY` |
| `AI_DB_ENGINE` | `django.db.backends.postgresql` |
| `AI_DB_NAME` | `postgres` |
| `AI_DB_USER` | `postgres.utiqzdnyrrprcdghqkgv` |
| `AI_DB_PASSWORD` | Your Supabase password |
| `AI_DB_HOST` | `aws-1-ap-south-1.pooler.supabase.com` |
| `AI_DB_PORT` | `5432` |

### 10.2 Deploy Keys for Private Repos

If your repos are private, each EC2 instance needs a deploy key:

```bash
# On App Server — generate key
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub   # Copy this

# On AI Server — generate key
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub   # Copy this
```

Then in each GitHub repo: **Settings → Deploy keys → Add deploy key** → paste the public key.

Configure SSH to use it:

```bash
# On each server
cat >> ~/.ssh/config <<'EOF'
Host github.com
    IdentityFile ~/.ssh/deploy_key
    IdentitiesOnly yes
EOF
```

---

## 12. CI/CD Pipelines Explained

### What happens when you push to `main`

```
git push origin main
       │
       ▼
GitHub Actions triggers 3 parallel workflows:
  │
  ├── Backend (apexiq-backend/.github/workflows/deploy.yml)
  │     1. Runner installs Node 20
  │     2. npm ci + npm run build   ← verifies build before SSH
  │     3. SSH into App Server
  │     4. Writes .env from GitHub Secrets
  │     5. git pull + npm ci + npm build
  │     6. pm2 reload (zero-downtime cluster reload)
  │
  ├── Frontend (eddva_frontend/.github/workflows/deploy.yml)
  │     1. Runner installs Node 20
  │     2. Creates .env.production from secrets
  │     3. npm ci + npm run build
  │     4. SCP dist/ → App Server /var/www/eddva-frontend/
  │     5. SSH → sudo nginx reload
  │
  └── AI Service (AI_Study/.github/workflows/deploy.yml)
        1. SSH into AI Server
        2. Writes .env from GitHub Secrets
        3. git pull
        4. pip install -r requirements.prod.txt
        5. python manage.py migrate
        6. pm2 restart ai-service
```

### Workflow files location

```
apexiq-backend/.github/workflows/deploy.yml
eddva_frontend/.github/workflows/deploy.yml
AI_Study/.github/workflows/deploy.yml
```

---

## 13. First Manual Deploy (All 3 Services)

**Before CI/CD is configured, deploy manually once to make sure everything works.**

### 12.1 Deploy Backend

```bash
ssh -i ~/Downloads/eddva-key.pem ubuntu@13.233.XX.XX

cd /home/ubuntu/apexiq-backend

# Create .env (fill with your actual values from Section 8.1)
nano .env

# Install and build
npm ci --omit=dev
npm run build

# Start with PM2
pm2 start deploy/ecosystem.config.js --env production
pm2 save

# Verify it started
pm2 status
# Should show: apexiq-backend │ online │ 2 instances

# Test the API
curl http://localhost:3000/api/v1
# Should return some JSON response
```

### 12.2 Deploy Frontend

```bash
# On YOUR LOCAL MACHINE — build the frontend
cd /path/to/eddva_frontend

# Create .env.production
cat > .env.production <<EOF
VITE_API_BASE_URL=https://api.eddva.in/api/v1
VITE_SOCKET_URL=https://api.eddva.in
VITE_AGORA_APP_ID=3d96e2d23e1e48348e5a20934a884701
VITE_SARVAM_API_KEY=sk_your_key
EOF

npm ci
npm run build     # creates the dist/ folder

# Upload dist/ to the server
scp -i ~/Downloads/eddva-key.pem -r dist/ ubuntu@13.233.XX.XX:/var/www/eddva-frontend/

# Reload Nginx
ssh -i ~/Downloads/eddva-key.pem ubuntu@13.233.XX.XX "sudo systemctl reload nginx"
```

### 12.3 Verify AI Service is running

```bash
ssh -i ~/Downloads/eddva-key.pem ubuntu@15.206.XX.XX
pm2 status
# Should show: ai-service │ online

# From the App Server — test that NestJS can reach AI
ssh -i ~/Downloads/eddva-key.pem ubuntu@13.233.XX.XX
curl http://172.31.YY.YY:8000/api/v1/notes/health/
```

---

## 14. Post-Deploy Verification

### Checklist after every deploy

```bash
# 1. Is the website loading?
curl -I https://eddva.in
# Expected: HTTP/2 200

# 2. Is the API responding?
curl https://api.eddva.in/api/v1
# Expected: JSON with success: true or similar

# 3. Are PM2 processes running?
ssh ubuntu@13.233.XX.XX "pm2 status"
# Expected: apexiq-backend | online | 2 instances

ssh ubuntu@15.206.XX.XX "pm2 status"
# Expected: ai-service | online

# 4. Is Nginx healthy?
ssh ubuntu@13.233.XX.XX "sudo nginx -t"
# Expected: syntax is ok / test is successful

# 5. Any errors in logs?
ssh ubuntu@13.233.XX.XX "pm2 logs apexiq-backend --lines 50 --nostream"
ssh ubuntu@15.206.XX.XX "pm2 logs ai-service --lines 50 --nostream"
```

### Test a real API call

```bash
# Try the health or public endpoint
curl https://api.eddva.in/api/v1

# Expected response (may vary):
# {"success":true,"statusCode":200,"message":"Welcome to APEXIQ API"}
```

---

## 15. Monitoring & Logs

### Real-time process monitoring

```bash
# Connect to any server and run:
pm2 monit
# Shows live CPU %, RAM, restart count for all processes
```

### View logs

```bash
# All logs (live tail)
pm2 logs

# Backend only (last 100 lines)
pm2 logs apexiq-backend --lines 100

# AI service only
pm2 logs ai-service --lines 100

# Nginx access log
sudo tail -f /var/log/nginx/access.log

# Nginx error log
sudo tail -f /var/log/nginx/error.log

# Log files on disk
ls /home/ubuntu/logs/
# apexiq-out.log   apexiq-err.log   ai-out.log   ai-err.log
```

### Useful PM2 commands

```bash
pm2 status                    # overview of all processes
pm2 restart apexiq-backend    # hard restart
pm2 reload apexiq-backend     # zero-downtime reload (cluster mode)
pm2 stop apexiq-backend       # stop without removing from PM2
pm2 delete apexiq-backend     # remove from PM2
pm2 describe apexiq-backend   # detailed process info
pm2 flush                     # clear all log files
pm2 save                      # save current process list (survive reboot)
```

### Disk & memory check

```bash
df -h          # disk usage
free -h        # RAM usage
top            # live CPU/RAM
```

---

## 16. Rollback Procedure

### Option A — Git rollback (recommended)

```bash
ssh ubuntu@13.233.XX.XX  # or AI server

cd /home/ubuntu/apexiq-backend   # or ai-service

# See recent commits
git log --oneline -10

# Roll back to a specific commit
git reset --hard <commit-hash>

# Rebuild and restart
npm ci --omit=dev && npm run build
pm2 reload deploy/ecosystem.config.js --env production
```

### Option B — GitHub Actions manual re-run

1. Go to **GitHub → Repository → Actions**
2. Find the last working deploy run
3. Click it → **Re-run jobs**

---

## 17. Cost Estimate

Monthly AWS costs (ap-south-1 / Mumbai region):

| Resource | Type | Cost/month |
|---|---|---|
| App Server | t3.small EC2 | ~₹1,200 (~$15) |
| AI Server | t3.medium EC2 | ~₹2,400 (~$30) |
| Data transfer | ~50 GB/month | ~₹500 (~$6) |
| Elastic IPs | 2 static IPs | ~₹150 (~$2) |
| **Total AWS** | | **~₹4,250 (~$53)/month** |

**External services (separate billing):**

| Service | Free tier | Paid tier |
|---|---|---|
| Supabase | 2 projects free | $25/month Pro |
| Cloudflare R2 | 10 GB free storage, 1M requests free | $0.015/GB after |
| Groq API | 100 req/day free | Pay per token |
| Razorpay | 2% per transaction | — |

---

## 18. Troubleshooting

### `502 Bad Gateway` on api.eddva.in

```bash
# NestJS isn't running. Check:
pm2 status
pm2 logs apexiq-backend --lines 50 --nostream

# Common causes:
# 1. .env is missing or has wrong DB credentials
# 2. npm build failed — check logs
# 3. PM2 crashed — run: pm2 restart apexiq-backend
```

### `404 Not Found` on frontend routes (e.g. /student/dashboard)

```bash
# The Nginx SPA fallback is missing. Check:
sudo cat /etc/nginx/sites-available/eddva-frontend
# Must have: try_files $uri $uri/ /index.html;

sudo nginx -t && sudo systemctl reload nginx
```

### AI calls failing (`Translation failed`, `AI error`)

```bash
# Check connectivity from App Server to AI Server
ssh ubuntu@13.233.XX.XX
curl http://172.31.YY.YY:8000/api/v1/notes/health/

# If curl times out → Security Group rule for port 8000 is wrong
# If curl returns error → Django/Gunicorn is down
ssh ubuntu@15.206.XX.XX
pm2 logs ai-service --lines 50
pm2 restart ai-service
```

### PM2 processes not starting after server reboot

```bash
# Run this once — saves PM2 process list to auto-start on boot
pm2 save
sudo pm2 startup systemd -u ubuntu --hp /home/ubuntu
# Run the command it prints
```

### SSL certificate expired or Let's Encrypt failing

```bash
# Test renewal
sudo certbot renew --dry-run

# Force renewal
sudo certbot renew --force-renewal

# Check expiry
sudo certbot certificates
```

### `npm ci` fails — module not found

```bash
# Clear cache and retry
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Django `DisallowedHost` error

```bash
# The AI server's IP is not in ALLOWED_HOSTS
# Edit /home/ubuntu/ai-service/.env
# Add the IP to ALLOWED_HOSTS=...
pm2 restart ai-service
```

### Check GitHub Actions logs

Go to: **GitHub → Repository → Actions** → click any failing workflow → expand the failed step to read the exact error.

---

## Quick Reference Card

```
# SSH
ssh -i eddva-key.pem ubuntu@<APP_SERVER_IP>    # App Server
ssh -i eddva-key.pem ubuntu@<AI_SERVER_IP>     # AI Server

# PM2
pm2 status                                      # see all processes
pm2 reload apexiq-backend                       # zero-downtime deploy
pm2 restart ai-service                          # restart AI
pm2 logs apexiq-backend --lines 100             # read logs
pm2 monit                                       # live dashboard

# Nginx
sudo nginx -t                                   # test config
sudo systemctl reload nginx                     # apply changes

# Certbot
sudo certbot renew --dry-run                    # test SSL renewal

# URLs
https://eddva.in                                # frontend
https://api.eddva.in/api/v1                     # backend API
https://api.eddva.in/docs                       # Swagger UI
http://172.31.YY.YY:8000                        # AI (internal only)
```
