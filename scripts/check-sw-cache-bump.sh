#!/usr/bin/env bash
# PreToolUse guard for `git commit`: sw.js caches same-origin requests
# cache-first keyed by CACHE_NAME (see sw.js), so a commit that changes a
# PRECACHE-listed file without bumping CACHE_NAME leaves phones with the PWA
# already installed stuck serving the stale version indefinitely.
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root"

changed=$(git diff --cached --name-only -- \
  index.html handpan-player.html manifest.webmanifest \
  icon-180.png icon-192.png icon-512.png \
  vendor/pdfjs/pdf.min.js vendor/pdfjs/pdf.worker.min.js \
  2>/dev/null || true)

[ -z "$changed" ] && exit 0

if git diff --cached -- sw.js | grep -q '^[+-]const CACHE_NAME'; then
  exit 0
fi

reason="Staged commit touches sw.js PRECACHE file(s) (${changed//$'\n'/, }) but sw.js's CACHE_NAME line wasn't changed. Installed PWA clients cache-first on CACHE_NAME and will keep serving the stale version until it's bumped. Bump CACHE_NAME in sw.js, stage it, and commit again."

jq -n --arg reason "$reason" '{
  systemMessage: $reason,
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
