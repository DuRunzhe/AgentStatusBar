#!/usr/bin/env python3
"""Render AgentStatusBar's SwiftBar menu in one JSON parse."""

import json
import os
import re
import sys
import time
from datetime import datetime


WAITING_CONFIGS = (
    "eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjRkZCMDAwIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJib2xkIn0=",
    "eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjRkZENjBBIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJib2xkIn0=",
)
WORKING_CONFIGS = (
    "eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjMDA3QUZGIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJyZWd1bGFyIn0=",
    "eyJyZW5kZXJpbmdNb2RlIjoiUGFsZXR0ZSIsImNvbG9ycyI6WyIjNjREMkZGIl0sInNjYWxlIjoibGFyZ2UiLCJ3ZWlnaHQiOiJyZWd1bGFyIn0=",
)
ANIMATED_SYMBOL = "smallcircle.fill.circle"
DISPLAY_CONFIG_KEYS = {
    "stoppedAgents",
    "duration",
    "model",
    "contextPercent",
    "contextUsed",
    "contextTotal",
    "browserTabReuse",
    "notifications",
    "notifyWaitingConfirmation",
    "notifyWaitingReply",
    "showWaitingNotificationsInAutoConfirmMode",
}


def safe_text(value):
    return str(value or "").replace("\r", " ").replace("\n", " ").replace("|", "¦")


def safe_thread_id(value):
    text = str(value or "").strip()
    if re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", text):
        return text.lower()
    return ""


def safe_url(value):
    text = str(value or "").strip()
    if text.startswith("http://127.0.0.1:") or text.startswith("http://localhost:"):
        return text.replace(" ", "%20").replace("|", "%7C")
    return ""


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


def read_live_display_config(fallback):
    """Read settings directly so menu clicks do not wait for the daemon poll."""
    config_path = os.environ.get(
        "AGENT_STATUSBAR_CONFIG_FILE",
        os.path.expanduser("~/.config/agent-statusbar/config.json"),
    )
    try:
        with open(config_path, encoding="utf-8") as config_file:
            value = json.load(config_file)
        if not isinstance(value, dict):
            return fallback
        config = dict(fallback)
        for key in DISPLAY_CONFIG_KEYS:
            if isinstance(value.get(key), bool):
                config[key] = value[key]
        return config
    except (OSError, ValueError, TypeError):
        return fallback


def state_emoji(state):
    return {
        "waiting": "🟡",
        "waiting_reply": "🟡",
        "working": "🔵",
        "ready": "🟢",
        "stopped": "⚪",
    }.get(state, "⚪")


def animation_mode(data):
    summary = str(data.get("summary", ""))
    if summary.startswith("🟡 "):
        return "waiting"
    if summary.startswith("🔵 "):
        return "working"
    return "static"


def render_menu(data, paths, now=None, static_icon=False, icon_frame=None):
    now = time.time() if now is None else now
    focus_path, focus_web_path, focus_codex_path, node_cmd, restart_path, display_path, notification_path, browser_tab_path, startup_path = paths
    ui = data.get("ui", {})
    lines = []

    summary = safe_text(data.get("summary", "AgentStatusBar"))
    label = summary[2:] if len(summary) > 2 and summary[1] == " " else summary
    if summary.startswith("🟡 "):
        frame = icon_frame if icon_frame is not None else (1 if static_icon else int(now) % 2)
        lines.append(f"{label} | sfimage={ANIMATED_SYMBOL} sfconfig={WAITING_CONFIGS[frame]}")
    elif summary.startswith("🔵 "):
        frame = icon_frame if icon_frame is not None else (0 if static_icon else (int(now) // 2) % 2)
        lines.append(f"{label} | sfimage={ANIMATED_SYMBOL} sfconfig={WORKING_CONFIGS[frame]}")
    elif summary.startswith("⚪ "):
        lines.append(f"{label} | sfimage=circle.fill sfcolor=#8E8E93 color=#8E8E93")
    else:
        lines.append(summary)

    lines.append("---")
    fallback_config = dict(data.get("display_config", {}))
    if "notifications" not in fallback_config:
        fallback_config["notifications"] = data.get("notifications_enabled") is True
    config = read_live_display_config(fallback_config)
    stopped_text = safe_text(ui.get("statusStopped", "Stopped"))
    unknown_text = safe_text(ui.get("statusUnknown", "Unknown"))
    for agent in data.get("agents", []):
        name = safe_text(agent.get("name", "Agent"))
        instances = agent.get("instances", [])
        if not instances:
            if visible(config, "stoppedAgents"):
                lines.append(f"⚪ {name}: {stopped_text} | color=#8E8E93")
            continue
        for instance in instances:
            state = instance.get("state", "stopped")
            if state == "stopped" and not visible(config, "stoppedAgents"):
                continue
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
                codex_thread_id = safe_thread_id(instance.get("codex_thread_id"))
                url = safe_url(instance.get("open_url"))
                if codex_thread_id and focus_codex_path:
                    line += f" bash={node_cmd} param0={focus_codex_path} param1={safe_text(codex_thread_id)} terminal=false"
                elif url:
                    reuse_arg = " param2=reuse-tabs" if config.get("browserTabReuse") is True else ""
                    line += f" bash={node_cmd} param0={focus_web_path} param1={url}{reuse_arg} terminal=false"
                else:
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
    notifications = config.get("notifications") is True
    action = ui.get("disableNotifications", "Click to disable notifications") if notifications else ui.get("enableNotifications", "Click to enable notifications")
    icon = "bell.fill" if notifications else "bell.slash"
    color = "#34C759" if notifications else "#8E8E93"
    lines.append(f"--{safe_text(ui.get('notifications', 'Notifications'))} | sfimage=bell")
    if node_cmd:
        lines.append(f"----{safe_text(action)} | bash={node_cmd} param0={notification_path} param1=toggle terminal=false refresh=true sfimage={icon} sfcolor={color}")
    notification_options_label = safe_text(ui.get('notificationOptions', 'Notification options'))
    if notifications:
        lines.append(f"----{notification_options_label} | sfimage=checklist")
        notification_preferences = (
            ('notifyWaitingConfirmation', 'notifyWaitingConfirmation', 'Awaiting confirmation'),
            ('notifyWaitingReply', 'notifyWaitingReply', 'Waiting for reply'),
            ('showWaitingNotificationsInAutoConfirmMode', 'notifyAutoConfirmWaiting', 'Notify in auto-confirmation mode'),
        )
        if node_cmd:
            for key, label_key, fallback in notification_preferences:
                checked = " checked=true" if config.get(key) is not False else ""
                target = "false" if config.get(key) is not False else "true"
                lines.append(f"------{safe_text(ui.get(label_key, fallback))} | bash={node_cmd} param0={notification_path} param1=toggle-preference param2={key} param3={target} terminal=false refresh=true{checked}")
    else:
        lines.append(f"----{notification_options_label} | sfimage=checklist disabled=true")
    if node_cmd:
        lines.append(f"----{safe_text(ui.get('openNotificationSettings', 'Open System Notification Settings'))} | bash={node_cmd} param0={notification_path} param1=open-settings terminal=false refresh=true sfimage=gearshape")
    lines.append(f"----{safe_text(ui.get('notificationSettingsApp', 'App shown in Notifications: terminal-notifier'))} | sfimage=app.badge disabled=true")
    browser_tab_reuse = config.get("browserTabReuse") is True
    browser_action = ui.get("disableBrowserTabReuse", "Click to disable browser tab reuse") if browser_tab_reuse else ui.get("enableBrowserTabReuse", "Click to enable browser tab reuse")
    browser_icon = "checkmark.circle.fill" if browser_tab_reuse else "circle"
    browser_color = "#34C759" if browser_tab_reuse else "#8E8E93"
    lines.append(f"--{safe_text(ui.get('browserTabs', 'Browser tabs'))} | sfimage=rectangle.on.rectangle")
    if node_cmd:
        lines.append(f"----{safe_text(browser_action)} | bash={node_cmd} param0={browser_tab_path} param1=toggle terminal=false refresh=true sfimage={browser_icon} sfcolor={browser_color}")
        lines.append(f"----{safe_text(ui.get('openAutomationSettings', 'Open Automation Settings'))} | bash={node_cmd} param0={browser_tab_path} param1=open-settings terminal=false sfimage=gearshape")
    lines.append(f"----{safe_text(ui.get('browserTabReusePermission', 'Requires browser Automation permission'))} | sfimage=lock.shield disabled=true")
    lines.append(f"--{safe_text(ui.get('displayConfig', 'Display options'))} | sfimage=slider.horizontal.3")
    for key, label_key, fallback in (
        ("duration", "showDuration", "Duration"),
        ("model", "showModel", "Model"),
        ("contextPercent", "showContextPercent", "Context usage percentage"),
        ("contextUsed", "showContextUsed", "Context used"),
        ("contextTotal", "showContextTotal", "Total context"),
        ("stoppedAgents", "showStoppedAgents", "Stopped agents"),
    ):
        checked = " checked=true" if visible(config, key) else ""
        if node_cmd:
            target = "false" if visible(config, key) else "true"
            lines.append(f"----{safe_text(ui.get(label_key, fallback))} | bash={node_cmd} param0={display_path} param1=toggle param2={key} param3={target} terminal=false refresh=true{checked}")

    lines.append("---")
    updated_at = format_status_time(data.get("timestamp"), now)
    lines.append(f"{safe_text(ui.get('lastUpdated', 'Last updated'))}: {updated_at} | color=gray size=10")
    lines.append(f"{safe_text(ui.get('refreshNow', 'Refresh now'))} | refresh=true")
    lines.append(f"{safe_text(ui.get('restartDaemon', 'Restart monitor daemon'))} | bash=/bin/bash param0={restart_path} terminal=false refresh=true")
    return "\n".join(lines)


def atomic_write(path, content):
    temporary = f"{path}.{os.getpid()}.tmp"
    with open(temporary, "w", encoding="utf-8") as output_file:
        output_file.write(content)
        output_file.write("\n")
    os.replace(temporary, path)


def write_menu_cache(data, paths, prefix, cache_key):
    now = time.time()
    atomic_write(f"{prefix}.0", render_menu(data, paths, now=now, icon_frame=0))
    atomic_write(f"{prefix}.1", render_menu(data, paths, now=now, icon_frame=1))
    atomic_write(f"{prefix}.mode", animation_mode(data))
    # Publish the key last so readers only accept a fully written cache set.
    atomic_write(f"{prefix}.key", cache_key)


def main(argv):
    if len(argv) < 10:
        raise SystemExit(
            "usage: render-menu.py STATUS FOCUS FOCUS_WEB FOCUS_CODEX NODE RESTART DISPLAY NOTIFICATIONS BROWSER_TABS "
            "STARTUP [--static | --cache-prefix PREFIX --cache-key KEY]"
        )
    status_path = argv[0]
    with open(status_path, encoding="utf-8") as status_file:
        data = json.load(status_file)
    options = argv[10:]
    if "--cache-prefix" in options:
        prefix_index = options.index("--cache-prefix")
        key_index = options.index("--cache-key")
        write_menu_cache(
            data,
            argv[1:10],
            options[prefix_index + 1],
            options[key_index + 1],
        )
        return
    print(render_menu(data, argv[1:10], static_icon="--static" in options))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (OSError, ValueError, KeyError, TypeError) as error:
        print("⚠️ AgentStatusBar")
        print("---")
        print(f"Unable to render status: {safe_text(error)} | color=red")
