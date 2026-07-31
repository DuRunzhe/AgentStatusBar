# AgentStatusBar

macOS 菜单栏里的 AI Coding Agent 状态监控器。通过 SwiftBar 汇总 Claude Code、Codex CLI 和 OpenCode 的运行状态、进程时长与上下文占用，并可点击菜单项跳回对应终端会话。

## 显示效果
<img width="1104" height="674" alt="image" src="https://github.com/user-attachments/assets/6f73cd65-4385-4ca7-98de-aa146894ca30" />

```text
1个等待确认 · 1个等待回复 · 1个进行中 · 1个就绪
├── 🟡 Claude (backend): 等待确认 (2h36m) · claude-sonnet-4-5 · 63.0% (126k/200k)
├── 🟡 Claude (docs): 等待回复 (48m12s) · claude-sonnet-4-5 · 31.5% (63k/200k)
├── 🔵 Codex (AgentStatusBar): 进行中 (1h36m) · gpt-5.6-sol · 44.6% (115k/258k)
├── 🟢 Codex (src): 就绪 (70h25m) · gpt-5.6-sol · 33.8% (87k/258k)
└── [灰色圆点] OpenCode: 已停止
```

- 🔵 **进行中**：正在处理任务；顶部蓝色圆点每 2 秒切换中圆/大圆，以 4 秒一轮形成舒缓的心跳提示。
- 🟢 **就绪**：进程存活，当前没有未完成任务。
- 🟡 **等待确认**：Agent 正在等待工具执行授权或其他确认。
- 🟡 **等待回复**：Agent 已提出需要人工回答的问题，包括 Codex `request_user_input`、Claude `AskUserQuestion` 和 Claude 回合末尾的直接问句。
- 灰色圆点 **已停止**：进程不存在。

“等待确认”和“等待回复”都属于需要人工介入的紧急状态。菜单栏顶部使用黄色圆点，每秒切换一次视觉强度，以 2 秒一轮呼吸，并触发同一套分级系统通知。菜单栏汇总始终按“等待确认 → 等待回复 → 进行中 → 就绪”排序，已停止实例不计入汇总。
<img width="1464" height="62" alt="image" src="https://github.com/user-attachments/assets/9443f6d9-453e-4bde-b461-59e41f1567f0" />

点击菜单栏图标展开详情。点击存活的 Agent 行可跳转到对应终端会话；已停止项不可点击。

## 功能

| 功能 | 说明 |
|---|---|
| 多 Agent / 多实例 | 同时监控 Claude Code、Codex CLI、OpenCode，并按项目区分多个会话 |
| 五态显示 | 等待确认、等待回复、进行中、就绪、已停止 |
| 多语言 | 按 macOS 首选语言显示英语、简体中文或繁体中文；语言优先于地区，默认英语 |
| 上下文占用 | Claude Code 和 Codex 显示百分比及 `已用/窗口` token 数 |
| 会话模型 | 在 Agent 实例行显示当前会话最新使用的模型名称 |
| 显示配置 | 在菜单中独立开关时长、模型、上下文占比、已用上下文和总上下文 |
| 工具调用配对 | 按 tool ID 配对 `tool_use` 与 `tool_result`，避免并行调用和扫描窗口截断误判 |
| 进程时长 | 显示 Agent 进程持续运行时间 |
| 会话跳转 | Terminal.app / iTerm2 精确切换标签页，其他受支持终端降级为激活应用 |
| 人工介入提醒 | 可在“设置 → 通知”启用；等待确认或等待回复时立即通知，持续 60 秒再次提醒，持续 3 分钟发送最后提醒，点击通知可跳转对应会话 |
| 自动恢复 | launchd 通过 `KeepAlive` 管理守护进程 |

提醒仅在实例持续处于同一种人工介入状态时发送：进入等待确认或等待回复时立即通知，60 秒后再次提醒，3 分钟后发送最后提醒，每次带系统提示音。实例恢复为进行中、就绪或已停止后，尚未发送的后续提醒会取消；在等待确认与等待回复之间切换，或离开后再次进入任一等待状态时，会立即开始新一轮提醒。

通知默认关闭。由关闭转为开启时会完整检查 `terminal-notifier`：未安装则先询问是否通过 Homebrew 安装；安装完成后发送测试通知并打开 macOS 通知设置。用户确认已看到测试通知后，开关才会写入启用状态。由开启转为关闭时只停止 AgentStatusBar 后续通知，不会关闭或修改 macOS 系统通知设置。之后再次开启仍会重新执行依赖检查和通知权限验证流程。通知启用后，点击提醒会按 PID 调用与菜单项相同的会话跳转逻辑；发送失败时自动回退到 macOS 内置 `osascript`，但降级通知点击不会跳转。

界面和通知语言读取 macOS 的“语言与地区”设置。系统会依次匹配首选语言，未匹配时按地区选择中文变体，仍无法匹配时使用英语。语言缓存每 60 秒刷新，更改系统语言后无需重启，最多约 60 秒自动生效。

## 环境要求

- macOS
- [SwiftBar](https://github.com/swiftbar/SwiftBar)
- Node.js
- Python 3（用于 SwiftBar 输出格式化）
- Homebrew（首次开启通知时可用于安装依赖）
- [terminal-notifier](https://github.com/julienXX/terminal-notifier)（通知开关可自动检查并询问安装）

```bash
brew install swiftbar node python
# 可选：也可稍后通过“设置 → 通知”交互安装
brew install terminal-notifier
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

SwiftBar 每秒刷新一次菜单，守护进程每 2 秒更新一次 `/tmp/agent-status.json`。SwiftBar 同时每 2 秒异步生成精简进程快照，并每 30 秒异步刷新 PID 对应的 cwd/session 元数据；较重的 `lsof` 不在守护进程轮询路径中执行。

## 使用

| 操作 | 方式 |
|---|---|
| 查看汇总 | 查看 macOS 顶部菜单栏 |
| 查看实例详情 | 点击菜单栏图标 |
| 跳转 Agent 会话 | 点击存活的 Agent 菜单项 |
| 开启或关闭通知 | 点击“设置 → 通知 → 点击开启通知/点击关闭通知”；首次开启会检查依赖、引导系统权限并发送测试通知 |
| 打开通知设置 | 点击“设置 → 通知 → 打开系统通知设置”；菜单会提示应在通知应用列表中查找 `terminal-notifier` |
| 从通知跳转会话 | 通知开关启用后，点击等待确认/等待回复通知 |
| 立即刷新 | 点击菜单底部的“立即刷新” |
| 重启守护进程 | 点击菜单底部的“重启守护进程”；会清理重复实例并通过 launchd 重启 |
| 调整显示内容 | 悬浮“设置 → 显示配置”，点击子菜单选项即可切换 |

显示配置和通知开关保存在 `~/.config/agent-statusbar/config.json`，系统勾选标记表示该项已启用。首次运行时五项显示内容默认开启，通知默认关闭。受 macOS 原生菜单行为限制，执行操作后菜单会关闭；重新打开即可查看最新开关状态或继续调整。

macOS 没有向普通脚本提供稳定的通知权限查询接口，因此开启流程使用测试通知确认：只有用户选择“已看到”才启用开关；选择“还没有”、取消依赖安装或退出设置流程都会保持关闭。

监控守护进程使用 `/tmp/agent-statusbar-monitor.pid` 保证同一时间只有一个实例写入状态文件。

会话跳转支持：

- Terminal.app、iTerm2：按 PID 对应的 TTY 精确切换到窗口/标签页。
- Warp、Visual Studio Code、Cursor、Windsurf、kitty、Alacritty：无法精确定位标签页时激活对应应用。
- 首次跳转时，macOS 可能询问 SwiftBar/Node.js 的“自动化”权限，需要允许控制终端应用。
- `terminal-notifier` 的通知权限和横幅样式需要在 macOS“系统设置 → 通知”中单独配置；通知开关会自动打开该页面，原有 `osascript` 通知设置不会自动继承。

## 数据来源

- **Claude Code**：`~/.claude/sessions/<PID>.json` 提供 PID/session/cwd 配对及原生 `busy` / `idle` / `waiting` 状态；Claude statusline 和 transcript 提供模型、会话路径、上下文窗口及使用率。
- **Codex CLI**：读取 `~/.codex/sessions/**/rollout-*.jsonl`，只选择主会话 rollout，并使用最新模型和最近一次有效 `last_token_usage`。
- **OpenCode**：检测 `opencode` 进程，并优先从 `~/.local/share/opencode/opencode.db` 的当前目录最新会话读取状态和 provider/model；旧版 `storage/*` 保留为模型读取回退。
- **进程发现**：SwiftBar 后台采集器只写入 agent 主进程及直属子进程；PID 到 cwd/session 的 `lsof` 元数据低频异步刷新，不阻塞状态轮询。

## 状态判定

判定顺序如下：

1. 进程不存在：**已停止**。
2. 存在尚无同 ID 结果的 Codex `request_user_input` 或 Claude `AskUserQuestion`：**等待回复**。
3. Claude 原生状态为 `waiting`：**等待确认**；原生状态为 `busy` / `working` / `running`：**进行中**。
4. Claude 最新 `end_turn` 回复以直接问句结束，且之后没有新的人工消息：**等待回复**。
5. 存在实际任务子进程：**进行中**（忽略 Codex 常驻的 `codex-code-mode-host`）。
6. 存在尚无同 ID 结果且显式声明 `sandbox_permissions: "require_escalated"` 的 Codex 工具调用：**等待确认**；其他未完成工具调用：**进行中**。
7. transcript 中有更晚的任务活动：**进行中**。Claude 的 `turn_duration` / `end_turn` 和 Codex 的 `task_complete` 将任务置为**就绪**；Codex 的 `task_started` 将任务置为**进行中**。
8. Claude 原生状态为 `idle` / `ready`：**就绪**。
9. 会话事件无法判断时，使用文件更新时间兜底：最近 30 秒有写入视为**进行中**，否则为**就绪**。

工具调用不是简单反向计数，而是按 tool ID 独立配对；窗口内只有结果、对应调用位于窗口外时，不会产生 pending。transcript 采用增量读取和事件状态累积，只解析新增内容，避免会话变长后拖慢 Codex/Claude 状态更新。

## 架构

```text
ps ──> 精简 Agent/直属子进程快照（2 秒）────────────────────────────┐
lsof ──> PID cwd/session 元数据（30 秒，异步）──────────────────────┤
Claude sessions/statusline/transcript ──────────────────────────────┤
Codex rollout / OpenCode storage ────────────────────────────────────┤
                                                                     v
                                                         agent-monitor.js
                                                         每 2 秒增量聚合
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
- 通知开关无法启用：重新点击“设置 → 通知”，确认允许安装依赖，并在系统通知设置中为 `terminal-notifier` 开启通知和横幅；看到测试通知后选择“已看到”。
- 点击通知没有跳转：检查终端自动化权限，并确认通知对应的 Agent PID 仍然存活；发送失败时的 `osascript` 降级通知不支持点击跳转。

## 开发

项目没有 npm 依赖或构建步骤。修改脚本后直接运行测试：

```bash
git clone https://github.com/DuRunzhe/AgentStatusBar.git
cd AgentStatusBar
node --test scripts/*.test.js
```

## License

[Apache License 2.0](LICENSE)
