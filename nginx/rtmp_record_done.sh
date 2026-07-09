#!/bin/bash
# ─── RTMP record-done hook ─────────────────────────────────────────────────────
# Called by nginx-rtmp after every stream recording finishes.
# nginx-rtmp passes: $1 = stream key (name), $2 = full path to the FLV file.
#
# Deploy to streaming server:
#   sudo cp rtmp_record_done.sh /usr/local/bin/rtmp_record_done.sh
#   sudo chmod +x /usr/local/bin/rtmp_record_done.sh
#
# Prerequisites on streaming server:
#   apt install ffmpeg
#   mkdir -p /tmp/recordings && chmod 777 /tmp/recordings
# ──────────────────────────────────────────────────────────────────────────────

STREAM_KEY="$1"
FLV_PATH="$2"
RECORDINGS_DIR="/var/recordings"
MP4_TMP="${RECORDINGS_DIR}/${STREAM_KEY}.mp4.tmp"
MP4_FINAL="${RECORDINGS_DIR}/${STREAM_KEY}.mp4"

# Basic sanity checks
if [ -z "$STREAM_KEY" ] || [ -z "$FLV_PATH" ]; then
  echo "[rtmp_record_done] ERROR: missing args stream_key='$STREAM_KEY' path='$FLV_PATH'" >&2
  exit 1
fi

if [ ! -f "$FLV_PATH" ]; then
  echo "[rtmp_record_done] ERROR: FLV not found: $FLV_PATH" >&2
  exit 1
fi

mkdir -p "$RECORDINGS_DIR"

echo "[rtmp_record_done] converting $FLV_PATH → $MP4_FINAL"

# -c copy = no re-encode (fast), -movflags faststart = HTTP streaming friendly.
# Write to .tmp first so the app server only sees a complete file.
ffmpeg -y -i "$FLV_PATH" \
  -f mp4 -c:v copy -c:a copy \
  -movflags +faststart \
  "$MP4_TMP" 2>>/var/log/rtmp_record_done.log

if [ $? -eq 0 ]; then
  mv "$MP4_TMP" "$MP4_FINAL"
  echo "[rtmp_record_done] done: $MP4_FINAL ($(du -sh "$MP4_FINAL" | cut -f1))"
  # Remove the FLV to free disk space
  rm -f "$FLV_PATH"
else
  echo "[rtmp_record_done] ERROR: ffmpeg failed for $FLV_PATH" >&2
  rm -f "$MP4_TMP"
  exit 1
fi
