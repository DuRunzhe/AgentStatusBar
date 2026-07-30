#!/bin/bash
set -uo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "$0")" && pwd)"
DAEMON_PATH="$SCRIPT_DIR/agent-monitor.js"
SERVICE="gui/$(id -u)/openclaw.agent-monitor"

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
