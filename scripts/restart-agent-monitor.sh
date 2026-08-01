#!/bin/bash
set -uo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "$0")" && pwd)"
DAEMON_PATH="$SCRIPT_DIR/agent-monitor.js"
SERVICE="gui/$(id -u)/com.agentstatusbar.monitor"
PROCESS_SNAPSHOT_FILE="/tmp/agent-statusbar-processes"
PROCESS_SNAPSHOT_PATH="$SCRIPT_DIR/write-process-snapshot.sh"
PROCESS_METADATA_FILE="/tmp/agent-statusbar-process-metadata"
PROCESS_METADATA_PATH="$SCRIPT_DIR/write-process-metadata.sh"

/bin/bash "$PROCESS_SNAPSHOT_PATH" "$PROCESS_SNAPSHOT_FILE" || true
/bin/bash "$PROCESS_METADATA_PATH" "$PROCESS_SNAPSHOT_FILE" "$PROCESS_METADATA_FILE" || true

MANAGED_PID=$(/bin/launchctl print "$SERVICE" 2>/dev/null \
  | /usr/bin/awk '$1 == "pid" && $2 == "=" { print $3; exit }')

for pid in $(/usr/bin/pgrep -f "$DAEMON_PATH" 2>/dev/null || true); do
  [ "$pid" = "$MANAGED_PID" ] && continue
  command=$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)
  if [[ "$command" == *" $DAEMON_PATH" ]]; then
    /bin/kill "$pid" 2>/dev/null || true
  fi
done

/bin/launchctl kickstart -k "$SERVICE"
