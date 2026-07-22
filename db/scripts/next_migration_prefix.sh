#!/bin/bash
#
# db/scripts/next_migration_prefix.sh — print the next available migration
# prefix for a shared (master-bound) migration.
#
# Usage:
#   ./db/scripts/next_migration_prefix.sh           # next shared prefix on origin/master
#   ./db/scripts/next_migration_prefix.sh --local   # next prefix in working tree (not origin)
#
# Output:
#   stdout: a 4-digit zero-padded number, e.g. "0011"
#           (exit 0)
#
#   stderr: warning messages if the working tree has untracked migration
#           files that need attention, or if origin/master is unreachable
#           (exit still 0 — caller decides what to do)
#
# Why this exists:
#   Adding a migration under db/dbtools/migrations/versions/ requires
#   picking the next free integer prefix. Doing this by hand invites
#   "two branches both picked 0011" collisions. This script reads the
#   current state from git and tells you the next safe prefix.
#
# Scope:
#   - Shared prefixes (0001-8999) only. Branch-local migrations (9000+)
#     use a different convention; see CLAUDE.md "Migration naming +
#     merge rules".
#   - Looks at files matching `NNNN_<short>.py` where N is a digit
#     and NNNN < 9000. Files >= 9000 are branch-local per convention.
#
# Requires: git, grep, sort, tail.

set -e

SCOPE="origin"
for arg in "$@"; do
    case "$arg" in
        --local) SCOPE="working-tree" ;;
        -h|--help)
            sed -n '2,28p' "$0"
            exit 0
            ;;
        *) echo "unknown arg: $arg" >&2; exit 1 ;;
    esac
done

# Verify we're in a git repo
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "[ERR]  not a git repo" >&2
    exit 1
fi

collect_prefixes() {
    # Reads NNNN_<short>.py basenames from stdin (one per line),
    # extracts the leading 4-digit prefix, keeps only shared-range
    # (0001-8999), prints the max.
    # Note: force 10# (base-10) arithmetic — leading zeros would otherwise
    # be parsed as octal and trip on "0010".
    grep -oE '^[0-9]{4}_' \
        | while read -r p; do
              n="${p%_}"
              if [ "$((10#$n))" -lt 9000 ] 2>/dev/null; then
                  printf '%s\n' "$n"
              fi
          done \
        | sort -u \
        | tail -1
}

case "$SCOPE" in
    origin)
        # Ensure origin/master exists (fetch is the caller's responsibility;
        # we just warn if not).
        if ! git rev-parse --verify origin/master >/dev/null 2>&1; then
            echo "[warn] origin/master not found locally — run 'git fetch origin' first" >&2
            echo "[warn] falling back to working-tree scope" >&2
            SCOPE="working-tree"
        fi
        ;;
esac

if [ "$SCOPE" = "origin" ]; then
    # Files in versions/ at origin/master HEAD (read-only git tree).
    PREFIXES="$(git ls-tree -r --name-only origin/master -- \
        db/dbtools/migrations/versions/ 2>/dev/null \
        | xargs -n1 basename 2>/dev/null \
        | grep -E '^[0-9]{4}_.*\.py$' || true)"
    MAX="$(printf '%s\n' "$PREFIXES" | collect_prefixes)"
    if [ -z "$MAX" ]; then
        echo "[warn] no shared migrations on origin/master — start at 0001" >&2
        echo "0001"
    else
        # 10# forces base-10; "0010" + 1 should be 11, not an octal error.
        printf '%04d\n' "$((10#$MAX + 1))"
    fi
else
    # Files in the working tree.
    PREFIXES="$(ls db/dbtools/migrations/versions/*.py 2>/dev/null \
        | xargs -n1 basename \
        | grep -E '^[0-9]{4}_.*\.py$' || true)"
    MAX="$(printf '%s\n' "$PREFIXES" | collect_prefixes)"
    if [ -z "$MAX" ]; then
        echo "0001"
    else
        printf '%04d\n' "$((10#$MAX + 1))"
    fi
fi