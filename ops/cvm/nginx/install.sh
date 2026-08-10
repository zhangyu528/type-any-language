#!/bin/bash
# ops/nginx/install.sh — install + enable the
# type-any-language nginx site on the CVM host.
#
# Idempotent. Safe to re-run after editing ops/nginx/site.conf.
#
# Called by ops/cvm/bootstrap.sh::step_nginx_site_link, but kept as a
# standalone script so it can be re-run on its own after the operator
# hand-edits /etc/nginx/sites-available.
#
# Steps:
#   1. Verify nginx binary present (apt-install if missing — most
#      ubuntu images ship nginx-common but not nginx itself).
#   2. Verify the site conf + the default site presence; remove
#      default if it would shadow us on :80.
#   3. Install ops/nginx/site.conf to /etc/nginx/sites-available/
#      and enable the site via sites-enabled/ symlink.
#   4. Validate with nginx -t (syntax check).
#   5. systemctl reload nginx (keeps in-flight reqs; not restart).
#
# Exit codes:
#   0  success
#   1  missing tool (nginx binary, sudo) or missing source conf
#   2  nginx -t failed
#   3  systemctl reload failed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_CONF="$SCRIPT_DIR/site.conf"
DST_CONF="/etc/nginx/sites-available/type-any-language"
LINK="/etc/nginx/sites-enabled/type-any-language"

info() { printf '[nginx-site] %s\n' "$*"; }
err()  { printf '[nginx-site] ERROR: %s\n' "$*" >&2; }

# 1. nginx present?
if ! command -v nginx >/dev/null 2>&1; then
    info "nginx not installed — apt install nginx"
    if command -v sudo >/dev/null 2>&1; then
        sudo apt-get update -y
        sudo apt-get install -y nginx
    else
        err "nginx missing AND no sudo available — install nginx manually first"
        exit 1
    fi
fi

# 2. remove apt-shipped default site if present (it shadows :80)
if [ -f /etc/nginx/sites-enabled/default ]; then
    info "removing /etc/nginx/sites-enabled/default (would shadow type-any-language)"
    sudo rm -f /etc/nginx/sites-enabled/default
fi

# 3. copy + symlink
if [ ! -f "$SRC_CONF" ]; then
    err "  $SRC_CONF missing — repo source of truth is gone"
    exit 1
fi

# Diff check: if the destination's contents already match the
# source, skip the copy. Saves an nginx reload when re-running.
if ! sudo cmp -s "$SRC_CONF" "$DST_CONF" 2>/dev/null; then
    info "installing $SRC_CONF → $DST_CONF"
    sudo install -m 644 "$SRC_CONF" "$DST_CONF"
    NEEDS_RELOAD=1
else
    info "site conf up to date — no copy needed"
    NEEDS_RELOAD=0
fi

# Ensure the symlink exists (idempotent: ln -sf ignores existing)
if [ ! -L "$LINK" ]; then
    info "enabling site: $LINK → $DST_CONF"
    sudo ln -s "$DST_CONF" "$LINK"
    NEEDS_RELOAD=1
fi

# 4. validate
if ! sudo nginx -t; then
    err "nginx -t failed — config has a syntax error"
    exit 2
fi

# 5. reload (only if we actually changed something)
if [ "$NEEDS_RELOAD" = "1" ]; then
    info "reloading nginx"
    if ! sudo systemctl reload nginx; then
        err "systemctl reload nginx failed"
        exit 3
    fi
    info "ok"
else
    info "no changes — skipping reload"
fi