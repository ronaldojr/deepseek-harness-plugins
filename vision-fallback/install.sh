#!/usr/bin/env bash
set -euo pipefail
# Install dsh-vision-fallback into a DeepSeek Harness profile (dev/no-build path).
# Idempotent: refreshes the source and never duplicates the patch entry.
# Standard/npm path: `npm install dsh-vision-fallback` then `name: 'dsh-vision-fallback'`.

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-web}"
PLUGIN_DIR="$DSH_HOME/profiles/vision-fallback"
PATCH_FILE="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$PLUGIN_DIR"
cp "$SRC_DIR/src/index.ts" "$PLUGIN_DIR/index.ts"
echo "  source -> $PLUGIN_DIR/index.ts"

if grep -q 'id: vision-fallback' "$PATCH_FILE"; then
  echo "  patch entry already present; left unchanged"
else
  {
    echo ""
    echo "# dsh-vision-fallback (added by install.sh)"
    echo "- insert:"
    echo "    - id: vision-fallback"
    echo "      name: '$PLUGIN_DIR/index.ts'"
    echo "      config:"
    echo "        fallbackProvider: opencode-go"
    echo "        fallbackModel: kimi-k2.6"
    echo "        textProviders:"
    echo "          - deepseek-official"
  } >> "$PATCH_FILE"
  echo "  patch entry appended -> $PATCH_FILE"
fi
echo "done. restart dsh to load."
