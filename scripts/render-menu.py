#!/usr/bin/env python3
"""Render AgentStatusBar's SwiftBar menu in one JSON parse."""

import json
import os
import sys
import time
from datetime import datetime


WAITING_CONFIGS = (
    "eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjRkZCMDAwIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJyZWd1bGFyIn0=",
    "eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjRkZENjBBIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJib2xkIn0=",
)
WORKING_CONFIGS = (
    "eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjMDA3QUZGIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJyZWd1bGFyIn0=",
    "eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjMDA3QUZGIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJib2xkIn0=",
)


def safe_text(value):
    return str(value or "").replace("\r", " ").replace("\n", " ").replace("|", "¦")


def format_tokens(value):
    value = int(value)
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}m"
    if value >= 1_000:
        return f"{value / 1_000:.0f}k"
    return str(value)


def format_status_time(value, fallback):
    if value:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return parsed.astimezone().strftime("%H:%M")
        except ValueError:
            pass
    return time.strftime("%H:%M", time.localtime(fallback))


def visible(config, key):
    return config.get(key, True) is not False


def state_emoji(state):
    return {
        "waiting": "🟡",
        "waiting_reply": "🟡",
        "working": "🔵",
        "ready": "🟢",
        "stopped": "⚪",
    }.get(state, "⚪")


def render_menu(data, paths, now=None, static_icon=False):
    now = time.time() if now is None else now
    focus_path, node_cmd, restart_path, display_path, notification_path, startup_path = paths
    ui = data.get("ui", {})
    lines = []

    summary = safe_text(data.get("summary", "AgentStatusBar"))
    label = summary[2:] if len(summary) > 2 and summary[1] == " " else summary
    if summary.startswith("🟡 "):
        frame = 1 if static_icon else int(now) % 2
        symbol = ("smallcircle.fill.circle", "largecircle.fill.circle")[frame]
        lines.append(f"{label} | sfimage={symbol} sfconfig={WAITING_CONFIGS[frame]}")
    elif summary.startswith("🔵 "):
        frame = 0 if static_icon else (int(now) // 2) % 2
        symbol = ("smallcircle.fill.circle", "largecircle.fill.circle")[frame]
        lines.append(f"{label} | sfimage={symbol} sfconfig={WORKING_CONFIGS[frame]}")
    elif summary.startswith("⚪ "):
        lines.append(f"{label} | sfimage=circle.fill sfcolor=#8E8E93 color=#8E8E93")
    else:
        lines.append(summary)

    lines.append("---")
    config = data.get("display_config", {})
    stopped_text = safe_text(ui.get("statusStopped", "Stopped"))
    unknown_text = safe_text(ui.get("statusUnknown", "Unknown"))
    for agent in data.get("agents", []):
        name = safe_text(agent.get("name", "Agent"))
        instances = agent.get("instances", [])
        if not instances:
            lines.append(f"⚪ {name}: {stopped_text} | color=#8E8E93")
            continue
        for instance in instances:
            state = instance.get("state", "stopped")
            pids = instance.get("pids", [])
            line = (
                f"{state_emoji(state)} {safe_text(instance.get('label', name))}: "
                f"{safe_text(instance.get('status_label', unknown_text))}"
            )
            uptime = instance.get("uptime_sec", 0)
            if visible(config, "duration") and pids and uptime > 0:
                if uptime < 60:
                    line += " (<1m)"
                elif uptime < 3600:
                    line += f" ({uptime // 60}m)"
                else:
                    line += f" ({uptime // 3600}h{(uptime % 3600) // 60}m)"
            if visible(config, "model") and instance.get("model"):
                line += f" · {safe_text(instance['model'])}"
            context = instance.get("context_usage")
            if context:
                used = format_tokens(context["used_tokens"])
                total = format_tokens(context["window_tokens"])
                show_percent = visible(config, "contextPercent")
                show_used = visible(config, "contextUsed")
                show_total = visible(config, "contextTotal")
                if show_percent:
                    line += f" · {context['percent']:.1f}%"
                if show_used and show_total:
                    line += f"{' ' if show_percent else ' · '}({used}/{total})"
                elif show_used:
                    line += f" · {safe_text(ui.get('contextUsed', 'Used'))} {used}"
                elif show_total:
                    line += f" · {safe_text(ui.get('contextTotal', 'Total'))} {total}"
            line += " |"
            if state == "stopped":
                line += " color=#8E8E93"
            elif pids and node_cmd:
                line += f" bash={node_cmd} param0={focus_path} param1={pids[0]} terminal=false"
            lines.append(line)

    lines.append("---")
    lines.append(f"{safe_text(ui.get('settings', 'Settings'))} | sfimage=gearshape")
    startup_enabled = os.path.isfile(os.path.expanduser("~/Library/LaunchAgents/com.agentstatusbar.monitor.plist"))
    startup_action = ui.get("disableStartup", "Click to disable start at login") if startup_enabled else ui.get("enableStartup", "Click to enable start at login")
    startup_icon = "checkmark.circle.fill" if startup_enabled else "circle"
    startup_color = "#34C759" if startup_enabled else "#8E8E93"
    lines.append(f"--{safe_text(ui.get('startup', 'Start at login'))} | sfimage=power")
    if node_cmd:
        lines.append(f"----{safe_text(startup_action)} | bash={node_cmd} param0={startup_path} param1=toggle terminal=false refresh=true sfimage={startup_icon} sfcolor={startup_color}")
        lines.append(f"----{safe_text(ui.get('openLoginItems', 'Open Login Items Settings'))} | bash={node_cmd} param0={startup_path} param1=open-settings terminal=false sfimage=gearshape")
    notifications = data.get("notifications_enabled") is True
    action = ui.get("disableNotifications", "Click to disable notifications") if notifications else ui.get("enableNotifications", "Click to enable notifications")
    icon = "bell.fill" if notifications else "bell.slash"
    color = "#34C759" if notifications else "#8E8E93"
    lines.append(f"--{safe_text(ui.get('notifications', 'Notifications'))} | sfimage=bell")
    if node_cmd:
        lines.append(f"----{safe_text(action)} | bash={node_cmd} param0={notification_path} param1=toggle terminal=false refresh=true sfimage={icon} sfcolor={color}")
        lines.append(f"----{safe_text(ui.get('openNotificationSettings', 'Open System Notification Settings'))} | bash={node_cmd} param0={notification_path} param1=open-settings terminal=false sfimage=gearshape")
    lines.append(f"----{safe_text(ui.get('notificationSettingsApp', 'App shown in Notifications: terminal-notifier'))} | sfimage=app.badge disabled=true")
    lines.append(f"--{safe_text(ui.get('displayConfig', 'Display options'))} | sfimage=slider.horizontal.3")
    for key, label_key, fallback in (
        ("duration", "showDuration", "Duration"),
        ("model", "showModel", "Model"),
        ("contextPercent", "showContextPercent", "Context usage percentage"),
        ("contextUsed", "showContextUsed", "Context used"),
        ("contextTotal", "showContextTotal", "Total context"),
    ):
        checked = " checked=true" if visible(config, key) else ""
        if node_cmd:
            lines.append(f"----{safe_text(ui.get(label_key, fallback))} | bash={node_cmd} param0={display_path} param1=toggle param2={key} terminal=false refresh=true{checked}")

    lines.append("---")
    updated_at = format_status_time(data.get("timestamp"), now)
    lines.append(f"{safe_text(ui.get('lastUpdated', 'Last updated'))}: {updated_at} | color=gray size=10")
    lines.append(f"{safe_text(ui.get('refreshNow', 'Refresh now'))} | refresh=true")
    lines.append(f"{safe_text(ui.get('restartDaemon', 'Restart monitor daemon'))} | bash=/bin/bash param0={restart_path} terminal=false refresh=true")
    return "\n".join(lines)


def main(argv):
    if len(argv) < 7:
        raise SystemExit("usage: render-menu.py STATUS FOCUS NODE RESTART DISPLAY NOTIFICATIONS STARTUP [--static]")
    status_path = argv[0]
    with open(status_path, encoding="utf-8") as status_file:
        data = json.load(status_file)
    print(render_menu(data, argv[1:7], static_icon="--static" in argv[7:]))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (OSError, ValueError, KeyError, TypeError) as error:
        print("⚠️ AgentStatusBar")
        print("---")
        print(f"Unable to render status: {safe_text(error)} | color=red")
