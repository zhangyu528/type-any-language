#!/usr/bin/env bash
#
# Start a Cloudflare Tunnel exposing localhost:8080 publicly.
# Called by staging.yml (mode: review) to give operator a public URL.

# Required env vars (set by the calling workflow):
#   TUNNEL_PORT - port to expose (default 8080)
#   TUNNEL_PID_FILE - where to write the cloudflared PID
#                    (default /tmp/cloudflared.pid) - workflow can kill later
#   TUNNEL_LOG_FILE - where to write cloudflared output
#                    (default /tmp/tunnel.log) - we grep this for the URL

# Output (set in $GITHUB_OUTPUT by the workflow caller):
#   URL - the public trycloudflare.com URL

set -euo pipefail

TUNNEL_PORT="${TUNNEL_PORT:-8080}"
TUNNEL_PID_FILE="${TUNNEL_PID_FILE:-/tmp/cloudflared.pid}"
TUNNEL_LOG_FILE="${TUNNEL_LOG_FILE:-/tmp/tunnel.log}"

if ! command -v cloudflared >/dev/null; then
    echo "::error::cloudflared not installed (run install-cloudflared.sh first)"
    exit 1
fi

echo "[tunnel] starting cloudflared for localhost:$TUNNEL_PORT..."
nohup cloudflared tunnel --no-autoupdate --url "http://localhost:${TUNNEL_PORT}" > "$TUNNEL_LOG_FILE" 2>&1 &
TUNNEL_PID=$!
echo "$TUNNEL_PID" > "$TUNNEL_PID_FILE"
echo "[tunnel] started cloudflared (pid=$TUNNEL_PID, log=$TUNNEL_LOG_FILE)"

# Wait for the tunnel URL to appear in the log (up to 30s)
for i in $(seq 1 30); do
    URL=$(grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" "$TUNNEL_LOG_FILE" 2>/dev/null | head -1 || true)
    if [ -n "$URL" ]; then
        echo "[tunnel] URL ready after ${i}s: $URL"
        echo "URL=$URL" >> "$GITHUB_OUTPUT"
        echo "TUNNEL_PID=$TUNNEL_PID" >> "$GITHUB_OUTPUT"
        exit 0
    fi
    sleep 1
done

echo "::error::cloudflared tunnel did not produce a URL within 30s"
cat "$TUNNEL_LOG_FILE"
kill "$TUNNEL_PID" 2>/dev/null || true
exit 1
