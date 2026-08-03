#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "$0")" && pwd)"
PLUGIN_DIR="${SWIFTBAR_PLUGIN_DIR:-$HOME/Library/Application Support/SwiftBar/Plugins}"
SOURCE_PATH="$SCRIPT_DIR/agent-monitor.sh"
PLUGIN_PATH="$PLUGIN_DIR/agent-monitor.1s.sh"

mkdir -p "$PLUGIN_DIR"

for existing_path in "$PLUGIN_DIR"/agent-monitor.*.sh; do
  [ -L "$existing_path" ] || continue
  [ "$existing_path" = "$PLUGIN_PATH" ] && continue
  /bin/rm "$existing_path"
done

if [ -e "$PLUGIN_PATH" ] && [ ! -L "$PLUGIN_PATH" ]; then
  printf 'Refusing to replace regular file: %s\n' "$PLUGIN_PATH" >&2
  exit 1
fi

/bin/ln -sfn "$SOURCE_PATH" "$PLUGIN_PATH"
printf '%s\n' "$PLUGIN_PATH"
