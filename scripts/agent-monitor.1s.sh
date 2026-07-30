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

if [ ! -f "$STATUS_FILE" ]; then
  echo "⏳ Agent Monitor"
  echo "---"
  echo "监控守护进程未启动 | color=red"
  echo "启动守护进程 | bash=/usr/local/bin/node param0=$HOME/mycode/agent-monitor/scripts/agent-monitor.js terminal=false"
  exit 0
fi

DATA=$(cat "$STATUS_FILE")

# Summary line — shows in menu bar
SUMMARY=$(echo "$DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary'])" 2>/dev/null)
echo "$SUMMARY"

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
        print(f'⚪ {name}: 已停止')
        continue

    for inst in instances:
        emoji = inst.get('emoji', '⚪')
        label = inst.get('label', name)
        state = inst.get('state', 'stopped')
        pids = inst.get('pids', [])
        label_text = inst.get('label', '未知')

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

        # Append last activity for waiting
        last_act = inst.get('last_activity_ms_ago')
        if last_act and state == 'waiting':
            sec = int(last_act // 1000)
            if sec < 60:
                line += f' 最后活动 {sec}s 前'
            else:
                line += f' 最后活动 {sec//60}m 前'

        print(line)
" 2>/dev/null

echo "---"
echo "上次刷新: $(date '+%H:%M:%S') | color=gray size=10"
echo "立即刷新 | refresh=true"
echo "重启守护进程 | bash=/usr/local/bin/node param0=$HOME/mycode/agent-monitor/scripts/agent-monitor.js terminal=false"
