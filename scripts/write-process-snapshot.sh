#!/bin/bash
set -uo pipefail

OUTPUT_FILE="${1:-/tmp/agent-statusbar-processes}"
ROOTS_FILE="${2:-${OUTPUT_FILE}.roots}"
TEMP_FILE="${OUTPUT_FILE}.$$"
TEMP_ROOTS="${ROOTS_FILE}.$$"

if /bin/ps -axo pid=,ppid=,etime=,tty=,command= \
  | /usr/bin/awk '
      {
        lines[NR] = $0
        pids[NR] = $1
        ppids[NR] = $2
        parent[$1] = $2
        command = $5
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
  /usr/bin/awk '
    {
      executable = $5
      sub(/^.*\//, "", executable)
      if (executable == "claude" || executable == "codex" || executable == "opencode") {
        print $1 "\t" executable
      }
    }
  ' "$TEMP_FILE" > "$TEMP_ROOTS"
  /bin/mv -f "$TEMP_FILE" "$OUTPUT_FILE"
  if [ ! -f "$ROOTS_FILE" ] || ! /usr/bin/cmp -s "$TEMP_ROOTS" "$ROOTS_FILE"; then
    /bin/mv -f "$TEMP_ROOTS" "$ROOTS_FILE"
  else
    /bin/rm -f "$TEMP_ROOTS"
  fi
else
  /bin/rm -f "$TEMP_FILE" "$TEMP_ROOTS"
  exit 1
fi
