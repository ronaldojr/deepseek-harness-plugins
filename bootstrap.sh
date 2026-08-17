#!/usr/bin/env bash
set -euo pipefail

# One-shot DeepSeek Harness VM setup: clones (or updates) the Sabiá harness
# branch, builds it, installs every plugin in this repo into the web profile,
# and seeds machine-local settings. Idempotent: safe to re-run at any time.
#
# Environment overrides:
#   HARNESS_REPO   git URL of the harness (default: ronaldojr/deepseek-harness fork)
#   HARNESS_BRANCH branch to track (default: sabiaMain)
#   HARNESS_DIR    checkout location (default: $HOME/deepseek-harness)
#   DSH_HOME       harness home (default: $HOME/.dsh)
#   PROFILE        profile name the plugins install into (default: web)

HARNESS_REPO="${HARNESS_REPO:-https://github.com/ronaldojr/deepseek-harness.git}"
HARNESS_BRANCH="${HARNESS_BRANCH:-sabiaMain}"
HARNESS_DIR="${HARNESS_DIR:-$HOME/deepseek-harness}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-web}"
PLUGINS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/dsh-bootstrap"
mkdir -p "$CACHE_DIR"

step() { printf '\n== %s ==\n' "$*"; }
require() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 not found on PATH" >&2; exit 1; }; }

step "prerequisites"
require git
require node
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22 || (a===22&&b<19)) process.exit(1)' 2>/dev/null; then
  echo "error: node >= 22.19 required (current: $(node -v))" >&2; exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  require corepack
  corepack enable
  corepack prepare pnpm@latest --activate
fi
command -v pnpm >/dev/null 2>&1 || { echo "error: could not activate pnpm; run 'npm install -g pnpm' and retry" >&2; exit 1; }

step "harness checkout ($HARNESS_BRANCH -> $HARNESS_DIR)"
if [ -d "$HARNESS_DIR/.git" ]; then
  git -C "$HARNESS_DIR" fetch origin --prune
  if git -C "$HARNESS_DIR" rev-parse --verify -q "$HARNESS_BRANCH" >/dev/null; then
    git -C "$HARNESS_DIR" checkout "$HARNESS_BRANCH"
    git -C "$HARNESS_DIR" pull --ff-only
  else
    git -C "$HARNESS_DIR" checkout -b "$HARNESS_BRANCH" "origin/$HARNESS_BRANCH"
  fi
else
  git clone --branch "$HARNESS_BRANCH" "$HARNESS_REPO" "$HARNESS_DIR"
fi
HEAD="$(git -C "$HARNESS_DIR" rev-parse HEAD)"

step "harness build"
STAMP="$CACHE_DIR/harness.stamp"
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$HEAD" ]; then
  (cd "$HARNESS_DIR" && pnpm install && pnpm run build)
  printf '%s\n' "$HEAD" > "$STAMP"
else
  echo "  already built at $HEAD"
fi

step "dsh-terminal-ui (bundle, installed into profile '$PROFILE')"
# Install dev tooling only: peers stay unresolved here and come from the
# profile's healed node_modules at runtime; resolving them from npm would 404
# on unpublished workspace packages.
(cd "$PLUGINS_ROOT/dsh-terminal-ui" && pnpm install --config.auto-install-peers=false && pnpm run build)
# The profile install also skips peer auto-install: dsh heals
# $DSH_HOME/profiles/node_modules at boot, so peers resolve from the harness
# checkout instead of the npm registry (which lacks them).
(cd "$HARNESS_DIR" && pnpm dsh plugin --profile "$PROFILE" add --config.auto-install-peers=false "link:$PLUGINS_ROOT/dsh-terminal-ui")

step "vision-fallback (host plugin, patched into profile '$PROFILE')"
"$PLUGINS_ROOT/vision-fallback/install.sh"

step "machine-local settings (no secrets)"
if [ -f "$DSH_HOME/settings.yaml" ]; then
  echo "  $DSH_HOME/settings.yaml already present; left unchanged"
else
  mkdir -p "$DSH_HOME"
  cp "$PLUGINS_ROOT/templates/settings.yaml" "$DSH_HOME/settings.yaml"
  echo "  seeded $DSH_HOME/settings.yaml"
fi

cat <<'EOF'

== next steps (once per machine) ==
1. Create "$HARNESS_DIR/.env" with:
     DEEPSEEK_API_KEY=<your key>
2. Export the pi-ai provider keys used by settings.yaml (e.g. in ~/.bashrc):
     export OPENCODE_GO_API_KEY=<key>    # vision fallback + opencode-go
     export GOOGLE_API_KEY=<key>         # google provider
     export GITHUB_COPILOT_API_KEY=<key> # optional; OAuth login can replace it
3. Start the harness:
     cd "$HARNESS_DIR" && pnpm dsh web
   (optional: install templates/dsh-web.service as a user unit for auto-start)

Update later with: ./update.sh
EOF
