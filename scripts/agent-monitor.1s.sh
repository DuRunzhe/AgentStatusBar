#!/bin/bash
# <xbar.title>Agent Monitor</xbar.title>
# <xbar.version>v0.2.0</xbar.version>
# <xbar.author>bitwasher</xbar.author>
# <xbar.desc>AI Coding Agent 运行状态指示器，支持多实例追踪 (Claude/Codex/OpenCode)</xbar.desc>
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

if [ ! -f "$STATUS_FILE" ]; then
  echo "⏳ Agent Monitor"
  echo "---"
  echo "监控守护进程未启动 | color=red"
  echo "启动守护进程 | bash=$NODE_CMD param0=$DAEMON_PATH terminal=false"
  exit 0
fi

DATA=$(cat "$STATUS_FILE")

# Summary line — shows in menu bar
SUMMARY=$(echo "$DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary'])" 2>/dev/null)
case "$SUMMARY" in
  "🔵 "*)
    SUMMARY_TEXT="${SUMMARY#🔵 }"
    FRAME=$(($(date +%s) % 4))
    WORKING_IMAGE_SMALL="iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAGxlWElmTU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAACQAAAAAQAAAJAAAAABAAKgAgAEAAAAAQAAACCgAwAEAAAAAQAAACAAAAAAxqyL9QAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAATFJREFUWAntlcEJwkAQRf8KVuDdAgSrEA82EvCoNyvw6CkKacRDsArBArxbgZB1foKEhCQzCbllBwQ3yZ95O7v7FwgROhA6MPUOuN4NOPkVPCI4bOW3zPUeb3mWyjjB2b365LQDRH6OBS5SZC8FZi1FMgG54YMDEvdt+aby2AZQFL9L8U1F3TbweAjEzgLRNpNq6mLmtuJUEpQaQ+gd4Jo7PCWXDbYsyuVYa3tCT8oN1784MWb5Zi2BGv/pANztQ8OgtQAUR20IxP+Ydmh1gA7xGK90AJrM0DBoLQDp0Pq5OypiHYD2CmRKnqbXmRxfajtDB6C30177hsdV8wCm1AH4Fb2d9mqNwoqPls9tALxY6O0esSTtWg66X2y9BwioW3F9GiNfx/X0YRw6EDowvQ78AL9mTcBEheGCAAAAAElFTkSuQmCC"
    WORKING_IMAGE_MEDIUM="iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAGxlWElmTU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAACQAAAAAQAAAJAAAAABAAKgAgAEAAAAAQAAACCgAwAEAAAAAQAAACAAAAAAxqyL9QAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAalJREFUWAntVjtOAzEQfQ4UEVVKfg0HIB3Q5QJQRJyAIyAkaHIDkBBH4ASIhktAxwVogFBuhVKAzLy1UiSesTebBZqdIivPzrx5mbX9Bmit7cA/d8AtVP/U99DFMRwOJa8vz/Uy3+NDns/weMAEd7hxRVXcagROfBcbOJOC5wLcy4AXQuQKY1zj1k0ysQKZswu/iRXcS+ReLnTmvccTvjHEpXuf8c8t0gRYfBWPkrM1l1dt6fEqJA5SJDomEtvOf163OIEdtksMYhlmEwjffLG2a0X46YhlmP4JuNvX8CI5uQ1nwEbuAp/Y0U6H3gEeteaKk004vhEvQCfQwZESu5wr3B0Rhk7AYzeKXN7R1yB0AtMbTsuo6zMwdQJ1i9TI0wmEu70GXCLFwNQJUFiaNxVTJ0BVa9oMTJ0AJRWoLKkVuBalTCuBOgHqOSW1KSOWMSPoBFiYek5JXdaIQSzDbAIcJqjnwJuRm3cHOR6mBhObAOE5THxhv1YnwkCSnAVYIk1gSmKMgZAYybLKxuT+GUnbB6lBhNA0XY7Du/j3F4bSuEjraTvwxx34AWIobxkjPBl/AAAAAElFTkSuQmCC"
    WORKING_IMAGE_LARGE="iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAGxlWElmTU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAACQAAAAAQAAAJAAAAABAAKgAgAEAAAAAQAAACCgAwAEAAAAAQAAACAAAAAAxqyL9QAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAflJREFUWAnlVz1LxEAQfXug/oErBAVbDzsRtFPB66w8wR9icydYKd5Z+EME7ews/KgUxE6uFk6wyB/QQ9eZTTa7+bx4bmJxA8lsdmfnvUyS3Rdg0k0UL4AUaGOZ4rchsEF+nvysmi/xTn4AiVvyV+jhGRBSjY04FSPQli3UcES5GiPy6eE+vnGInrjUHVk+n8C+XMA0zulOV7MS5PZLPOITezgTr1lx2QQ6cp2AL2hiPWtywX4PX2jhVNynxacTYHDgmghMpU36dZ/EkB7JVhqJJAEu+wyeCOSvdx7n6eEDK/HHUYtHqWfuHpxh6kHuCGSUAL/t475wkbQZF5ybMSyzCNB3LnBsjZXTVJ8zYQVmCPAiI7CoB0r0jWBBUxCGAK9w1VmIZQgIbFaG7y/liQrMVUaA95HA7Ar4G4seKdPrTYwwDIEyAXNyGwL+lpoT6nDIwjIEgDeHEKNSDXSAISBxoztL975wUTCGACuZ6izECpdEgJbHA7wQh6KqZ1y6fZxgSUs2qwKk4VhGlW0Kw+hFqwIBckc+lLYjskTrijX7Hq0KBN2s4QDPDnLU9pQ+jCVLEmABKbFLxzAWO/4l5+KcKeI0SYBhuuKOzk06XFSCczSDnNSMWvIdsMf/VZaHRNQf0Y5SS8UFi6Mfk5AENxQR579mEYiJvPgBOsR5RMAASPEAAAAASUVORK5CYII="
    case "$FRAME" in
      0) WORKING_IMAGE="$WORKING_IMAGE_SMALL" ;;
      2) WORKING_IMAGE="$WORKING_IMAGE_LARGE" ;;
      *) WORKING_IMAGE="$WORKING_IMAGE_MEDIUM" ;;
    esac
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

data = json.load(sys.stdin)
agents = data.get('agents', [])

for a in agents:
    name = a['name']
    instances = a.get('instances', [])

    if not instances:
        print(f'{name}: 已停止 | sfimage=circle.fill sfcolor=#8E8E93 color=#8E8E93')
        continue

    for inst in instances:
        emoji = inst.get('emoji', '⚪')
        label = inst.get('label', name)
        state = inst.get('state', 'stopped')
        pids = inst.get('pids', [])
        label_text = inst.get('status_label', '未知')

        if state == 'stopped':
            line = f'{label}: {label_text}'
        else:
            line = f'{emoji} {label}: {label_text}'

        # Append uptime
        uptime = inst.get('uptime_sec', 0)
        if pids and uptime > 0:
            if uptime < 60:
                line += f' ({uptime}s)'
            elif uptime < 3600:
                line += f' ({uptime//60}m{uptime%60}s)'
            else:
                h = uptime // 3600
                m = (uptime % 3600) // 60
                line += f' ({h}h{m}m)'

        # Append last activity for waiting/ready
        last_act = inst.get('last_activity_ms_ago')
        if last_act and state in ('waiting', 'ready'):
            sec = int(last_act // 1000)
            if sec < 60:
                line += f' 最后活动 {sec}s 前'
            else:
                line += f' 最后活动 {sec//60}m 前'

        if state == 'stopped':
            line += ' | sfimage=circle.fill sfcolor=#8E8E93 color=#8E8E93'

        print(line)
" 2>/dev/null

echo "---"
echo "上次刷新: $(date '+%H:%M:%S') | color=gray size=10"
echo "立即刷新 | refresh=true"
echo "重启守护进程 | bash=$NODE_CMD param0=$DAEMON_PATH terminal=false"
