# AgentStatusBar

macOS 菜单栏里的 AI Coding Agent 状态监控器。通过 SwiftBar 汇总 Claude Code、Codex CLI 和 OpenCode 的运行状态、进程时长与上下文占用，并可点击菜单项跳回对应终端会话。

## 显示效果

```text
1个进行 · 2个就绪
├── 🟢 Claude: 就绪 (2h36m) · 63.0% (126k/200k)
├── 🟢 Codex (src): 就绪 (70h25m) · 33.8% (87k/258k)
├── 🔵 Codex (AgentStatusBar): 进行中 (1h36m) · 44.6% (115k/258k)
└── [灰色圆点] OpenCode: 已停止
```

- 🔵 **进行中**：正在处理任务；顶部蓝色圆点以中圆/大圆每秒交替，形成心跳提示。
- 🟢 **就绪**：进程存活，当前没有未完成任务。
- 🟡 **等待确认**：存在尚未返回结果的工具调用，可能需要用户确认。
- 灰色圆点 **已停止**：进程不存在。

点击菜单栏图标展开详情。点击存活的 Agent 行可跳转到对应终端会话；已停止项不可点击。

## 功能

| 功能 | 说明 |
|---|---|
| 多 Agent / 多实例 | 同时监控 Claude Code、Codex CLI、OpenCode，并按项目区分多个会话 |
| 四态显示 | 进行中、就绪、等待确认、已停止 |
| 上下文占用 | Claude Code 和 Codex 显示百分比及 `已用/窗口` token 数 |
| 工具调用配对 | 按 tool ID 配对 `tool_use` 与 `tool_result`，避免并行调用和扫描窗口截断误判 |
| 进程时长 | 显示 Agent 进程持续运行时间 |
| 会话跳转 | Terminal.app / iTerm2 精确切换标签页，其他受支持终端降级为激活应用 |
| 等待通知 | 实例进入等待确认状态时发送 macOS 通知 |
| 自动恢复 | launchd 通过 `KeepAlive` 管理守护进程 |

## 环境要求

- macOS
- [SwiftBar](https://github.com/swiftbar/SwiftBar)
- Node.js
- Python 3（用于 SwiftBar 输出格式化）

```bash
brew install swiftbar node python
```

## 安装

### 1. 克隆仓库

```bash
git clone https://github.com/DuRunzhe/AgentStatusBar.git
cd AgentStatusBar
```

以下命令假设当前目录就是仓库根目录。

### 2. 安装 SwiftBar 插件

```bash
REPO_DIR="$(pwd)"
SWIFTBAR_DIR="$HOME/Library/Application Support/SwiftBar/Plugins"
mkdir -p "$SWIFTBAR_DIR"
ln -sf "$REPO_DIR/scripts/agent-monitor.1s.sh" \
  "$SWIFTBAR_DIR/agent-monitor.1s.sh"
```

打开 SwiftBar，并将插件目录设置为：

```text
~/Library/Application Support/SwiftBar/Plugins
```

### 3. 启用 Claude 上下文采集

```bash
node scripts/install-claude-statusline.js
```

安装器会更新 `~/.claude/settings.json`，并保留、转发已有的 Claude statusline 命令和输出。Claude Code 原生提供的上下文数据会写入：

```text
/tmp/agent-statusbar-claude-context/
```

### 4. 安装 launchd 守护进程

```bash
REPO_DIR="$(pwd)"
NODE_BIN="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/openclaw.agent-monitor.plist"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>openclaw.agent-monitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$REPO_DIR/scripts/agent-monitor.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>/tmp/agent-monitor.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/agent-monitor.stderr.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/openclaw.agent-monitor" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/openclaw.agent-monitor"
launchctl kickstart -k "gui/$(id -u)/openclaw.agent-monitor"
```

SwiftBar 每秒刷新一次菜单，守护进程每 2 秒更新一次 `/tmp/agent-status.json`。

## 使用

| 操作 | 方式 |
|---|---|
| 查看汇总 | 查看 macOS 顶部菜单栏 |
| 查看实例详情 | 点击菜单栏图标 |
| 跳转 Agent 会话 | 点击存活的 Agent 菜单项 |
| 立即刷新 | 点击菜单底部的“立即刷新” |
| 重启守护进程 | 点击菜单底部的“重启守护进程” |

会话跳转支持：

- Terminal.app、iTerm2：按 PID 对应的 TTY 精确切换到窗口/标签页。
- Warp、Visual Studio Code、Cursor、Windsurf、kitty、Alacritty：无法精确定位标签页时激活对应应用。
- 首次跳转时，macOS 可能询问 SwiftBar/Node.js 的“自动化”权限，需要允许控制终端应用。

## 数据来源

- **Claude Code**：`~/.claude/sessions/<PID>.json` 提供 PID/session/cwd 配对；Claude statusline 提供会话路径、上下文窗口和使用率。
- **Codex CLI**：读取 `~/.codex/sessions/**/rollout-*.jsonl`，只选择主会话 rollout，并使用最近一次有效 `last_token_usage`。
- **OpenCode**：检测 `opencode` 进程及 `~/.local/share/opencode/**/storage/*`。

## 状态判定

判定顺序如下：

1. 进程不存在：**已停止**。
2. 存在实际任务子进程：**进行中**（忽略 Codex 常驻的 `codex-code-mode-host`）。
3. 最近扫描窗口中存在没有同 ID 结果的工具调用：**等待确认**。
4. Codex 最近生命周期事件为 `task_started` / `task_complete`：**进行中** / **就绪**。
5. 会话事件无法判断时，使用文件更新时间兜底。

工具调用不是简单反向计数，而是按 tool ID 独立配对；窗口内只有结果、对应调用位于窗口外时，不会产生 pending。

## 架构

```text
Claude statusline ──> /tmp/agent-statusbar-claude-context/*.json ──┐
Codex rollout ──────────────────────────────────────────────────────┤
OpenCode storage / process info ────────────────────────────────────┤
                                                                    v
                                                        agent-monitor.js
                                                        每 2 秒聚合状态
                                                                    |
                                                                    v
                                                        /tmp/agent-status.json
                                                                    |
                                                                    v
                                                        agent-monitor.1s.sh
                                                        SwiftBar 每秒渲染

点击 Agent 行 ──> focus-agent-session.js ──> TTY ──> 终端窗口/应用
```

## 配置

轮询与兜底阈值位于 `scripts/agent-monitor.js`：

```js
const POLL_MS = 2000;
const WAIT_THRESHOLD_MS = 30000;
```

增加新的 Agent 不仅需要扩展 `AGENTS` 配置，还需要为其实现会话文件配对和状态解析逻辑。

## 验证与排障

```bash
# 查看 SwiftBar 实际输出
bash scripts/agent-monitor.1s.sh

# 查看守护进程状态
launchctl print "gui/$(id -u)/openclaw.agent-monitor"

# 查看错误日志
tail -n 50 /tmp/agent-monitor.stderr.log

# 重新加载 Claude statusline 集成
node scripts/install-claude-statusline.js

# 运行测试与语法检查
node --test scripts/*.test.js
node --check scripts/agent-monitor.js
bash -n scripts/agent-monitor.1s.sh
```

常见问题：

- 菜单栏没有出现：确认 SwiftBar 插件目录及 `agent-monitor.1s.sh` 软链接正确。
- 显示“监控守护进程未启动”：执行安装步骤中的 `launchctl bootstrap` / `kickstart` 命令。
- Claude 没有上下文数据：重新运行安装器，并在 Claude 会话产生一次 statusline 更新。
- 点击 Agent 没有跳转：检查 macOS“系统设置 → 隐私与安全性 → 自动化”中的终端控制权限。

## 开发

项目没有 npm 依赖或构建步骤。修改脚本后直接运行测试：

```bash
git clone https://github.com/DuRunzhe/AgentStatusBar.git
cd AgentStatusBar
node --test scripts/*.test.js
```

## License

[Apache License 2.0](LICENSE)
