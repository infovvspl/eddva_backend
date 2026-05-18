# EDDVA Deployment Guide

## Architecture

```
Internet
   │
   ├── eddva.in ──────────────► Instance 1 (App Server)
   │                             ├── Nginx → /var/www/eddva-frontend/dist  (React)
   │                             └── Nginx → localhost:3000  (NestJS via PM2)
   │
   └── (internal)  ────────────► Instance 2 (AI Server)
                                  └── Gunicorn → port 8000  (Django via PM2)
                                       ▲ called by NestJS internally
```

## EC2 Instance Recommendations

| Instance | Type | RAM | Cost/mo |
|---|---|---|---|
| App Server | t3.small | 2 GB | ~$15 |
| AI Server | t3.medium | 4 GB | ~$30 |

Use **Ubuntu 22.04 LTS** for both.

---

## Step 1 — Create EC2 Instances

1. Launch **two** EC2 instances (Ubuntu 22.04)
2. Create a key pair and save the `.pem` file
3. Security Groups:
   - **App Server:** inbound 22 (SSH), 80 (HTTP), 443 (HTTPS)
   - **AI Server:** inbound 22 (SSH), 8000 (from App Server private IP only)
4. Note both **public IPs** and the **AI Server's private IP**

---

## Step 2 — DNS Records (eddva.in)

In your domain registrar / Cloudflare, add:

```
A    eddva.in          →  <App Server Public IP>
A    www.eddva.in      →  <App Server Public IP>
A    api.eddva.in      →  <App Server Public IP>
```

---

## Step 3 — App Server Setup (run once)

```bash
# SSH into App Server
ssh -i your-key.pem ubuntu@<APP_SERVER_IP>

# Upload and run setup script
curl -fsSL https://raw.githubusercontent.com/infovvspl/apexiq-backend/main/deploy/setup-app-server.sh | sudo bash
```

---

## Step 4 — AI Server Setup (run once)

```bash
# SSH into AI Server
ssh -i your-key.pem ubuntu@<AI_SERVER_IP>

# Run setup — pass App Server PRIVATE IP to restrict port 8000
sudo bash setup-ai-server.sh <APP_SERVER_PRIVATE_IP>

# Clone repo and set up venv (one-time)
git clone https://github.com/infovvspl/AI_Study.git /home/ubuntu/ai-service
cd /home/ubuntu/ai-service
python3.11 -m venv venv
venv/bin/pip install -r requirements.prod.txt

# Create .env (fill in your actual values)
cp .env.example .env
nano .env
```

---

## Step 5 — SSL (App Server, after DNS propagates)

```bash
sudo certbot --nginx -d eddva.in -d www.eddva.in -d api.eddva.in
# Certbot auto-renews. Verify: sudo certbot renew --dry-run
```

---

## Step 6 — GitHub Secrets

Go to each repo → Settings → Secrets → Actions. Add these:

### Backend & Frontend repos (both share APP_SERVER_* secrets):
| Secret | Value |
|---|---|
| `APP_SERVER_HOST` | App Server public IP |
| `APP_SERVER_SSH_KEY` | Contents of your .pem key file |
| `DB_HOST` | Supabase DB host |
| `DB_PORT` | 5432 |
| `DB_USERNAME` | DB username |
| `DB_PASSWORD` | DB password |
| `DB_NAME` | DB name |
| `JWT_SECRET` | Random 64-char string |
| `JWT_REFRESH_SECRET` | Random 64-char string |
| `AI_BASE_URL` | `http://<AI_PRIVATE_IP>:8000` |
| `AI_API_KEY` | Your AI API key |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | `apexiq-media` |
| `R2_PUBLIC_URL` | `https://media.eddva.in` |
| `RAZORPAY_KEY_ID` | Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay secret |
| `AGORA_APP_ID` | Agora app ID |
| `AGORA_APP_CERTIFICATE` | Agora certificate |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_PRIVATE_KEY` | Firebase private key (with newlines) |
| `FIREBASE_CLIENT_EMAIL` | Firebase client email |
| `VITE_AGORA_APP_ID` | Same Agora app ID (frontend) |
| `VITE_SARVAM_API_KEY` | Sarvam API key (frontend) |

### AI repo:
| Secret | Value |
|---|---|
| `AI_SERVER_HOST` | AI Server public IP |
| `AI_SERVER_SSH_KEY` | Contents of your .pem key file |
| `GROQ_API_KEY` | Groq API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `SERPAPI_KEY` | SerpAPI key |
| `DJANGO_SECRET_KEY` | Random 50-char string |
| `AI_ALLOWED_HOSTS` | `<AI_PUBLIC_IP>,<AI_PRIVATE_IP>,localhost,127.0.0.1` |
| `AI_API_KEY` | Same key as backend `AI_API_KEY` |

---

## Step 7 — First Manual Deploy (before CI/CD is set up)

### Backend
```bash
ssh -i key.pem ubuntu@<APP_SERVER_IP>
git clone https://github.com/infovvspl/apexiq-backend.git /home/ubuntu/apexiq-backend
cd /home/ubuntu/apexiq-backend
# Create .env with all production values
nano .env
npm ci --omit=dev
npm run build
mkdir -p /home/ubuntu/logs
pm2 start deploy/ecosystem.config.js --env production
pm2 save
```

### Frontend
```bash
# Build locally or on CI, then SCP dist folder:
npm run build
scp -i key.pem -r dist/ ubuntu@<APP_SERVER_IP>:/var/www/eddva-frontend/
ssh -i key.pem ubuntu@<APP_SERVER_IP> "sudo systemctl reload nginx"
```

### AI Service
```bash
ssh -i key.pem ubuntu@<AI_SERVER_IP>
cd /home/ubuntu/ai-service
# Create .env
nano .env
pm2 start deploy/ecosystem.config.js
pm2 save
```

---

## Useful PM2 Commands

```bash
pm2 status                    # list all processes
pm2 logs apexiq-backend       # tail backend logs
pm2 logs ai-service           # tail AI service logs
pm2 restart apexiq-backend    # restart backend
pm2 reload apexiq-backend     # zero-downtime reload (cluster mode)
pm2 monit                     # live CPU/RAM dashboard
```

## Useful Nginx Commands

```bash
sudo nginx -t                 # test config syntax
sudo systemctl reload nginx   # apply config changes
sudo tail -f /var/log/nginx/error.log
```

---

## CI/CD Flow (after secrets are set)

Every `git push` to `main`:
1. **Backend repo** → GitHub Actions → SSH into App Server → pull → npm ci → npm build → pm2 reload
2. **Frontend repo** → GitHub Actions → npm build → SCP dist/ to App Server → nginx reload
3. **AI repo** → GitHub Actions → SSH into AI Server → pull → pip install → migrate → pm2 restart
