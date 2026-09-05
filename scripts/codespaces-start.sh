#!/usr/bin/env bash
# Starts Viralyzer in a GitHub Codespace (or any Linux box) and exposes it
# through a free Cloudflare quick tunnel, so no port forwarding, port
# visibility or proxy body limits get in the way.
set -e
cd "$(dirname "$0")/.."
mkdir -p data storage

if [ ! -f .next/BUILD_ID ] || [ -n "$(find src assets vendor package.json -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]; then
  echo "Building Viralyzer (first start takes a couple of minutes)…"
  npm run build
fi

pkill -f "next start" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

# 1. Tunnel first, so the app can learn its public address.
echo "Opening a public tunnel…"
nohup npx --yes cloudflared tunnel --url http://localhost:3000 --no-autoupdate > /tmp/tunnel.log 2>&1 &
TUNNEL_URL=""
for i in $(seq 1 60); do
  TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/tunnel.log | head -1 || true)
  [ -n "$TUNNEL_URL" ] && break
  sleep 1
done

# 2. The app, told its public address (falls back to the Codespaces port URL).
if [ -n "$TUNNEL_URL" ]; then
  export PUBLIC_BASE_URL="$TUNNEL_URL"
else
  echo "Tunnel did not start (see /tmp/tunnel.log); falling back to the Codespaces port URL."
fi
nohup npm start > /tmp/viralyzer.log 2>&1 &

for i in $(seq 1 60); do
  curl -sf -o /dev/null http://localhost:3000/api/me && break
  sleep 1
done

echo
echo "=================================================================="
if [ -n "$TUNNEL_URL" ]; then
  echo "  Viralyzer is running. Open this on any device:"
  echo
  echo "     $TUNNEL_URL"
  echo
  echo "  (The address changes each time you run this script.)"
else
  echo "  Viralyzer is running on port 3000."
  echo "  Open the Ports tab, set port 3000 to Public, click the globe."
fi
echo "=================================================================="
