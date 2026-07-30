#!/bin/bash
set -uo pipefail

OUTPUT_FILE="${1:-/tmp/agent-statusbar-processes}"
TEMP_FILE="${OUTPUT_FILE}.$$"

if /bin/ps -axo pid=,ppid=,etime=,comm= \
  | /usr/bin/awk '
      {
        lines[NR] = $0
        pids[NR] = $1
        ppids[NR] = $2
        command = $4
        sub(/^.*\//, "", command)
        if (command == "claude" || command == "codex" || command == "opencode") {
          agent_pids[$1] = 1
        }
      }
      END {
        for (i = 1; i <= NR; i++) {
          if (agent_pids[pids[i]] || agent_pids[ppids[i]]) print lines[i]
        }
      }
    ' > "$TEMP_FILE"; then
  /bin/mv -f "$TEMP_FILE" "$OUTPUT_FILE"
else
  /bin/rm -f "$TEMP_FILE"
  exit 1
fi
