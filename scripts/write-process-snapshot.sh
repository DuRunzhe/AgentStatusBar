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
        parent[$1] = $2
        command = $4
        sub(/^.*\//, "", command)
        if (command == "claude" || command == "codex" || command == "opencode") {
          agent_pids[$1] = 1
        }
      }
      END {
        for (i = 1; i <= NR; i++) {
          ancestor = ppids[i]
          is_agent_descendant = agent_pids[pids[i]]
          while (!is_agent_descendant && ancestor != 0) {
            is_agent_descendant = agent_pids[ancestor]
            ancestor = parent[ancestor]
          }
          if (is_agent_descendant) print lines[i]
        }
      }
    ' > "$TEMP_FILE"; then
  /bin/mv -f "$TEMP_FILE" "$OUTPUT_FILE"
else
  /bin/rm -f "$TEMP_FILE"
  exit 1
fi
