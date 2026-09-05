#!/usr/bin/env bash
# Starts the app inside a GitHub Codespace. Builds once, then serves in the
# background so the forwarded port is ready shortly after the codespace opens.
set -e
cd "$(dirname "$0")/.."
mkdir -p data storage
if [ ! -f .next/BUILD_ID ] || [ -n "$(find src assets vendor package.json -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]; then
  echo "Building Viralyzer (first start takes a couple of minutes)…"
  npm run build
fi
pkill -f "next start" 2>/dev/null || true
nohup npm start > /tmp/viralyzer.log 2>&1 &
echo "Viralyzer is starting on port 3000. Open the Ports tab and click the globe icon."
