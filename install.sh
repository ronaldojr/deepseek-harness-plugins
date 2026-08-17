#!/usr/bin/env bash
set -euo pipefail
# Install plugins from this repo.
# Usage:
#   ./install.sh <name>    install one plugin (its folder name)
#   ./install.sh --all     install every plugin

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  --all)
    for d in "$ROOT"/*/; do
      [ -x "$d/install.sh" ] || continue
      echo "=== installing $(basename "$d") ==="
      "$d/install.sh"
    done
    ;;
  "")
    echo "usage: $0 <plugin-name> | --all" >&2
    echo "plugins:" >&2
    for d in "$ROOT"/*/; do [ -x "$d/install.sh" ] && echo "  - $(basename "$d")" >&2; done
    exit 1
    ;;
  *)
    if [ -x "$ROOT/$1/install.sh" ]; then
      echo "=== installing $1 ==="
      "$ROOT/$1/install.sh"
    else
      echo "error: no plugin '$1' (or it has no install.sh)" >&2
      exit 1
    fi
    ;;
esac
