#!/usr/bin/env bash
set -euo pipefail

# Update an existing VM installation to the latest committed state:
#   - git pull this plugins repo, the harness branch, and rebuild what changed
#   - re-install the plugins into the profile (both installers are idempotent)
#
# Same environment overrides as bootstrap.sh (HARNESS_DIR, PROFILE, DSH_HOME).

HARNESS_DIR="${HARNESS_DIR:-$HOME/deepseek-harness}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-web}"
PLUGINS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/dsh-bootstrap"
mkdir -p "$CACHE_DIR"

step() { printf '\n== %s ==\n' "$*"; }

step "plugins repo"
git pull --ff-only

step "harness ($HARNESS_DIR)"
git -C "$HARNESS_DIR" fetch origin --prune
git -C "$HARNESS_DIR" pull --ff-only
HEAD="$(git -C "$HARNESS_DIR" rev-parse HEAD)"
STAMP="$CACHE_DIR/harness.stamp"
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$HEAD" ]; then
  (cd "$HARNESS_DIR" && pnpm install && pnpm run build)
  printf '%s\n' "$HEAD" > "$STAMP"
else
  echo "  harness unchanged at $HEAD"
fi

step "dsh-terminal-ui"
PLUGIN_HEAD_BEFORE="$(git -C "$PLUGINS_ROOT/dsh-terminal-ui" rev-parse HEAD 2>/dev/null || true)"
# Peers resolve from the profile's healed node_modules at runtime; fetching
# them from npm would 404 on unpublished workspace packages.
(cd "$PLUGINS_ROOT/dsh-terminal-ui" && pnpm install --config.auto-install-peers=false)
PLUGIN_HEAD_AFTER="$(git -C "$PLUGINS_ROOT/dsh-terminal-ui" rev-parse HEAD 2>/dev/null || true)"
if [ "$PLUGIN_HEAD_BEFORE" != "$PLUGIN_HEAD_AFTER" ]; then
  (cd "$PLUGINS_ROOT/dsh-terminal-ui" && pnpm run build)
fi
(cd "$HARNESS_DIR" && pnpm dsh plugin --profile "$PROFILE" add "link:$PLUGINS_ROOT/dsh-terminal-ui")

step "vision-fallback"
"$PLUGINS_ROOT/vision-fallback/install.sh"

cat <<'EOF'

== done ==
Restart dsh to load the new state (kill the running `pnpm dsh` and start it
again, or `systemctl --user restart dsh` when running under the unit).
EOF
