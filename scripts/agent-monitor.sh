#!/bin/bash
# <xbar.title>AgentStatusBar</xbar.title>
# <xbar.version>v0.3.0</xbar.version>
# The SwiftBar refresh interval is defined by the installed symlink name.
# <xbar.author>bitwasher</xbar.author>
# <xbar.desc>AI Coding Agent status monitor with multi-session tracking</xbar.desc>
# <xbar.dependencies>bash,python3</xbar.dependencies>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
# <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>

set -uo pipefail

STATUS_FILE="/tmp/agent-status.json"
LOCALE_FILE="/tmp/agent-statusbar-locale"
LOCALE_REFRESH_SEC=60
PROCESS_SNAPSHOT_FILE="/tmp/agent-statusbar-processes"
PROCESS_SNAPSHOT_LOCK="/tmp/agent-statusbar-processes.lock"
PROCESS_METADATA_FILE="/tmp/agent-statusbar-process-metadata"
PROCESS_METADATA_LOCK="/tmp/agent-statusbar-process-metadata.lock"
TERMINAL_STATE_FILE="/tmp/agent-statusbar-terminal-state.json"
TERMINAL_PROBE_REQUEST_FILE="/tmp/agent-statusbar-terminal-probe-request.json"
TERMINAL_PROBE_LOCK="/tmp/agent-statusbar-terminal-probe.lock"

resolve_script_dir() {
  local src="$1" dir target
  while [ -h "$src" ]; do
    dir="${src%/*}"
    [ "$dir" = "$src" ] && dir="."
    dir="$(cd -P "$dir" && pwd)"
    target="$(readlink "$src")"
    case "$target" in
      /*) src="$target" ;;
      *) src="$dir/$target" ;;
    esac
  done
  dir="${src%/*}"
  [ "$dir" = "$src" ] && dir="."
  cd -P "$dir" && pwd
}

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

SCRIPT_DIR="$(resolve_script_dir "$0")"
NODE_CMD=$(resolve_command node /opt/homebrew/bin/node /usr/local/bin/node)
PYTHON_CMD=$(resolve_command python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3)
DAEMON_PATH="$SCRIPT_DIR/agent-monitor.js"
RESTART_PATH="$SCRIPT_DIR/restart-agent-monitor.sh"
FOCUS_PATH="$SCRIPT_DIR/focus-agent-session.js"
I18N_PATH="$SCRIPT_DIR/i18n.js"
DISPLAY_CONFIG_PATH="$SCRIPT_DIR/display-config.js"
NOTIFICATION_SETTINGS_PATH="$SCRIPT_DIR/notification-settings.js"
STARTUP_SETTINGS_PATH="$SCRIPT_DIR/startup-settings.js"
PROCESS_SNAPSHOT_PATH="$SCRIPT_DIR/write-process-snapshot.sh"
PROCESS_METADATA_PATH="$SCRIPT_DIR/write-process-metadata.sh"
TERMINAL_PROBE_PATH="$SCRIPT_DIR/terminal-prompt-state.js"
RENDER_PATH="$SCRIPT_DIR/render-menu.py"
NOW=$(date +%s)

refresh_locale_cache() {
  local now="$1" mtime language_output apple_locale locale line language temp_file
  mtime=$(stat -f '%m' "$LOCALE_FILE" 2>/dev/null || echo 0)
  [ $((now - mtime)) -lt "$LOCALE_REFRESH_SEC" ] && return

  language_output=$(/usr/bin/defaults read -g AppleLanguages 2>/dev/null || true)
  apple_locale=$(/usr/bin/defaults read -g AppleLocale 2>/dev/null || true)
  locale=""
  while IFS= read -r line; do
    language=$(printf '%s' "$line" | /usr/bin/sed -E 's/^[[:space:],("]+//; s/[[:space:],)"]+$//')
    case "$language" in
      zh-Hant*|zh_TW*|zh-HK*|zh_HK*|zh-MO*|zh_MO*) locale="zh-Hant"; break ;;
      zh|zh-Hans*|zh_CN*|zh-SG*|zh_SG*) locale="zh-Hans"; break ;;
      en|en-*|en_*) locale="en"; break ;;
    esac
  done <<< "$language_output"
  if [ -z "$locale" ]; then
    case "$apple_locale" in
      *[_-]TW*|*[_-]HK*|*[_-]MO*) locale="zh-Hant" ;;
      *[_-]CN*|*[_-]SG*) locale="zh-Hans" ;;
      *) locale="en" ;;
    esac
  fi

  temp_file="${LOCALE_FILE}.$$"
  printf '%s\n' "$locale" > "$temp_file"
  /bin/mv -f "$temp_file" "$LOCALE_FILE"
}

refresh_file_async() {
  local target="$1" lock="$2" interval="$3" stale="$4" command_path="$5" mode="$6"
  local mtime lock_mtime
  mtime=$(stat -f '%m' "$target" 2>/dev/null || echo 0)
  [ $((NOW - mtime)) -lt "$interval" ] && return

  lock_mtime=$(stat -f '%m' "$lock" 2>/dev/null || echo 0)
  if [ "$lock_mtime" -gt 0 ] && [ $((NOW - lock_mtime)) -ge "$stale" ]; then
    /bin/rmdir "$lock" 2>/dev/null || true
  fi
  /bin/mkdir "$lock" 2>/dev/null || return

  (
    if [ "$mode" = "metadata" ]; then
      /bin/bash "$command_path" "$PROCESS_SNAPSHOT_FILE" "$target"
    else
      /bin/bash "$command_path" "$target"
    fi
    /bin/rmdir "$lock" 2>/dev/null || true
  ) </dev/null >/dev/null 2>&1 &
}

refresh_terminal_state() {
  local request_mtime state_mtime lock_mtime
  [ -n "$NODE_CMD" ] || return
  [ -f "$TERMINAL_PROBE_REQUEST_FILE" ] || return
  request_mtime=$(stat -f '%m' "$TERMINAL_PROBE_REQUEST_FILE" 2>/dev/null || echo 0)
  state_mtime=$(stat -f '%m' "$TERMINAL_STATE_FILE" 2>/dev/null || echo 0)
  [ "$state_mtime" -ge "$request_mtime" ] && return

  lock_mtime=$(stat -f '%m' "$TERMINAL_PROBE_LOCK" 2>/dev/null || echo 0)
  if [ "$lock_mtime" -gt 0 ] && [ $((NOW - lock_mtime)) -ge 10 ]; then
    /bin/rmdir "$TERMINAL_PROBE_LOCK" 2>/dev/null || true
  fi
  /bin/mkdir "$TERMINAL_PROBE_LOCK" 2>/dev/null || return

  (
    "$NODE_CMD" "$TERMINAL_PROBE_PATH" \
      --output "$TERMINAL_STATE_FILE" \
      --request "$TERMINAL_PROBE_REQUEST_FILE"
    /bin/rmdir "$TERMINAL_PROBE_LOCK" 2>/dev/null || true
  ) </dev/null >/dev/null 2>&1 &
}

refresh_locale_cache "$NOW"
refresh_file_async "$PROCESS_SNAPSHOT_FILE" "$PROCESS_SNAPSHOT_LOCK" 2 30 "$PROCESS_SNAPSHOT_PATH" snapshot
refresh_file_async "$PROCESS_METADATA_FILE" "$PROCESS_METADATA_LOCK" 30 60 "$PROCESS_METADATA_PATH" metadata
refresh_terminal_state

if [ ! -f "$STATUS_FILE" ]; then
  if [ -n "$NODE_CMD" ]; then
    DAEMON_NOT_RUNNING=$("$NODE_CMD" "$I18N_PATH" daemonNotRunning 2>/dev/null || echo "Monitor daemon is not running")
    START_DAEMON=$("$NODE_CMD" "$I18N_PATH" startDaemon 2>/dev/null || echo "Start monitor daemon")
  else
    DAEMON_NOT_RUNNING="Monitor daemon is not running"
    START_DAEMON="Start monitor daemon"
  fi
  echo "⏳ AgentStatusBar"
  echo "---"
  echo "$DAEMON_NOT_RUNNING | color=red"
  if [ -n "$NODE_CMD" ]; then
    echo "$START_DAEMON | bash=$NODE_CMD param0=$DAEMON_PATH terminal=false"
  fi
  exit 0
fi

if [ -z "$PYTHON_CMD" ]; then
  echo "⚠️ AgentStatusBar"
  echo "---"
  echo "Python 3 is required | color=red"
  exit 0
fi

exec "$PYTHON_CMD" "$RENDER_PATH" \
  "$STATUS_FILE" \
  "$FOCUS_PATH" \
  "$NODE_CMD" \
  "$RESTART_PATH" \
  "$DISPLAY_CONFIG_PATH" \
  "$NOTIFICATION_SETTINGS_PATH" \
  "$STARTUP_SETTINGS_PATH"
