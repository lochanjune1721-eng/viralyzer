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

# Stop whatever is holding port 3000 (the `next start` launcher AND its next-server child).
pkill -f "next start" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
for i in $(seq 1 15); do
  if ! (command -v fuser >/dev/null && fuser 3000/tcp >/dev/null 2>&1) && ! (command -v lsof >/dev/null && lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1); then break; fi
  command -v fuser >/dev/null && fuser -k 3000/tcp >/dev/null 2>&1 || true
  sleep 1
done

# Python deps for the video-use engine (conversational editing).
PY=$(command -v python3 || command -v python || true)
if [ -n "$PY" ] && ! "$PY" -c "import requests, numpy, PIL" >/dev/null 2>&1; then
  echo "Installing Python packages for the editing engine…"
  "$PY" -m pip install -q -r vendor/video-use/requirements.txt 2>/dev/null || "$PY" -m pip install -q --break-system-packages -r vendor/video-use/requirements.txt || true
fi
export PYTHON_PATH="$PY"

# Headless Chrome for Remotion layout renders (motion graphics, split screen, captions).
if [ -z "$REMOTION_BROWSER_EXECUTABLE" ] && [ -z "$(find node_modules/.remotion -type f -name chrome-headless-shell 2>/dev/null | head -1)" ] && [ ! -x /usr/bin/chromium ]; then
  echo "Downloading Chrome Headless Shell for Remotion renders…"
  npx remotion browser ensure >/tmp/remotion-browser.log 2>&1 || echo "Could not download a headless browser (see /tmp/remotion-browser.log); renders will use the FFmpeg engine."
fi
if [ ! -d remotion-bundle ] || [ -n "$(find remotion package.json -newer remotion-bundle -print -quit 2>/dev/null)" ]; then
  echo "Bundling Remotion templates…"
  REMOTION_BUNDLE_DIR=./remotion-bundle npx tsx scripts/remotion-bundle.ts >/tmp/remotion-bundle.log 2>&1 && touch remotion-bundle || echo "Remotion bundling failed (see /tmp/remotion-bundle.log)"
fi
export REMOTION_BUNDLE_DIR="$PWD/remotion-bundle"

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

STARTED=""
for i in $(seq 1 60); do
  if curl -sf -o /dev/null http://localhost:3000/api/me; then STARTED=1; break; fi
  sleep 1
done
if [ -z "$STARTED" ]; then
  echo "The app did not start. Last log lines:"; tail -20 /tmp/viralyzer.log; exit 1
fi
if grep -q EADDRINUSE /tmp/viralyzer.log; then
  echo "Port 3000 was still busy; the app you see may be an old process. Run this script again."; exit 1
fi

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
