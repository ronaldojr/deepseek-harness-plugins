#!/usr/bin/env bash
set -euo pipefail

# One-line DeepSeek Harness installer:
#   curl -fsSL https://raw.githubusercontent.com/ronaldojr/deepseek-harness-plugins/main/setup.sh | bash
#
# This entry point only clones (or updates) this plugins repo into a stable
# local directory and hands off to bootstrap.sh, which does the real work:
# harness checkout + build, plugin installation, and settings seed.
# Idempotent: re-running pulls and re-installs without duplicating anything.

PLUGINS_REPO_URL="${PLUGINS_REPO_URL:-https://github.com/ronaldojr/deepseek-harness-plugins.git}"
PLUGINS_DIR="${PLUGINS_DIR:-$HOME/deepseek-harness-plugins}"

require() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 not found on PATH" >&2; exit 1; }; }

require curl
require git

if [ -d "$PLUGINS_DIR/.git" ]; then
  echo "== updating $PLUGINS_DIR =="
  git -C "$PLUGINS_DIR" pull --ff-only
else
  echo "== cloning plugins repo into $PLUGINS_DIR =="
  git clone --depth 1 "$PLUGINS_REPO_URL" "$PLUGINS_DIR"
fi

exec "$PLUGINS_DIR/bootstrap.sh" "$@"
