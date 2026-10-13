#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if curl --fail --silent --output /dev/null http://127.0.0.1:3000/api/status; then
  exit 0
fi
nohup env WHIMWAY_DEMO_MODE=true NEXT_PUBLIC_WHIMWAY_DEMO_MODE=true \
  DAILY_GUEST_GENERATIONS=100 DAILY_REMIX_LIMIT=100 \
  npm run dev >/tmp/whimway-preview.log 2>&1 </dev/null &
echo "Starting the labelled development preview on port 3000. Logs: /tmp/whimway-preview.log"
