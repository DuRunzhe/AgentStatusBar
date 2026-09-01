#!/bin/bash
set -uo pipefail

OUTPUT_FILE="${1:-/tmp/agent-statusbar-processes}"
ROOTS_FILE="${2:-${OUTPUT_FILE}.roots}"
TEMP_FILE="${OUTPUT_FILE}.$$"
TEMP_ROOTS="${ROOTS_FILE}.$$"

if /bin/ps -axo pid=,ppid=,etime=,tty=,command= \
  | /usr/bin/awk '
      function basename(value) {
        sub(/^.*\//, "", value)
        return value
      }
      function agent_name(  i, name) {
        for (i = 5; i <= NF && i <= 8; i++) {
          name = basename($i)
          if (name == "claude" || name == "codex" || name == "opencode" ||
              name == "dsh" || name == "deepseek-harness" || name == "pi") {
            return name
          }
        }
        return ""
      }
      {
        lines[NR] = $0
        pids[NR] = $1
        ppids[NR] = $2
        parent[$1] = $2
        matched = agent_name()
        if (matched != "") {
          agent_name_by_pid[$1] = matched
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
    function basename(value) {
      sub(/^.*\//, "", value)
      return value
    }
    function agent_name(  i, name) {
      for (i = 5; i <= NF && i <= 8; i++) {
        name = basename($i)
        if (name == "claude" || name == "codex" || name == "opencode" ||
            name == "dsh" || name == "deepseek-harness" || name == "pi") {
          return name
        }
      }
      return ""
    }
    {
      lines[NR] = $0
      pids[NR] = $1
      ppids[NR] = $2
      parent[$1] = $2
      matched = agent_name()
      if (matched != "") {
        agent_name_by_pid[$1] = matched
      }
    }
    END {
      for (i = 1; i <= NR; i++) {
        executable = agent_name_by_pid[pids[i]]
        if (executable == "") continue

        ancestor = ppids[i]
        nested = 0
        while (!nested && ancestor != 0) {
          nested = agent_name_by_pid[ancestor] == executable
          ancestor = parent[ancestor]
        }
        if (!nested) print pids[i] "\t" executable
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
