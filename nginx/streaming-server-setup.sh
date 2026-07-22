#!/bin/bash
# ============================================================
# Run this script on the STREAMING SERVER (13.127.31.213)
# as root / sudo.
#
# What it does:
#   1. Installs ffmpeg (for ABR transcoding)
#   2. Creates HLS output directories for 480p and 360p
#   3. Backs up current nginx.conf and installs the new one
#   4. Tests and reloads nginx
# ============================================================

set -e

echo "==> Installing ffmpeg..."
apt-get update -y
apt-get install -y ffmpeg

echo "==> Creating HLS directories..."
mkdir -p /var/www/hls /var/www/hls480 /var/www/hls360
chown -R www-data:www-data /var/www/hls /var/www/hls480 /var/www/hls360
chmod 755 /var/www/hls /var/www/hls480 /var/www/hls360

echo "==> Backing up current nginx.conf..."
cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak.$(date +%Y%m%d%H%M%S)

echo "==> Installing new nginx.conf..."
# Copy streaming-server.nginx.conf to /etc/nginx/nginx.conf
# (transfer the file via scp first: scp nginx/streaming-server.nginx.conf ubuntu@13.127.31.213:/tmp/)
cp /tmp/streaming-server.nginx.conf /etc/nginx/nginx.conf

echo "==> Testing nginx config..."
nginx -t

echo "==> Reloading nginx..."
systemctl reload nginx

echo "==> Done. HLS paths:"
echo "    Full quality : http://13.127.31.213:8080/hls/{streamKey}/index.m3u8"
echo "    480p         : http://13.127.31.213:8080/hls480/{streamKey}/index.m3u8"
echo "    360p         : http://13.127.31.213:8080/hls360/{streamKey}/index.m3u8"
