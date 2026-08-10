#!/usr/bin/env bash
#
# Download + install cloudflared binary (Cloudflare Tunnel client).
# Called by staging.yml (mode: review) before starting the tunnel.

set -euo pipefail

ARCH=$(uname -m)
case "$ARCH" in
    x86_64) CF_ARCH=amd64 ;;
    aarch64) CF_ARCH=arm64 ;;
    *) echo "::error::unsupported arch: $ARCH" >&2; exit 1 ;;
esac

curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared --version
