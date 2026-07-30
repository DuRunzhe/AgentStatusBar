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
stopped_text = ui.get('statusStopped', 'Stopped')
unknown_text = ui.get('statusUnknown', 'Unknown')
display_config = data.get('display_config', {})

def is_visible(key):
    return display_config.get(key, True) is not False

for a in agents:
    name = a['name']
    instances = a.get('instances', [])

    if not instances:
        print(f'{name}: {stopped_text} | sfimage=circle.fill sfcolor=#8E8E93 color=#8E8E93')
        continue

    for inst in instances:
        emoji = inst.get('emoji', '⚪')
        label = inst.get('label', name)
        state = inst.get('state', 'stopped')
        pids = inst.get('pids', [])
        label_text = inst.get('status_label', unknown_text)

        if state == 'stopped':
            line = f'{label}: {label_text}'
        else:
            line = f'{emoji} {label}: {label_text}'

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
        elif pids:
            line += f' | bash={node_cmd} param0={focus_path} param1={pids[0]} terminal=false'

        print(line)

print('---')
print(f\"{ui.get('settings', 'Settings')} | sfimage=gearshape\")
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
" "$FOCUS_PATH" "$NODE_CMD" "$RESTART_PATH" "$(date '+%H:%M:%S')" "$DISPLAY_CONFIG_PATH" 2>/dev/null
