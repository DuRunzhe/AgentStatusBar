#!/bin/bash
set -uo pipefail

LAUNCH_AGENT_PATH="${AGENT_STATUSBAR_LAUNCH_AGENT_PATH:-$HOME/Library/LaunchAgents/com.agentstatusbar.monitor.plist}"
PLIST_BUDDY="${AGENT_STATUSBAR_PLIST_BUDDY:-/usr/libexec/PlistBuddy}"

resolve_command() {
  local name="$1" resolved candidate
  shift
  resolved=$(command -v "$name" 2>/dev/null || true)
  if [ -n "$resolved" ]; then
    printf '%s\n' "$resolved"
    return
  fi
  for candidate in "$@"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
}

resolve_launch_agent_node() {
  local node_path
  [ -r "$LAUNCH_AGENT_PATH" ] || return
  [ -x "$PLIST_BUDDY" ] || return
  node_path=$("$PLIST_BUDDY" -c 'Print :ProgramArguments:0' "$LAUNCH_AGENT_PATH" 2>/dev/null || true)
  if [ -x "$node_path" ]; then
    printf '%s\n' "$node_path"
  fi
}

RESOLVED_NODE_PATH=$(resolve_launch_agent_node)
if [ -n "$RESOLVED_NODE_PATH" ]; then
  printf '%s\n' "$RESOLVED_NODE_PATH"
else
  resolve_command node /opt/homebrew/bin/node /usr/local/bin/node
fi
