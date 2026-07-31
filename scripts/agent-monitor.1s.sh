#!/bin/bash
# <xbar.title>Agent Monitor</xbar.title>
# <xbar.version>v0.2.0</xbar.version>
# <xbar.author>bitwasher</xbar.author>
# <xbar.desc>AI Coding Agent status monitor with multi-session tracking</xbar.desc>
# <xbar.dependencies>bash,python3</xbar.dependencies>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
# <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>

STATUS_FILE="/tmp/agent-status.json"
LOCALE_FILE="/tmp/agent-statusbar-locale"
LOCALE_REFRESH_SEC=60
PROCESS_SNAPSHOT_FILE="/tmp/agent-statusbar-processes"
PROCESS_SNAPSHOT_LOCK="/tmp/agent-statusbar-processes.lock"
PROCESS_REFRESH_SEC=2
PROCESS_METADATA_FILE="/tmp/agent-statusbar-process-metadata"
PROCESS_METADATA_LOCK="/tmp/agent-statusbar-process-metadata.lock"
PROCESS_METADATA_REFRESH_SEC=30

refresh_locale_cache() {
  local now mtime language_output apple_locale locale line language temp_file
  now=$(date +%s)
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

refresh_locale_cache

refresh_process_snapshot() {
  local now mtime lock_mtime
  now=$(date +%s)
  mtime=$(stat -f '%m' "$PROCESS_SNAPSHOT_FILE" 2>/dev/null || echo 0)
  [ $((now - mtime)) -lt "$PROCESS_REFRESH_SEC" ] && return

  lock_mtime=$(stat -f '%m' "$PROCESS_SNAPSHOT_LOCK" 2>/dev/null || echo 0)
  if [ "$lock_mtime" -gt 0 ] && [ $((now - lock_mtime)) -ge 30 ]; then
    /bin/rmdir "$PROCESS_SNAPSHOT_LOCK" 2>/dev/null || true
  fi
  /bin/mkdir "$PROCESS_SNAPSHOT_LOCK" 2>/dev/null || return

  (
    /bin/bash "$PROCESS_SNAPSHOT_PATH" "$PROCESS_SNAPSHOT_FILE"
    /bin/rmdir "$PROCESS_SNAPSHOT_LOCK" 2>/dev/null || true
  ) </dev/null >/dev/null 2>&1 &
}

refresh_process_metadata() {
  local now mtime lock_mtime
  now=$(date +%s)
  mtime=$(stat -f '%m' "$PROCESS_METADATA_FILE" 2>/dev/null || echo 0)
  [ $((now - mtime)) -lt "$PROCESS_METADATA_REFRESH_SEC" ] && return

  lock_mtime=$(stat -f '%m' "$PROCESS_METADATA_LOCK" 2>/dev/null || echo 0)
  if [ "$lock_mtime" -gt 0 ] && [ $((now - lock_mtime)) -ge 60 ]; then
    /bin/rmdir "$PROCESS_METADATA_LOCK" 2>/dev/null || true
  fi
  /bin/mkdir "$PROCESS_METADATA_LOCK" 2>/dev/null || return

  (
    /bin/bash "$PROCESS_METADATA_PATH" "$PROCESS_SNAPSHOT_FILE" "$PROCESS_METADATA_FILE"
    /bin/rmdir "$PROCESS_METADATA_LOCK" 2>/dev/null || true
  ) </dev/null >/dev/null 2>&1 &
}

# 动态查找 node 路径，兼容 Intel/Apple Silicon
NODE_CMD=$(command -v node 2>/dev/null || echo "/usr/local/bin/node")

# 解析当前脚本的 symlink 到真实安装目录
# SwiftBar 插件是 symlink，沿链找到原始路径
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
DAEMON_PATH="$SCRIPT_DIR/agent-monitor.js"
RESTART_PATH="$SCRIPT_DIR/restart-agent-monitor.sh"
FOCUS_PATH="$SCRIPT_DIR/focus-agent-session.js"
I18N_PATH="$SCRIPT_DIR/i18n.js"
DISPLAY_CONFIG_PATH="$SCRIPT_DIR/display-config.js"
NOTIFICATION_SETTINGS_PATH="$SCRIPT_DIR/notification-settings.js"
PROCESS_SNAPSHOT_PATH="$SCRIPT_DIR/write-process-snapshot.sh"
PROCESS_METADATA_PATH="$SCRIPT_DIR/write-process-metadata.sh"

refresh_process_snapshot
refresh_process_metadata

if [ ! -f "$STATUS_FILE" ]; then
  DAEMON_NOT_RUNNING=$("$NODE_CMD" "$I18N_PATH" daemonNotRunning 2>/dev/null || echo "Monitor daemon is not running")
  START_DAEMON=$("$NODE_CMD" "$I18N_PATH" startDaemon 2>/dev/null || echo "Start monitor daemon")
  echo "⏳ Agent Monitor"
  echo "---"
  echo "$DAEMON_NOT_RUNNING | color=red"
  echo "$START_DAEMON | bash=$NODE_CMD param0=$DAEMON_PATH terminal=false"
  exit 0
fi

DATA=$(cat "$STATUS_FILE")

# Summary line — shows in menu bar
SUMMARY=$(echo "$DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary'])" 2>/dev/null)
case "$SUMMARY" in
  "🟡 "*)
    SUMMARY_TEXT="${SUMMARY#🟡 }"
    FRAME=$(($(date +%s) % 2))
    WAITING_IMAGE_LOW="iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAtElEQVR42u2X3QnFIAxGs0O36HBu4QDZxTHMFhkj0L6kcLlQNK0hFnw4L6J8B38jEAJEAktgCRgHbISQCKEQAhOCKKxtSfu4CGQNOxqI9h0msBNC7Qj+p+rYVwK7Tu/xEG5JtATqi/DfmXgkkAeEX2SrwNa54XqRu9NxJ5AGhl8ki0BxECgWAXYQYIuAOAjIpwTClyB8E4Yfw/CLKPwqnuIxmuI5Di9IpijJpilK179gCbhwAlsP8v9bmV0UAAAAAElFTkSuQmCC"
    WAITING_IMAGE_HIGH="iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAsUlEQVR42u2X2wkEIQxF08N0McXZhR1Zxi0jZQSyPxlYFgbNjCEu+HF+RLkHn5EURJnQFtgCzgGHgoqCmoJYQWKwtRXrEyJQLUw7iPWdJnAqCAPBv8DGvhI4bXr1IdyT6AngRfj3TDwSqBPCL6pX4BjccKPI3em4EygTwy+KR6AFCDSPAAcIsEdAAgTkrwTSlyB9E6Yfw/SLKP0qXuIxWuI5Ti9IlijJlilK979gC4TwAQsxpx38+46EAAAAAElFTkSuQmCC"
    if [ "$FRAME" -eq 0 ]; then
      WAITING_IMAGE="$WAITING_IMAGE_LOW"
    else
      WAITING_IMAGE="$WAITING_IMAGE_HIGH"
    fi
    echo "$SUMMARY_TEXT | image=$WAITING_IMAGE"
    ;;
  "🔵 "*)
    SUMMARY_TEXT="${SUMMARY#🔵 }"
    FRAME=$((($(date +%s) / 2) % 2))
    WORKING_IMAGE_MEDIUM="iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAGxlWElmTU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAACQAAAAAQAAAJAAAAABAAKgAgAEAAAAAQAAACCgAwAEAAAAAQAAACAAAAAAxqyL9QAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAalJREFUWAntVjtOAzEQfQ4UEVVKfg0HIB3Q5QJQRJyAIyAkaHIDkBBH4ASIhktAxwVogFBuhVKAzLy1UiSesTebBZqdIivPzrx5mbX9Bmit7cA/d8AtVP/U99DFMRwOJa8vz/Uy3+NDns/weMAEd7hxRVXcagROfBcbOJOC5wLcy4AXQuQKY1zj1k0ysQKZswu/iRXcS+ReLnTmvccTvjHEpXuf8c8t0gRYfBWPkrM1l1dt6fEqJA5SJDomEtvOf163OIEdtksMYhlmEwjffLG2a0X46YhlmP4JuNvX8CI5uQ1nwEbuAp/Y0U6H3gEeteaKk004vhEvQCfQwZESu5wr3B0Rhk7AYzeKXN7R1yB0AtMbTsuo6zMwdQJ1i9TI0wmEu70GXCLFwNQJUFiaNxVTJ0BVa9oMTJ0AJRWoLKkVuBalTCuBOgHqOSW1KSOWMSPoBFiYek5JXdaIQSzDbAIcJqjnwJuRm3cHOR6mBhObAOE5THxhv1YnwkCSnAVYIk1gSmKMgZAYybLKxuT+GUnbB6lBhNA0XY7Du/j3F4bSuEjraTvwxx34AWIobxkjPBl/AAAAAElFTkSuQmCC"
    WORKING_IMAGE_LARGE="iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAGxlWElmTU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAACQAAAAAQAAAJAAAAABAAKgAgAEAAAAAQAAACCgAwAEAAAAAQAAACAAAAAAxqyL9QAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAflJREFUWAnlVz1LxEAQfXug/oErBAVbDzsRtFPB66w8wR9icydYKd5Z+EME7ews/KgUxE6uFk6wyB/QQ9eZTTa7+bx4bmJxA8lsdmfnvUyS3Rdg0k0UL4AUaGOZ4rchsEF+nvysmi/xTn4AiVvyV+jhGRBSjY04FSPQli3UcES5GiPy6eE+vnGInrjUHVk+n8C+XMA0zulOV7MS5PZLPOITezgTr1lx2QQ6cp2AL2hiPWtywX4PX2jhVNynxacTYHDgmghMpU36dZ/EkB7JVhqJJAEu+wyeCOSvdx7n6eEDK/HHUYtHqWfuHpxh6kHuCGSUAL/t475wkbQZF5ybMSyzCNB3LnBsjZXTVJ8zYQVmCPAiI7CoB0r0jWBBUxCGAK9w1VmIZQgIbFaG7y/liQrMVUaA95HA7Ar4G4seKdPrTYwwDIEyAXNyGwL+lpoT6nDIwjIEgDeHEKNSDXSAISBxoztL975wUTCGACuZ6izECpdEgJbHA7wQh6KqZ1y6fZxgSUs2qwKk4VhGlW0Kw+hFqwIBckc+lLYjskTrijX7Hq0KBN2s4QDPDnLU9pQ+jCVLEmABKbFLxzAWO/4l5+KcKeI0SYBhuuKOzk06XFSCczSDnNSMWvIdsMf/VZaHRNQf0Y5SS8UFi6Mfk5AENxQR579mEYiJvPgBOsR5RMAASPEAAAAASUVORK5CYII="
    if [ "$FRAME" -eq 0 ]; then
      WORKING_IMAGE="$WORKING_IMAGE_MEDIUM"
    else
      WORKING_IMAGE="$WORKING_IMAGE_LARGE"
    fi
    echo "$SUMMARY_TEXT | image=$WORKING_IMAGE"
    ;;
  "⚪ "*)
    echo "${SUMMARY#⚪ } | sfimage=circle.fill sfcolor=#8E8E93 color=#8E8E93"
    ;;
  *)
    echo "$SUMMARY"
    ;;
esac

# --- Dropdown menu ---
echo "---"

# Show each agent → instances
echo "$DATA" | python3 -c "
import sys, json

def format_tokens(value):
    if value >= 1_000_000:
        return f'{value / 1_000_000:.1f}m'
    if value >= 1_000:
        return f'{value / 1_000:.0f}k'
    return str(value)

data = json.load(sys.stdin)
agents = data.get('agents', [])
ui = data.get('ui', {})
focus_path = sys.argv[1]
node_cmd = sys.argv[2]
restart_path = sys.argv[3]
refresh_time = sys.argv[4]
display_config_path = sys.argv[5]
notification_settings_path = sys.argv[6]
stopped_text = ui.get('statusStopped', 'Stopped')
unknown_text = ui.get('statusUnknown', 'Unknown')
display_config = data.get('display_config', {})

# Apple Color Emoji rendered at menu-icon resolution. Using SwiftBar's native
# image slot keeps every row aligned while preserving the original emoji art.
state_images = {
    'waiting': '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',
    'waiting_reply': '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',
    'working': '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',
    'ready': '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',
}

def is_visible(key):
    return display_config.get(key, True) is not False

for a in agents:
    name = a['name']
    instances = a.get('instances', [])

    if not instances:
        print(f'{name}: {stopped_text} | sfimage=circle.fill sfcolor=#8E8E93 color=#8E8E93')
        continue

    for inst in instances:
        label = inst.get('label', name)
        state = inst.get('state', 'stopped')
        pids = inst.get('pids', [])
        label_text = inst.get('status_label', unknown_text)

        if state == 'stopped':
            line = f'{label}: {label_text}'
        else:
            line = f'{label}: {label_text}'

        # Append uptime
        uptime = inst.get('uptime_sec', 0)
        if is_visible('duration') and pids and uptime > 0:
            if uptime < 60:
                line += f' ({uptime}s)'
            elif uptime < 3600:
                line += f' ({uptime//60}m{uptime%60}s)'
            else:
                h = uptime // 3600
                m = (uptime % 3600) // 60
                line += f' ({h}h{m}m)'

        context = inst.get('context_usage')
        model = inst.get('model')
        if is_visible('model') and model:
            line += f' · {model}'

        if context:
            used = format_tokens(context['used_tokens'])
            window = format_tokens(context['window_tokens'])
            percent = context['percent']
            show_percent = is_visible('contextPercent')
            show_used = is_visible('contextUsed')
            show_total = is_visible('contextTotal')
            if show_percent:
                line += f' · {percent:.1f}%'
            if show_used and show_total:
                separator = ' ' if show_percent else ' · '
                line += f'{separator}({used}/{window})'
            elif show_used:
                line += f\" · {ui.get('contextUsed', 'Used')} {used}\"
            elif show_total:
                line += f\" · {ui.get('contextTotal', 'Total')} {window}\"

        if state == 'stopped':
            line += ' | sfimage=circle.fill sfcolor=#8E8E93 color=#8E8E93'
        else:
            image = state_images.get(state, state_images['ready'])
            line += f' | image={image}'
            if pids:
                line += f' bash={node_cmd} param0={focus_path} param1={pids[0]} terminal=false'

        print(line)

print('---')
print(f\"{ui.get('settings', 'Settings')} | sfimage=gearshape\")
notifications_enabled = data.get('notifications_enabled') is True
notification_action = ui.get('disableNotifications', 'Click to disable notifications') if notifications_enabled else ui.get('enableNotifications', 'Click to enable notifications')
notification_icon = 'bell.fill' if notifications_enabled else 'bell.slash'
notification_color = '#34C759' if notifications_enabled else '#8E8E93'
print(f\"--{ui.get('notifications', 'Notifications')} | sfimage=bell\")
print(f\"----{notification_action} | bash={node_cmd} param0={notification_settings_path} param1=toggle terminal=false refresh=true sfimage={notification_icon} sfcolor={notification_color}\")
print(f\"----{ui.get('openNotificationSettings', 'Open System Notification Settings')} | bash={node_cmd} param0={notification_settings_path} param1=open-settings terminal=false sfimage=gearshape\")
print(f\"----{ui.get('notificationSettingsApp', 'App shown in Notifications: terminal-notifier')} | sfimage=app.badge disabled=true\")
print(f\"--{ui.get('displayConfig', 'Display options')} | sfimage=slider.horizontal.3\")
setting_items = [
    ('duration', 'showDuration', 'Duration'),
    ('model', 'showModel', 'Model'),
    ('contextPercent', 'showContextPercent', 'Context usage percentage'),
    ('contextUsed', 'showContextUsed', 'Context used'),
    ('contextTotal', 'showContextTotal', 'Total context'),
]
for key, label_key, fallback in setting_items:
    checked = ' checked=true' if is_visible(key) else ''
    label = ui.get(label_key, fallback)
    print(f'----{label} | bash={node_cmd} param0={display_config_path} param1=toggle param2={key} terminal=false refresh=true{checked}')
print('---')
print(f\"{ui.get('lastUpdated', 'Last updated')}: {refresh_time} | color=gray size=10\")
print(f\"{ui.get('refreshNow', 'Refresh now')} | refresh=true\")
print(f\"{ui.get('restartDaemon', 'Restart monitor daemon')} | bash=/bin/bash param0={restart_path} terminal=false refresh=true\")
" "$FOCUS_PATH" "$NODE_CMD" "$RESTART_PATH" "$(date '+%H:%M:%S')" "$DISPLAY_CONFIG_PATH" "$NOTIFICATION_SETTINGS_PATH" 2>/dev/null
