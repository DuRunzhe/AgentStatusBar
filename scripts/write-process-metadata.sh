#!/bin/bash
set -uo pipefail

SNAPSHOT_FILE="${1:-/tmp/agent-statusbar-processes}"
OUTPUT_FILE="${2:-/tmp/agent-statusbar-process-metadata}"
TEMP_FILE="${OUTPUT_FILE}.$$"

: > "$TEMP_FILE"
while read -r pid _ppid _elapsed _tty command; do
  [ -n "${pid:-}" ] || continue
  executable="${command%% *}"
  name="${executable##*/}"
  case "$name" in
    codex|opencode) ;;
    *) continue ;;
  esac

  /usr/sbin/lsof -Fn -p "$pid" 2>/dev/null \
    | /usr/bin/awk -v pid="$pid" '
        $0 == "fcwd" { want_cwd = 1; next }
        want_cwd && /^n/ {
          print pid "\tcwd\t" substr($0, 2)
          want_cwd = 0
          next
        }
        /^n/ {
          file = substr($0, 2)
          if ((file ~ /\/\.codex\/sessions\// && file ~ /\.jsonl$/) ||
              (file ~ /\/opencode\// && file ~ /\/storage\//)) {
            print pid "\tfile\t" file
          }
        }
      ' >> "$TEMP_FILE" || true
done < "$SNAPSHOT_FILE"

/bin/mv -f "$TEMP_FILE" "$OUTPUT_FILE"
