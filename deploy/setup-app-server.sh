#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ONE-TIME SETUP — App Server (Instance 1)
# Ubuntu 22.04 LTS
# Installs: Node 20, PM2, Nginx, Certbot
# Domains:  eddva.in  (frontend)   api.eddva.in  (NestJS API)
#
# Run as: sudo bash setup-app-server.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "═══════════════════════════════════════════════════════"
echo "  EDDVA App Server Setup"
echo "═══════════════════════════════════════════════════════"

# ── 1. System packages ────────────────────────────────────────────────────────
apt-get update -y
apt-get install -y curl git nginx certbot python3-certbot-nginx ufw

# ── 2. Node 20 (via NodeSource) ───────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node --version && npm --version

# ── 3. PM2 ────────────────────────────────────────────────────────────────────
npm install -g pm2
pm2 startup systemd -u ubuntu --hp /home/ubuntu
env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu

# ── 4. Firewall ───────────────────────────────────────────────────────────────
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ── 5. App directories ────────────────────────────────────────────────────────
mkdir -p /home/ubuntu/apexiq-backend
mkdir -p /var/www/eddva-frontend
chown -R ubuntu:ubuntu /home/ubuntu/apexiq-backend
chown -R ubuntu:ubuntu /var/www/eddva-frontend

# ── 6. Nginx config ───────────────────────────────────────────────────────────
cat > /etc/nginx/sites-available/eddva-frontend <<'NGINX'
server {
    listen 80;
    server_name eddva.in www.eddva.in;
    root /var/www/eddva-frontend/dist;
    index index.html;

    # React SPA — all routes → index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript;
}
NGINX

cat > /etc/nginx/sites-available/eddva-api <<'NGINX'
# Upstream for zero-downtime PM2 cluster reloads
upstream nestjs_backend {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name api.eddva.in;

    client_max_body_size 2G;
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    # REST API
    location /api {
        proxy_pass http://nestjs_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.IO — battle arena WebSocket
    location /socket.io {
        proxy_pass http://nestjs_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
    }

    # Battle WebSocket path
    location /battle {
        proxy_pass http://nestjs_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
    }

    # Swagger docs (only allow from your office IP in prod)
    location /docs {
        proxy_pass http://nestjs_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/eddva-frontend /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/eddva-api       /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  NEXT STEPS:"
echo "  1. Point eddva.in and api.eddva.in A records to this server's IP"
echo "  2. Copy your .env file to /home/ubuntu/apexiq-backend/.env"
echo "  3. Run deploy/deploy-backend.sh to deploy the backend"
echo "  4. Run: certbot --nginx -d eddva.in -d www.eddva.in -d api.eddva.in"
echo "═══════════════════════════════════════════════════════"
