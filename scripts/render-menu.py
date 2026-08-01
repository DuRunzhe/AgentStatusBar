#!/usr/bin/env python3
import json
import os
import sys
import time

WAITING_CONFIGS = (
    'eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjRkZCMDAwIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJyZWd1bGFyIn0=',
    'eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjRkZENjBBIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJib2xkIn0=',
)
WORKING_CONFIGS = (
    'eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjMDA3QUZGIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJyZWd1bGFyIn0=',
    'eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjMDA3QUZGIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJib2xkIn0=',
)


def format_tokens(value):
    if value >= 1_000_000:
        return f'{value / 1_000_000:.1f}m'
    if value >= 1_000:
        return f'{value / 1_000:.0f}k'
    return str(value)


def visible(config, key):
    return config.get(key, True) is not False


def state_emoji(state):
    return {
        'waiting': '🟡',
        'waiting_reply': '🟡',
        'working': '🔵',
        'ready': '🟢',
        'stopped': '⚪',
    }.get(state, '⚪')


def main():
    status_path, ui_path, focus_path, node_cmd, restart_path, display_path, notification_path, startup_path = sys.argv[1:9]
    static_top_icon = len(sys.argv) > 9 and sys.argv[9] == 'static'
    with open(status_path, encoding='utf-8') as status_file:
        data = json.load(status_file)
    ui = dict(data.get('ui', {}))
    try:
        with open(ui_path, encoding='utf-8') as ui_file:
            ui.update(json.load(ui_file))
    except (OSError, json.JSONDecodeError):
        pass

    summary = data.get('summary', 'AgentStatusBar')
    label = summary[2:] if len(summary) > 2 and summary[1] == ' ' else summary
    if summary.startswith('🟡 '):
        frame = 1 if static_top_icon else (int(time.time()) // 2) % 2
        symbol = ('smallcircle.fill.circle', 'largecircle.fill.circle')[frame]
        print(f'{label} | sfimage={symbol} sfconfig={WAITING_CONFIGS[frame]}')
    elif summary.startswith('🔵 '):
        frame = 0 if static_top_icon else (int(time.time()) // 2) % 2
        symbol = ('smallcircle.fill.circle', 'largecircle.fill.circle')[frame]
        print(f'{label} | sfimage={symbol} sfconfig={WORKING_CONFIGS[frame]}')
    elif summary.startswith('⚪ '):
        print(f'{label} | sfimage=circle.fill sfcolor=#8E8E93 color=#8E8E93')
    else:
        print(summary)
    print('---')

    config = data.get('display_config', {})
    stopped_text = ui.get('statusStopped', 'Stopped')
    unknown_text = ui.get('statusUnknown', 'Unknown')
    for agent in data.get('agents', []):
        name = agent['name']
        instances = agent.get('instances', [])
        if not instances:
            print(f'⚪ {name}: {stopped_text} | color=#8E8E93')
            continue
        for inst in instances:
            state = inst.get('state', 'stopped')
            pids = inst.get('pids', [])
            line = f"{state_emoji(state)} {inst.get('label', name)}: {inst.get('status_label', unknown_text)}"
            uptime = inst.get('uptime_sec', 0)
            if visible(config, 'duration') and pids and uptime > 0:
                if uptime < 60:
                    line += f' ({uptime}s)'
                elif uptime < 3600:
                    line += f' ({uptime // 60}m{uptime % 60}s)'
                else:
                    line += f' ({uptime // 3600}h{(uptime % 3600) // 60}m)'
            if visible(config, 'model') and inst.get('model'):
                line += f" · {inst['model']}"
            context = inst.get('context_usage')
            if context:
                used = format_tokens(context['used_tokens'])
                total = format_tokens(context['window_tokens'])
                show_percent = visible(config, 'contextPercent')
                show_used = visible(config, 'contextUsed')
                show_total = visible(config, 'contextTotal')
                if show_percent:
                    line += f" · {context['percent']:.1f}%"
                if show_used and show_total:
                    line += f"{' ' if show_percent else ' · '}({used}/{total})"
                elif show_used:
                    line += f" · {ui.get('contextUsed', 'Used')} {used}"
                elif show_total:
                    line += f" · {ui.get('contextTotal', 'Total')} {total}"
            line += ' |'
            if state == 'stopped':
                line += ' color=#8E8E93'
            if state != 'stopped' and pids:
                line += f' bash={node_cmd} param0={focus_path} param1={pids[0]} terminal=false'
            print(line)

    print('---')
    print(f"{ui.get('settings', 'Settings')} | sfimage=gearshape")
    startup_enabled = os.path.isfile(os.path.expanduser('~/Library/LaunchAgents/com.agentstatusbar.monitor.plist'))
    startup_action = ui.get('disableStartup', 'Click to disable start at login') if startup_enabled else ui.get('enableStartup', 'Click to enable start at login')
    startup_icon = 'checkmark.circle.fill' if startup_enabled else 'circle'
    startup_color = '#34C759' if startup_enabled else '#8E8E93'
    print(f"--{ui.get('startup', 'Start at login')} | sfimage=power")
    print(f'----{startup_action} | bash={node_cmd} param0={startup_path} param1=toggle terminal=false refresh=true sfimage={startup_icon} sfcolor={startup_color}')
    print(f"----{ui.get('openLoginItems', 'Open Login Items Settings')} | bash={node_cmd} param0={startup_path} param1=open-settings terminal=false sfimage=gearshape")
    notifications = data.get('notifications_enabled') is True
    action = ui.get('disableNotifications', 'Click to disable notifications') if notifications else ui.get('enableNotifications', 'Click to enable notifications')
    icon = 'bell.fill' if notifications else 'bell.slash'
    color = '#34C759' if notifications else '#8E8E93'
    print(f"--{ui.get('notifications', 'Notifications')} | sfimage=bell")
    print(f'----{action} | bash={node_cmd} param0={notification_path} param1=toggle terminal=false refresh=true sfimage={icon} sfcolor={color}')
    print(f"----{ui.get('openNotificationSettings', 'Open System Notification Settings')} | bash={node_cmd} param0={notification_path} param1=open-settings terminal=false sfimage=gearshape")
    print(f"----{ui.get('notificationSettingsApp', 'App shown in Notifications: terminal-notifier')} | sfimage=app.badge disabled=true")
    print(f"--{ui.get('displayConfig', 'Display options')} | sfimage=slider.horizontal.3")
    for key, label_key, fallback in [('duration', 'showDuration', 'Duration'), ('model', 'showModel', 'Model'), ('contextPercent', 'showContextPercent', 'Context usage percentage'), ('contextUsed', 'showContextUsed', 'Context used'), ('contextTotal', 'showContextTotal', 'Total context')]:
        checked = ' checked=true' if visible(config, key) else ''
        print(f"----{ui.get(label_key, fallback)} | bash={node_cmd} param0={display_path} param1=toggle param2={key} terminal=false refresh=true{checked}")
    print('---')
    print(f"{ui.get('lastUpdated', 'Last updated')}: {time.strftime('%H:%M:%S')} | color=gray size=10")
    print(f"{ui.get('refreshNow', 'Refresh now')} | refresh=true")
    print(f"{ui.get('restartDaemon', 'Restart monitor daemon')} | bash=/bin/bash param0={restart_path} terminal=false refresh=true")


if __name__ == '__main__':
    main()
