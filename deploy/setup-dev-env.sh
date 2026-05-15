#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ONE-TIME DEV ENVIRONMENT SETUP — Run on PROD-APP server (Instance 1)
# Run as: sudo bash setup-dev-env.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "═══════════════════════════════════════════════════════"
echo "  Setting up DEV environment on PROD-APP server"
echo "═══════════════════════════════════════════════════════"

# ── 1. Create directories ────────────────────────────────────────────────────
mkdir -p /var/www/eddva_dev
mkdir -p /home/ubuntu/eddva_backend_dev
mkdir -p /home/ubuntu/logs
chown -R ubuntu:ubuntu /var/www/eddva_dev
chown -R ubuntu:ubuntu /home/ubuntu/eddva_backend_dev
chown -R ubuntu:ubuntu /home/ubuntu/logs

# ── 2. Nginx — dev frontend (dev.eddva.in) ───────────────────────────────────
cat > /etc/nginx/sites-available/eddva-dev-frontend << 'NGINX'
server {
    listen 80;
    server_name dev.eddva.in;
    root /var/www/eddva_dev;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript;
}
NGINX

# ── 3. Nginx — dev API (dev-api.eddva.in → port 3001) ───────────────────────
cat > /etc/nginx/sites-available/eddva-dev-api << 'NGINX'
upstream nestjs_backend_dev {
    server 127.0.0.1:3001;
    keepalive 64;
}

server {
    listen 80;
    server_name dev-api.eddva.in;

    client_max_body_size 2G;
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    location /api {
        proxy_pass http://nestjs_backend_dev;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /socket.io {
        proxy_pass http://nestjs_backend_dev;
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

    location /docs {
        proxy_pass http://nestjs_backend_dev;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
NGINX

# ── 4. Enable sites ──────────────────────────────────────────────────────────
ln -sf /etc/nginx/sites-available/eddva-dev-frontend /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/eddva-dev-api       /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Dev Nginx configs active!"
echo ""
echo "  NEXT STEPS:"
echo "  1. Add DNS A records:"
echo "     dev.eddva.in     → this server IP"
echo "     dev-api.eddva.in → this server IP"
echo "  2. After DNS propagates, run SSL:"
echo "     certbot --nginx -d dev.eddva.in -d dev-api.eddva.in"
echo "  3. Add GitHub Secrets (see below)"
echo "  4. Push to dev branch — CI/CD will deploy automatically"
echo "═══════════════════════════════════════════════════════"
