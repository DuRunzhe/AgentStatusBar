# AgentStatusBar

macOS 菜单栏里的 AI Coding Agent 状态监控器。通过 SwiftBar 汇总 Claude Code、Codex CLI 和 OpenCode 的运行状态、进程时长与上下文占用，并可点击菜单项跳回对应终端会话。

## 显示效果
<img width="1104" height="674" alt="image" src="https://github.com/user-attachments/assets/6f73cd65-4385-4ca7-98de-aa146894ca30" />

```text
1个等待确认 · 1个等待回复 · 1个进行中 · 1个就绪
├── 🟡 Claude (backend): 等待确认 (2h36m) · claude-sonnet-4-5 · 63.0% (126k/200k)
├── 🟡 Claude (docs): 等待回复 (48m) · claude-sonnet-4-5 · 31.5% (63k/200k)
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
<img width="712" height="26" alt="image" src="https://github.com/user-attachments/assets/4030c2aa-09c8-4c19-9f30-50def8b035ec" />


点击菜单栏图标展开详情。点击存活的 Agent 行可跳转到对应终端会话；已停止项不可点击。

## 功能

| 功能 | 说明 |
|---|---|
| 多 Agent / 多实例 | 同时监控 Claude Code、Codex CLI、OpenCode，并按项目区分多个会话 |
| 五态显示 | 等待确认、等待回复、进行中、就绪、已停止 |
| 多语言 | 按 macOS 首选语言显示英语、简体中文或繁体中文；语言优先于地区，默认英语 |
| 上下文占用 | Claude Code、Codex 和 OpenCode 显示百分比及 `已用/窗口` token 数 |
| 会话模型 | 在 Agent 实例行显示当前会话最新使用的模型名称 |
| 显示配置 | 在菜单中独立开关时长、模型、上下文占比、已用上下文和总上下文 |
| 工具调用配对 | 按 tool ID 配对 `tool_use` 与 `tool_result`，避免并行调用和扫描窗口截断误判 |
| 进程时长 | 显示 Agent 进程持续运行时间 |
| 会话跳转 | Terminal.app / iTerm2 精确切换标签页，其他受支持终端降级为激活应用 |
| 人工介入提醒 | 可在“设置 → 通知”启用；等待确认或等待回复时立即通知，持续 60 秒再次提醒，持续 3 分钟发送最后提醒，点击通知可跳转对应会话 |
| 开机自启 | 在“设置 → 开机自启”中引导安装或卸载用户级 LaunchAgent，并打开 macOS 登录项设置确认 SwiftBar 自启 |
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
bash scripts/install-swiftbar-plugin.sh
```

仓库内唯一的插件源码入口是 `scripts/agent-monitor.sh`。安装器只在 SwiftBar 插件目录创建 `agent-monitor.1s.sh` 软链接，用链接名称声明 1 秒刷新周期，并清理该目录中其他 `agent-monitor.*.sh` 软链接；同名普通文件不会被删除或覆盖。

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

### 4. 开启后台服务与开机自启

首次打开 SwiftBar 后：

1. 菜单提示“监控守护进程未启动”时，点击“启动守护进程”。
2. 进入“设置 → 开机自启 → 点击开启开机自启”。
3. 在确认弹窗中点击“开启”。AgentStatusBar 会安装并启动用户级 LaunchAgent。
4. 系统会打开“系统设置 → 通用 → 登录项与扩展”，确认 SwiftBar 已在“登录时打开”中启用。

也可以在仓库根目录直接启动同一套引导：

```bash
node scripts/startup-settings.js toggle
```

后台服务标识为 `com.agentstatusbar.monitor`，配置文件位于：

```text
~/Library/LaunchAgents/com.agentstatusbar.monitor.plist
```

SwiftBar 每秒启动稳定插件入口，但 Python 只在状态、配置或分钟级展示数据变化时一次生成两个动画帧并写入缓存；其他刷新直接选择缓存帧输出，进行中、等待确认和等待回复的动画频率保持不变。守护进程仍每 2 秒完成一次状态判断，但只在可见语义变化或跨分钟时原子更新 `/tmp/agent-status.json`。SwiftBar 每 2 秒异步生成精简进程快照；新 PID 或尚未解析的 cwd/session 会快速重试，稳定 PID 每 30 秒批量复核一次。较重的 `lsof` 和按需 Terminal 探测都不阻塞菜单渲染或守护进程轮询。

### 5. 普通 Codex 确认状态识别

普通方式启动的 Terminal.app Codex 会话在 rollout 只有普通未完成工具调用时，会异步核对该 Codex PID 对应 TTY 当前可见区域底部的完整确认界面。只有确认问题、编号 Yes/No 选项和底部确认提示同时匹配时才判定为等待确认，因此不会仅凭工具运行时间较长产生误判。探测只读取当前需要判断的 Codex TTY，不扫描无关 Terminal 标签页；Terminal.app 未运行时不会启动它。探测不阻塞监控器的 2 秒状态查询，也不需要替换或包装 `codex` 命令。

## 使用

| 操作 | 方式 |
|---|---|
| 查看汇总 | 查看 macOS 顶部菜单栏 |
| 查看实例详情 | 点击菜单栏图标 |
| 跳转 Agent 会话 | 点击存活的 Agent 菜单项 |
| 开启或关闭开机自启 | 点击“设置 → 开机自启 → 点击开启开机自启/点击关闭开机自启” |
| 开启或关闭通知 | 点击“设置 → 通知 → 点击开启通知/点击关闭通知”；首次开启会检查依赖、引导系统权限并发送测试通知 |
| 打开通知设置 | 点击“设置 → 通知 → 打开系统通知设置”；菜单会提示应在通知应用列表中查找 `terminal-notifier` |
| 从通知跳转会话 | 通知开关启用后，点击等待确认/等待回复通知 |
| 立即刷新 | 点击菜单底部的“立即刷新” |
| 重启守护进程 | 点击菜单底部的“重启守护进程”；会清理重复实例并通过 launchd 重启 |
| 调整显示内容 | 悬浮“设置 → 显示配置”，点击子菜单选项即可切换 |

显示配置和通知开关保存在 `~/.config/agent-statusbar/config.json`。开机自启状态由 `~/Library/LaunchAgents/com.agentstatusbar.monitor.plist` 判断；开启时安装并启动服务，关闭时卸载服务并删除 plist。首次运行时五项显示内容默认开启，通知默认关闭。受 macOS 原生菜单行为限制，执行操作后菜单会关闭；重新打开即可查看最新状态。

macOS 没有向普通脚本提供稳定的通知权限查询接口，因此开启流程使用测试通知确认：只有用户选择“已看到”才启用开关；选择“还没有”、取消依赖安装或退出设置流程都会保持关闭。

监控守护进程使用 `/tmp/agent-statusbar-monitor.pid` 保证同一时间只有一个实例写入状态文件。

会话跳转支持：

- Terminal.app、iTerm2：按 PID 对应的 TTY 精确切换到窗口/标签页。
- Warp、Visual Studio Code、Cursor、Windsurf、kitty、Alacritty：无法精确定位标签页时激活对应应用。
- 首次跳转时，macOS 可能询问 SwiftBar/Node.js 的“自动化”权限，需要允许控制终端应用。
- `terminal-notifier` 的通知权限和横幅样式需要在 macOS“系统设置 → 通知”中单独配置；通知开关会自动打开该页面，原有 `osascript` 通知设置不会自动继承。

## 数据来源

- **Claude Code**：`~/.claude/sessions/<PID>.json` 提供 PID/session/cwd 配对及原生 `busy` / `idle` / `waiting` 状态；Claude statusline 和 transcript 提供模型、会话路径、上下文窗口及使用率。
- **Codex CLI**：读取 `~/.codex/sessions/**/rollout-*.jsonl`，并在普通未完成工具调用无法区分执行与确认时，按 PID 对应 TTY 核对 Terminal.app 当前可见区域底部的完整确认界面。
- **OpenCode**：检测 `opencode` 进程，并优先从 `~/.local/share/opencode/opencode.db` 的当前目录最新会话读取状态、provider/model 和已用 token；上下文窗口来自 `~/.cache/opencode/models.json`，旧版 `storage/*` 保留为模型读取回退。
- **进程发现**：SwiftBar 后台采集器写入 agent 主进程及全部后代进程，并在 2 秒快照中保留 TTY；PID 到 cwd/session 的 `lsof` 元数据采用新 PID 快速解析、稳定 PID 周期复核的异步策略，不阻塞状态轮询。

## 状态判定

判定顺序如下：

1. 进程不存在：**已停止**。
2. 存在尚无同 ID 结果的 Codex `request_user_input` 或 Claude `AskUserQuestion`：**等待回复**。
3. Claude 原生状态为 `waiting`：**等待确认**；原生状态为 `busy` / `working` / `running`：**进行中**。
4. Claude 最新 `end_turn` 回复以直接问句结束，且之后没有新的人工消息：**等待回复**。
5. Codex 未完成工具调用显式声明 `sandbox_permissions: "require_escalated"`，或对应 TTY 底部显示完整 Codex 确认界面：**等待确认**。
6. 存在实际任务子进程：**进行中**（忽略 Codex 常驻的 `codex-code-mode-host` 和 app-server 进程）。
7. 其他尚无同 ID 结果的工具调用：**进行中**。
8. transcript 中有更晚的任务活动：**进行中**。Claude 的 `turn_duration` / `end_turn` 和 Codex 的 `task_complete` 将任务置为**就绪**；Codex 的 `task_started` 将任务置为**进行中**。
9. Claude 原生状态为 `idle` / `ready`：**就绪**。
10. 会话事件无法判断时，使用文件更新时间兜底：最近 30 秒有写入视为**进行中**，否则为**就绪**。

工具调用不是简单反向计数，而是按 tool ID 独立配对；窗口内只有结果、对应调用位于窗口外时，不会产生 pending。transcript 采用增量读取和事件状态累积，只解析新增内容，避免会话变长后拖慢 Codex/Claude 状态更新。

## 架构

```text
ps ──> 精简 Agent/全部后代进程快照（2 秒）──────────────────────────┐
lsof ──> 新 PID 快速解析、稳定 PID 30 秒批量复核（异步）────────────┤
Claude sessions/statusline/transcript ──────────────────────────────┤
Codex rollout ──> 按需异步探测目标 Terminal TTY 确认界面 ───────────┤
OpenCode SQLite/model catalog ───────────────────────────────────────┤
                                                                     v
                                                         agent-monitor.js
                                                         每 2 秒增量判断
                                                                     |
                                                                     v
                                                         /tmp/agent-status.json
                                                                     |
                                                                     v
                                                         agent-monitor.1s.sh（安装链接）
                                                                     |
                                                                     v
                                                         agent-monitor.sh
                                                         选择双帧菜单缓存

点击 Agent 行 ──> focus-agent-session.js ──> TTY ──> 终端窗口/应用
```

### 技术方案

#### 1. 采集调度与进程发现

SwiftBar 通过唯一稳定入口 `scripts/agent-monitor.sh` 每秒刷新一次。入口脚本本身不在每次刷新时同步执行完整采集，而是按文件时间、状态标记和目录锁调度后台任务：

| 数据 | 调度策略 | 阻塞菜单渲染 |
|---|---|---|
| Agent 进程快照 | 最多每 2 秒一次 | 否 |
| 新 PID 的 cwd/session 元数据 | 根 PID 列表变化后立即采集 | 否 |
| 尚未解析成功的 PID | 每 2 秒重试 | 否 |
| 稳定 PID 的 cwd/session 元数据 | 每 30 秒批量复核 | 否 |
| Codex Terminal 确认界面 | 仅有歧义状态时按目标 TTY 请求 | 否 |
| 守护进程状态判断 | 每 2 秒一次 | 独立进程 |
| SwiftBar 菜单输出 | 每秒选择已有缓存帧 | 是，但只读取小文件 |

`write-process-snapshot.sh` 使用一次 `ps -axo pid,ppid,etime,tty,command` 获取全量进程表，再由 `awk` 找出 Claude、Codex、OpenCode 主进程及其全部后代进程。快照保留 PID、PPID、进程寿命、TTY 和完整命令，供任务子进程判断及终端跳转使用。根 PID 列表只有内容变化时才替换，因此文件 inode 可以作为新建或退出会话的稳定变化键。

Codex 和 OpenCode 的 cwd/session 元数据由 `write-process-metadata.sh` 自适应采集：

- 根 PID inode 与上次已处理值不一致时立即运行，不依赖秒级 mtime，避免新会话与上次刷新恰好发生在同一秒时延迟 30 秒。
- 需要解析的多个 PID 合并成一次 `lsof -Fn -p pid1,pid2,...`，避免逐 PID 启动 `lsof`。
- Codex 映射只有同时获得有效 cwd 和仍存在的 rollout 文件才视为成功；OpenCode 获得有效 cwd 即可。
- 新 PID 尚未生成 rollout 时写入 retry 标记，入口脚本每 2 秒重试；解析成功后删除标记。
- `lsof` 暂时失败时保留最后一次有效映射，但稳定 PID 仍会在 30 秒后重新验证，因此这不是永久缓存。
- 已退出 PID 不再写入新的 metadata/state 文件，会随下一轮采集自然清除。

所有后台采集使用 `mkdir` 目录作为互斥锁；进程快照锁、元数据锁、Terminal 探测锁和菜单缓存锁均有陈旧锁回收逻辑。采集结果先写同目录临时文件，再通过 `mv` 原子替换，守护进程不会读到半写入内容。

#### 2. 会话数据与状态聚合

常驻的 `agent-monitor.js` 每 2 秒读取进程快照并聚合三类 Agent。进程元数据按 mtime 增量加载；文件没有变化时复用内存中的解析结果。

- Claude 使用原生 session 状态、statusline 和 transcript，PID/session/cwd 不依赖周期 `lsof`。
- Codex 将 PID 与 rollout 配对，按事件 ID 匹配工具调用和结果，并累计 `task_started`、`task_complete`、模型及 token 使用情况。
- OpenCode 按 cwd 查询 SQLite 中最新会话和消息，模型上下文窗口来自本地模型目录；数据库及模型文件签名未变化时复用查询结果。
- Codex/Claude transcript 使用文件 mtime、大小和上次读取偏移量增量解析，只处理追加事件；文件截断或替换时才重新完整解析。

状态使用“明确的人机交互信号优先于进程活跃信号”的统一优先级：结构化用户输入请求和显式确认请求优先，其次是原生状态、实际任务子进程、未完成工具调用和 transcript 生命周期，最后才使用最近文件活动时间兜底。这样长时间运行的普通命令不会仅因耗时被误判为等待确认。

普通 Terminal.app Codex 在 rollout 只表现为普通未完成工具调用、无法区分执行与确认时，守护进程把目标 TTY 原子写入探测请求文件。SwiftBar 入口发现新请求后异步调用 `terminal-prompt-state.js`，只读取指定 TTY 的当前可见区域；结果超过 5 秒即视为过期。确认界面必须同时匹配确认问题、Yes/No 选项和底部提示；如果 Codex 会话在探测完成后已有更新，也会丢弃旧确认快照，避免新的分析进度或后台终端运行状态被短暂误判为等待确认。探测失败或 Terminal.app 未运行都不会反向推断为等待确认。

#### 3. 状态发布与通知时序

守护进程仍保持每 2 秒完整判断，检测精度没有因减少磁盘写入而降低。`status-publication.js` 为输出生成语义签名：

- 状态、PID、会话数量、目录标签、模型、上下文用量、语言、显示配置和通知配置变化时立即发布。
- `uptime_sec` 按菜单实际展示的分钟归一化。
- 秒级 `timestamp`、精确活动毫秒数和仅由这些字段派生的 detail 不触发写入。
- 即使没有语义变化，也会在跨分钟时发布一次，使“最后更新”和分钟级时长正常前进。
- 状态文件不存在或守护进程刚启动时强制发布。

输出先写 `/tmp/agent-status.json.<PID>.tmp`，再原子替换 `/tmp/agent-status.json`。进入等待确认或等待回复时，新的状态文件会先落盘，再调用 macOS 通知服务；即使通知服务短暂阻塞，菜单也不会继续显示旧状态。

#### 4. SwiftBar 菜单缓存与动画

`agent-monitor.sh` 使用以下内容组成菜单缓存键：

- `/tmp/agent-status.json` 的 mtime 和大小；
- `render-menu.py` 的 mtime 和大小；
- LaunchAgent plist 的 mtime 和大小。

缓存失效时，Python 只解析一次 JSON，并一次生成 `/tmp/agent-statusbar-menu.0`、`.1`、`.mode` 和 `.key`。两个菜单文件包含相同正文和不同图标帧；`.key` 最后原子写入，只有四个文件都完整存在且键匹配时才算缓存命中。

缓存命中后不再启动 Python，Shell 直接按当前秒选择菜单帧并用 `cat` 输出：等待确认/等待回复每秒切换一帧，进行中每 2 秒切换一帧，静态状态固定使用第 0 帧。因此现有动画频率和状态响应速度保持不变，但状态未变化时不会每秒重新解析 JSON、拼接菜单和构造 Python 进程。缓存缺失或渲染失败时会回退到实时 Python 渲染。

#### 5. 内存与长期运行控制

守护进程只缓存可复用的解析结果，并在每次轮询后回收：

- PID 到 session、PID 到 cwd 的缓存会在 PID 不再存活时立即删除。
- transcript 分析缓存保护当前活跃会话；非活跃项使用 24 小时 TTL、200 项 LRU 上限，文件已删除时立即移除。
- OpenCode runtime 查询缓存保护当前活跃 cwd；非活跃项使用 24 小时 TTL、100 项 LRU 上限。
- 仍可能重新激活的会话分析不会因进程刚退出就立即丢弃，避免频繁退出/恢复造成完整 transcript 重读。

这套策略把稳定状态下的固定成本控制在每 2 秒一次 `ps` 快照、每 30 秒一次稳定 PID 批量 `lsof`、每 2 秒一次内存内状态判断，以及每秒一次小型缓存文件读取；昂贵操作均异步或按变化触发，不占用 SwiftBar 的菜单返回路径。

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
bash scripts/agent-monitor.sh

# 安装或迁移 SwiftBar 插件软链接
bash scripts/install-swiftbar-plugin.sh

# 查看守护进程状态
launchctl print "gui/$(id -u)/com.agentstatusbar.monitor"

# 查看错误日志
tail -n 50 /tmp/agent-monitor.stderr.log

# 查看最近一次 Terminal 确认探测结果、耗时或权限/超时错误
cat /tmp/agent-statusbar-terminal-state.json

# 重新加载 Claude statusline 集成
node scripts/install-claude-statusline.js

# 运行测试与语法检查
node --test scripts/*.test.js
node --check scripts/agent-monitor.js
bash -n scripts/agent-monitor.sh scripts/install-swiftbar-plugin.sh
python3 -m py_compile scripts/render-menu.py
```

常见问题：

- 菜单栏没有出现：重新运行 `bash scripts/install-swiftbar-plugin.sh`，确认 SwiftBar 插件目录中的 `agent-monitor.1s.sh` 指向仓库的 `scripts/agent-monitor.sh`。
- 显示“监控守护进程未启动”：点击菜单中的“启动守护进程”，然后通过“设置 → 开机自启”完成持久化安装；也可运行 `node scripts/startup-settings.js toggle` 重新执行引导。
- 开机自启无法开启：确认仓库没有被移动或删除，再重新执行开启操作；使用 `launchctl print "gui/$(id -u)/com.agentstatusbar.monitor"` 检查服务状态。
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
