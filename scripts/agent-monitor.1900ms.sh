#!/bin/bash
# <xbar.title>AgentStatusBar</xbar.title>
# <xbar.version>v0.3.0</xbar.version>
# Refresh interval is defined by the .1900ms filename suffix.
# <xbar.author>bitwasher</xbar.author>
# <xbar.desc>AI Coding Agent status monitor with multi-session tracking</xbar.desc>
# <xbar.dependencies>bash,python3</xbar.dependencies>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
# <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>

STATUS_FILE="/tmp/agent-status.json"
LOCALE_FILE="/tmp/agent-statusbar-locale"
UI_JSON_FILE="/tmp/agent-statusbar-ui.json"
PROCESS_SNAPSHOT_FILE="/tmp/agent-statusbar-processes"
PROCESS_SNAPSHOT_LOCK="/tmp/agent-statusbar-processes.lock"
PROCESS_METADATA_FILE="/tmp/agent-statusbar-process-metadata"
PROCESS_METADATA_LOCK="/tmp/agent-statusbar-process-metadata.lock"

resolve_symlink() {
  local src="$1" dir
  while [ -h "$src" ]; do
    dir="$(cd -P "$(dirname "$src")" && pwd)"
    src="$(readlink "$src")"
    [[ $src != /* ]] && src="$dir/$src"
  done
  echo "$(cd -P "$(dirname "$src")" && pwd)"
}

SCRIPT_DIR="$(resolve_symlink "$0")"
NODE_CMD=$(command -v node 2>/dev/null || echo "/usr/local/bin/node")
I18N_PATH="$SCRIPT_DIR/i18n.js"
RENDER_PATH="$SCRIPT_DIR/render-menu.py"
DAEMON_PATH="$SCRIPT_DIR/agent-monitor.js"
RESTART_PATH="$SCRIPT_DIR/restart-agent-monitor.sh"
FOCUS_PATH="$SCRIPT_DIR/focus-agent-session.js"
DISPLAY_CONFIG_PATH="$SCRIPT_DIR/display-config.js"
NOTIFICATION_SETTINGS_PATH="$SCRIPT_DIR/notification-settings.js"
STARTUP_SETTINGS_PATH="$SCRIPT_DIR/startup-settings.js"
PROCESS_SNAPSHOT_PATH="$SCRIPT_DIR/write-process-snapshot.sh"
PROCESS_METADATA_PATH="$SCRIPT_DIR/write-process-metadata.sh"

refresh_locale_cache() {
  local now mtime language_output apple_locale locale line language temp_file
  now=$(date +%s)
  mtime=$(stat -f '%m' "$LOCALE_FILE" 2>/dev/null || echo 0)
  [ $((now - mtime)) -lt 60 ] && return
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

refresh_ui_cache() {
  local locale ui_mtime locale_mtime temp_file
  locale=$(<"$LOCALE_FILE")
  ui_mtime=$(stat -f '%m' "$UI_JSON_FILE" 2>/dev/null || echo 0)
  locale_mtime=$(stat -f '%m' "$LOCALE_FILE" 2>/dev/null || echo 0)
  [ -s "$UI_JSON_FILE" ] && [ "$ui_mtime" -ge "$locale_mtime" ] && return
  temp_file="${UI_JSON_FILE}.$$"
  if "$NODE_CMD" "$I18N_PATH" --json "$locale" > "$temp_file" 2>/dev/null; then
    /bin/mv -f "$temp_file" "$UI_JSON_FILE"
  else
    /bin/rm -f "$temp_file"
  fi
}

refresh_file_async() {
  local target="$1" lock="$2" interval="$3" stale="$4" command_path="$5" now mtime lock_mtime
  now=$(date +%s)
  mtime=$(stat -f '%m' "$target" 2>/dev/null || echo 0)
  [ $((now - mtime)) -lt "$interval" ] && return
  lock_mtime=$(stat -f '%m' "$lock" 2>/dev/null || echo 0)
  if [ "$lock_mtime" -gt 0 ] && [ $((now - lock_mtime)) -ge "$stale" ]; then
    /bin/rmdir "$lock" 2>/dev/null || true
  fi
  /bin/mkdir "$lock" 2>/dev/null || return
  (
    if [ "$target" = "$PROCESS_METADATA_FILE" ]; then
      /bin/bash "$command_path" "$PROCESS_SNAPSHOT_FILE" "$target"
    else
      /bin/bash "$command_path" "$target"
    fi
    /bin/rmdir "$lock" 2>/dev/null || true
  ) </dev/null >/dev/null 2>&1 &
}

refresh_locale_cache
refresh_ui_cache
refresh_file_async "$PROCESS_SNAPSHOT_FILE" "$PROCESS_SNAPSHOT_LOCK" 2 30 "$PROCESS_SNAPSHOT_PATH"
refresh_file_async "$PROCESS_METADATA_FILE" "$PROCESS_METADATA_LOCK" 30 60 "$PROCESS_METADATA_PATH"

if [ ! -f "$STATUS_FILE" ]; then
  DAEMON_NOT_RUNNING=$("$NODE_CMD" "$I18N_PATH" daemonNotRunning 2>/dev/null || echo "Monitor daemon is not running")
  START_DAEMON=$("$NODE_CMD" "$I18N_PATH" startDaemon 2>/dev/null || echo "Start monitor daemon")
  echo "⏳ AgentStatusBar"
  echo "---"
  echo "$DAEMON_NOT_RUNNING | color=red"
  echo "$START_DAEMON | bash=$NODE_CMD param0=$DAEMON_PATH terminal=false"
  exit 0
fi

exec /usr/bin/python3 "$RENDER_PATH" "$STATUS_FILE" "$UI_JSON_FILE" "$FOCUS_PATH" "$NODE_CMD" "$RESTART_PATH" "$DISPLAY_CONFIG_PATH" "$NOTIFICATION_SETTINGS_PATH" "$STARTUP_SETTINGS_PATH"
