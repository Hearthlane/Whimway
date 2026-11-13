#!/usr/bin/env bash
# One-command browser preview of the whole product, in labelled demo mode:
#   API + web app + share pages  → http://localhost:3000
#   The native app (web build)   → http://localhost:8090   ← click through everything here
# Usage: npm run preview        (add --rebuild to force a fresh app build)
set -euo pipefail
cd "$(dirname "$0")/.."
API=3000
APP=8090
if [[ -n "${CODESPACE_NAME:-}" ]]; then
  DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  export APP_ORIGIN="${APP_ORIGIN:-https://${CODESPACE_NAME}-${API}.${DOMAIN}}"
  SHARE_ORIGIN="https://${CODESPACE_NAME}-${API}.${DOMAIN}"
  export WHIMWAY_APP_ORIGIN="https://${CODESPACE_NAME}-${APP}.${DOMAIN}"
else
  SHARE_ORIGIN="http://localhost:${API}"
fi

[[ -d node_modules ]] || npm ci --no-audit --no-fund
[[ -d mobile/node_modules ]] || (cd mobile && npm ci --no-audit --no-fund)

if ! curl -fs -o /dev/null "http://127.0.0.1:${API}/api/status"; then
  echo "Starting the API in demo mode on :${API} (logs: /tmp/whimway-api.log)"
  nohup env NEXT_TELEMETRY_DISABLED=1 WHIMWAY_DEMO_MODE=true NEXT_PUBLIC_WHIMWAY_DEMO_MODE=true \
    DAILY_GUEST_GENERATIONS=500 DAILY_REMIX_LIMIT=500 \
    npx next dev --hostname 0.0.0.0 -p "${API}" >/tmp/whimway-api.log 2>&1 </dev/null &
fi

if [[ "${1:-}" == "--rebuild" || ! -f mobile/dist/index.html || -n "$(find mobile/src lib -newer mobile/dist/index.html -name '*.ts*' -print -quit)" ]]; then
  echo "Building the app for the browser…"
  (cd mobile && CI=1 EXPO_OFFLINE=1 EXPO_PUBLIC_SHARE_ORIGIN="${SHARE_ORIGIN}" \
    npx expo export --platform web --output-dir dist >/tmp/whimway-app-build.log 2>&1) \
    || { echo "App build failed — see /tmp/whimway-app-build.log"; exit 1; }
fi

if ! curl -fs -o /dev/null "http://127.0.0.1:${APP}/"; then
  nohup node mobile/scripts/serve-web.mjs "${APP}" "http://127.0.0.1:${API}" >/tmp/whimway-app.log 2>&1 </dev/null &
fi
for _ in $(seq 1 60); do
  curl -fs -o /dev/null "http://127.0.0.1:${APP}/api/status" && break
  sleep 2
done
# Compile the web pages once now, so the first visitor (or a shared link) isn't kept waiting.
for page in / /p /admin /privacy; do curl -fs -o /dev/null --max-time 120 "http://127.0.0.1:${API}${page}" || true; done
echo
echo "  App (click through everything): http://localhost:${APP}"
echo "  Web app + share links:          http://localhost:${API}"
echo "  Demo data: real GTA places, estimated hours/prices/travel. Reset the app: You → Delete data on this device."
