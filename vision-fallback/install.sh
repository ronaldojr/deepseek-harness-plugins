#!/usr/bin/env bash
set -euo pipefail
# Install dsh-vision-fallback into a DeepSeek Harness profile (dev/no-build path).
# Idempotent: refreshes the source and never duplicates the patch entry.
# A pristine profile patch file is the empty-list template (a bare `[]` line);
# the first entry replaces that empty list instead of appending after it,
# which would leave two YAML documents in one file and fail the profile parse.
# Standard/npm path: `npm install dsh-vision-fallback` then `name: 'dsh-vision-fallback'`.

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-web}"
PLUGIN_DIR="$DSH_HOME/profiles/vision-fallback"
PATCH_FILE="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$PLUGIN_DIR"
cp "$SRC_DIR/src/index.ts" "$PLUGIN_DIR/index.ts"
echo "  source -> $PLUGIN_DIR/index.ts"

# Entry blocks written by install.sh < 1.1.0 carried a `textProviders`
# allowlist; the current plugin defaults to every provider route. Remove the
# exact pair in place so existing installations converge on the next update,
# while hand-edited allowlists (any other value) are preserved.
if grep -q 'id: vision-fallback' "$PATCH_FILE" 2>/dev/null; then
  awk '
    prev ~ /^        textProviders:$/ && $0 ~ /^          - deepseek-official$/ { prev = ""; next }
    { if (prev != "") print prev; prev = $0 }
    END { if (prev != "") print prev }
  ' "$PATCH_FILE" > "$PATCH_FILE.tmp" && mv "$PATCH_FILE.tmp" "$PATCH_FILE"
fi

ENTRY=$(cat <<EOF
# dsh-vision-fallback (added by install.sh)
- insert:
    - id: vision-fallback
      name: '$PLUGIN_DIR/index.ts'
      config:
        fallbackProvider: opencode-go
        fallbackModel: kimi-k2.6
EOF
)

mkdir -p "$(dirname "$PATCH_FILE")"
if grep -q '^\[\]$' "$PATCH_FILE" 2>/dev/null; then
  # Pristine template: replace the empty list with the first entry. Everything
  # else in the file is the template's comment header.
  HEADER="$(grep -v '^\[\]$' "$PATCH_FILE")"
  { printf '%s\n' "$HEADER"; printf '%s\n' "$ENTRY"; } > "$PATCH_FILE"
  echo "  patch entry replaced the empty-list template -> $PATCH_FILE"
elif grep -q 'id: vision-fallback' "$PATCH_FILE" 2>/dev/null; then
  echo "  patch entry already present; left unchanged"
else
  {
    echo ""
    printf '%s\n' "$ENTRY"
  } >> "$PATCH_FILE"
  echo "  patch entry appended -> $PATCH_FILE"
fi
echo "done. restart dsh to load."
