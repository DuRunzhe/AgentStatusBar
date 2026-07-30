# Agent Monitor 🖥️🔍

> macOS 菜单栏 AI Coding Agent 运行状态指示器

在菜单栏一眼看清 **Claude Code / Codex CLI / OpenCode** 当前状态——在跑、在等、还是已经停了。不用切终端就知道 agent 在干嘛。

---

## 效果预览

菜单栏显示效果：

```
🔵 1个进行 · 1个等待
├── 🔵 Codex: 进行中 (PID 34228, 2h36m)
├── 🟡 Claude: 等待确认
└── [灰色圆点] OpenCode: 已停止
```

- 🔵 **进行中** — 正在处理任务，菜单栏蓝色图标以中圆/大圆模拟心跳
- 🟢 **就绪** — 进程存活，当前没有未完成任务
- 🟡 **等待确认** — 存在尚未返回结果的工具调用，需要用户介入
- 灰色圆点 **已停止** — 进程已退出

点击菜单栏图标展开下拉菜单，可查看详细状态、手动刷新、或重启守护进程。

---

## 安装

### 前置依赖

- [SwiftBar](https://github.com/swiftbar/SwiftBar) — macOS 菜单栏工具
  ```bash
  brew install swiftbar
  ```
- Node.js（已安装即可，无需额外配置）

### 1. 下载项目

```bash
git clone https://github.com/yourusername/agent-monitor.git ~/mycode/agent-monitor
cd ~/mycode/agent-monitor
```

### 2. 安装插件

将 SwiftBar 插件 symlink 到 SwiftBar 插件目录：

```bash
mkdir -p ~/Library/Application\ Support/swiftbar/plugins
ln -sf ~/mycode/agent-monitor/scripts/agent-monitor.1s.sh \
  ~/Library/Application\ Support/swiftbar/plugins/agent-monitor.1s.sh
```

### 3. 启动守护进程

方式一：手动启动（测试用）

```bash
node ~/mycode/agent-monitor/scripts/agent-monitor.js
```

方式二：通过 launchd 自动启动（推荐）

```bash
# 创建 plist
cat > ~/Library/LaunchAgents/openclaw.agent-monitor.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>openclaw.agent-monitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>${HOME}/mycode/agent-monitor/scripts/agent-monitor.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/agent-monitor.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/agent-monitor.stderr.log</string>
</dict>
</plist>
EOF

# 加载服务
launchctl load ~/Library/LaunchAgents/openclaw.agent-monitor.plist
```

### 4. 启动 SwiftBar

打开 SwiftBar，首次运行会提示选择插件目录，选择：

```
~/Library/Application Support/swiftbar/plugins/
```

菜单栏就会出现 Agent Monitor 的状态图标 🟢。

---

## 使用方式

**安装即用，无需任何手动操作。**

| 操作 | 方式 |
|---|---|
| 查看状态 | 看菜单栏图标即可 |
| 查看详情 | 点击图标展开下拉菜单 |
| 手动刷新 | 点击「立即刷新」 |
| 重启守护进程 | 点击「重启守护进程」 |

监控的 Agent 包括：

- **Claude Code** — 检测 `claude` 进程 + `~/.claude/transcripts/*.jsonl` 文件活动
- **Codex CLI** — 检测 `codex` 进程 + `~/.codex/history.jsonl` 文件活动
- **OpenCode** — 检测 `opencode` 进程 + `~/.local/share/opencode/**/storage/*` 文件活动

---

## 支持功能

### ✅ 当前功能

| 功能 | 说明 |
|---|---|
| **进程存活检测** | 通过 `pgrep` 实时检测 Claude Code / Codex CLI / OpenCode 进程 |
| **活动状态判断** | 结合进程存活 + session 文件更新时间，区分运行/等待/停止 |
| **运行时长统计** | 显示每个 agent 的进程已运行时间 |
| **上下文使用率** | Codex 会话显示最近一次模型响应的上下文 token 占用 |
| **四态显示** | 🔵 进行中 / 🟢 就绪 / 🟡 等待确认 / 灰色已停止 |
| **菜单栏汇总** | 菜单栏显示汇总状态（如 `🟢 2个运行 · 1个等待`） |
| **下拉菜单详情** | 点击图标展示每个 agent 的详细状态 |
| **手动刷新** | 下拉菜单中一键刷新 |
| **守护进程自动恢复** | launchd KeepAlive 确保进程崩溃后自动重启 |
| **2s 轮询刷新** | 守护进程每 2 秒检测一次，菜单栏每 1 秒读取最新状态 |

### 🚧 未来规划

- [ ] Agent 退出时系统通知提醒
- [ ] 更多 Agent 支持（Cursor, Windsurf 等）
- [ ] 自定义阈值（等待 / 卡死判定时间）
- [ ] 多语言状态标签
- [ ] 历史状态图表

---

## 架构

```
┌─────────────────────────┐
│  agent-monitor.js       │  ← Node.js 守护进程（launchd 管理）
│  (pgrep + fs.stat)      │
│  每 2s 轮询一次         │
└──────────┬──────────────┘
           │ 写入 /tmp/agent-status.json
           ▼
┌─────────────────────────┐
│  agent-monitor.1s.sh    │  ← SwiftBar 插件
│  (Shell + Python 解析)  │     每 1s 读取一次
│  输出到 macOS 菜单栏    │
└─────────────────────────┘
```

**数据流：** 守护进程 Node.js → 写 JSON → SwiftBar Shell 脚本 → 渲染到菜单栏

**状态判定策略：**
1. 进程不存在 → 灰色圆点 **已停止**
2. 存在实际任务子进程（排除常驻辅助进程）→ 🔵 **进行中**
3. session/rollout 存在未完成的 tool call → 🟡 **等待确认**
4. Codex rollout 最近事件为 `task_started` / `task_complete` → 🔵 **进行中** / 🟢 **就绪**
5. 无法读取事件时，使用 session 文件更新时间兜底

---

## 配置文件

编辑 `scripts/agent-monitor.js` 顶部即可调整：

```js
const POLL_MS = 2000;              // 轮询间隔（毫秒）
const WAIT_THRESHOLD_MS = 30000;   // 30s 无活动 → 🟡 等待确认
const STALE_THRESHOLD_MS = 120000; // 120s 无活动（目前降级为绿）
```

如需增加新的 Agent，在 `AGENTS` 数组中添加一项，指定进程名和 session 文件路径即可。

---

## 开发

```bash
# 克隆
git clone ~/mycode/agent-monitor
cd agent-monitor

# 本地测试运行守护进程
node scripts/agent-monitor.js

# 单独测试 SwiftBar 插件输出
bash scripts/agent-monitor.1s.sh
```

项目纯脚本实现，无 npm 依赖，零编译。

---

## 许可证

Apache License 2.0
