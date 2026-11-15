#!/usr/bin/env bash
# Bundle the keyless demo engine (real planner + demo venues) for the hosted Claude demo page.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-demo-claude/dist/engine.js}"
# The page (index.html) loads engine.js and photos/*.jpg from beside it; copy mobile/assets/guide to photos/ when publishing.
mkdir -p "$(dirname "$out")"
npx --yes esbuild@0.25.0 demo-claude/engine.ts --bundle --format=iife --global-name=Whimway \
  --platform=browser --target=es2020 --minify \
  --alias:node:crypto=./demo-claude/shims/crypto.ts \
  --alias:node:async_hooks=./demo-claude/shims/async_hooks.ts \
  --define:process.env={} --outfile="$out"
