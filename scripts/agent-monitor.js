#!/usr/bin/env node
/**
 * agent-monitor.js — AI Coding Agent 状态监控守护进程
 *
 * 检测 Claude Code / Codex CLI / OpenCode 的运行状态，
 * 支持每个 agent 的多个会话（实例）独立追踪。
 * 写入 /tmp/agent-status.json 供 SwiftBar 插件显示。
 * 进入需要人工介入的状态时自动发送 macOS 原生通知。
 *
 * 状态定义：waiting / waiting_reply / working / ready / stopped
 */

const fs = require('fs');
const path = require('path');
const { getClaudeNativeState, getClaudeRuntimeForPid } = require('./claude-context');
const { getInstanceTrackerKey } = require('./instance-key');
const { DEFAULT_LOCALE, getMessages, getUiStrings } = require('./i18n');
const { advanceWaitingNotification } = require('./notification-state');
const { sendNativeNotification } = require('./notification-delivery');
const { readDisplayConfig } = require('./display-config');
const { acquireProcessLock } = require('./process-lock');
const { buildStatusSummary } = require('./status-summary');
const { resolveAgentState } = require('./state-priority');
const { getOpenCodeRuntimeForCwd } = require('./opencode-state');
const {
  getClaudeModelInLines,
  getCodexModelInLines,
  getOpenCodeModel,
} = require('./model-state');
const {
  getClaudeReplyRequestInLines,
  getClaudeTaskStateInLines,
  getCodexContextUsageInLines,
  getCodexTaskStateInLines,
  getPendingToolUseKindInLines,
} = require('./tool-state');
const {
  hasActiveDescendantProcesses,
  isPrimaryCodexSessionHeader,
  parseProcessSnapshot,
} = require('./process-state');

// ============================================================
// Configuration
// ============================================================
const STATUS_FILE = '/tmp/agent-status.json';
const STATUS_TEMP_FILE = `${STATUS_FILE}.${process.pid}.tmp`;
const LOCALE_FILE = '/tmp/agent-statusbar-locale';
const PROCESS_SNAPSHOT_FILE = '/tmp/agent-statusbar-processes';
const PROCESS_METADATA_FILE = '/tmp/agent-statusbar-process-metadata';
const LOCK_FILE = '/tmp/agent-statusbar-monitor.pid';
const POLL_MS = 2000;               // 轮询间隔
const WAIT_THRESHOLD_MS = 30000;    // 30s 无活动 → waiting
const STALE_THRESHOLD_MS = 120000;  // 120s 无活动 → stale
let LOCALE = DEFAULT_LOCALE;
let TEXT = getMessages(LOCALE);

const releaseProcessLock = acquireProcessLock(LOCK_FILE);
if (!releaseProcessLock) {
  console.error('agent-monitor is already running');
  process.exit(0);
}
process.on('exit', releaseProcessLock);

function refreshLocale() {
  try {
    const locale = fs.readFileSync(LOCALE_FILE, 'utf8').trim();
    if (!['en', 'zh-Hans', 'zh-Hant'].includes(locale) || locale === LOCALE) return;
    LOCALE = locale;
    TEXT = getMessages(locale);
  } catch {}
}

// Agent definitions
const AGENTS = [
  {
    name: 'Claude',
    process: 'claude',
    sessionDir: path.join(process.env.HOME, '.claude', 'transcripts'),
    sessionGlob: '*.jsonl',
  },
  {
    name: 'Codex',
    process: 'codex',
    sessionDir: path.join(process.env.HOME, '.codex', 'sessions'),
    sessionGlob: '**/rollout-*.jsonl',
  },
  {
    name: 'OpenCode',
    process: 'opencode',
    sessionDir: path.join(process.env.HOME, '.local', 'share', 'opencode'),
    sessionGlob: '**/storage/*',
  },
];

// ============================================================
// 状态追踪（按实例 key，如 "Claude:Claude #1"）
// ============================================================

/** @type {Object<string, { previousState: string, waitingSince: number|null, remindersSent: number }>} */
const INSTANCE_TRACKER = {};

// ============================================================
// Helpers
// ============================================================

/**
 * 发送 macOS 原生通知
 * @param {string} agentName
 * @param {string} instanceLabel
 * @param {number} reminderStage 0=立即, 1=60 秒, 2=3 分钟最后提醒
 */
function sendNotification(agentName, instanceLabel, reminderStage, state, pid) {
  const target = instanceLabel === agentName ? agentName : instanceLabel;
  const messages = state === 'waiting_reply' ? TEXT.replyNotificationMessages : TEXT.notificationMessages;
  const subtitles = state === 'waiting_reply' ? TEXT.replyNotificationSubtitles : TEXT.notificationSubtitles;
  const message = messages[reminderStage] || messages[0];
  const subtitleText = subtitles[reminderStage] || subtitles[0];
  const msg = message(target);
  const subtitle = subtitleText(agentName);
  sendNativeNotification({ title: 'Agent Monitor', subtitle, message: msg, pid });
}

let lastProcessSnapshot = [];
let lastProcessSnapshotMtime = 0;
let processMetadataMtime = 0;
let processMetadata = new Map();
const PID_SESSION_CACHE = new Map();
const PID_CWD_CACHE = new Map();
const SESSION_ANALYSIS_CACHE = new Map();

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function getClaudeSessionProcesses() {
  const sessionDir = path.join(process.env.HOME || '', '.claude', 'sessions');
  try {
    return fs.readdirSync(sessionDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          const session = JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf8'));
          return Number.isInteger(session.pid) && isPidRunning(session.pid)
            ? { pid: session.pid, ppid: 0, elapsed_sec: 0, command: 'claude' }
            : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getProcessSnapshot() {
  try {
    const stat = fs.statSync(PROCESS_SNAPSHOT_FILE);
    if (Date.now() - stat.mtimeMs <= 30_000 && stat.mtimeMs !== lastProcessSnapshotMtime) {
      lastProcessSnapshot = parseProcessSnapshot(fs.readFileSync(PROCESS_SNAPSHOT_FILE, 'utf8'));
      lastProcessSnapshotMtime = stat.mtimeMs;
    }
  } catch {}

  const merged = new Map();
  for (const processInfo of lastProcessSnapshot) {
    merged.set(processInfo.pid, processInfo);
  }
  for (const processInfo of getClaudeSessionProcesses()) {
    if (!merged.has(processInfo.pid)) merged.set(processInfo.pid, processInfo);
  }
  return [...merged.values()];
}

function refreshProcessMetadata() {
  try {
    const stat = fs.statSync(PROCESS_METADATA_FILE);
    if (stat.mtimeMs === processMetadataMtime) return;

    const next = new Map();
    for (const line of fs.readFileSync(PROCESS_METADATA_FILE, 'utf8').split('\n')) {
      const [pidText, kind, value] = line.split('\t', 3);
      const pid = Number.parseInt(pidText, 10);
      if (!Number.isInteger(pid) || !value) continue;
      if (!next.has(pid)) next.set(pid, { cwd: null, files: [] });
      if (kind === 'cwd') next.get(pid).cwd = value;
      if (kind === 'file') next.get(pid).files.push(value);
    }
    processMetadata = next;
    processMetadataMtime = stat.mtimeMs;
  } catch {}
}

function findProcess(name, processes) {
  const pids = processes
    .filter(processInfo => path.basename(processInfo.command) === name)
    .map(processInfo => processInfo.pid)
    .filter(isPidRunning);
  return pids.length > 0 ? pids : null;
}

/**
 * 通过 lsof 查找指定 PID 打开的 session 文件路径。
 * 返回 null 表示无法确定。
 */
function getSessionFileForPid(pid, agentDef) {
  if (agentDef.name === 'Claude') {
    return getClaudeRuntimeForPid(pid)?.transcript_path || null;
  }

  const cacheKey = `${agentDef.name}:${pid}`;
  const cached = PID_SESSION_CACHE.get(cacheKey);
  if (cached && fs.existsSync(cached)) return cached;

  try {
    const files = processMetadata.get(pid)?.files || [];

    if (agentDef.name === 'Codex') {
      const rolloutFiles = files.filter(f =>
        f.endsWith('.jsonl') && f.startsWith(agentDef.sessionDir + path.sep)
      );
      const primaryFiles = rolloutFiles.filter(file => {
        try {
          const fd = fs.openSync(file, 'r');
          const buffer = Buffer.alloc(8192);
          const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
          fs.closeSync(fd);
          return isPrimaryCodexSessionHeader(buffer.toString('utf8', 0, bytesRead));
        } catch {
          return false;
        }
      });
      primaryFiles.sort((a, b) => getFileMtime(b) - getFileMtime(a));
      const sessionFile = primaryFiles[0] || null;
      if (sessionFile) PID_SESSION_CACHE.set(cacheKey, sessionFile);
      return sessionFile;
    }
    if (agentDef.name === 'OpenCode') {
      const sessionFile = files.find(f =>
        f.includes(path.sep + 'storage' + path.sep) &&
        f.includes(path.sep + 'opencode' + path.sep)
      ) || null;
      if (sessionFile) PID_SESSION_CACHE.set(cacheKey, sessionFile);
      return sessionFile;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 获取单个文件的 mtime，不存在返回 0
 */
function getFileMtime(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.statSync(filePath).mtimeMs;
  } catch {}
  return 0;
}

/**
 * 判断实例状态
 *
 * 状态体系：
 *   🔵 working  — 有实际任务子进程，或 session 最近状态为 task_started
 *   🟢 ready    — 无子进程 + session 已空闲较长时间 → 就绪，可以下达新任务
 *   🟡 waiting  — 有待批准的工具调用 → 在等你确认
 *   🟡 waiting_reply — 有结构化询问 → 在等你回复
 *   ⚪ stopped  — 进程已退出
 *
 * 判定策略：实际任务子进程优先，辅以 session 事件和 mtime 时间窗
 *   🟡 waiting  — tool_use pending → 在等你批准工具执行
 *   ⚪ stopped  — 进程已退出
 *
 * 判定策略：
 *   一级: 实际任务子进程检测 → 进行中（忽略常驻辅助进程）
 *   二级: 读 transcript/rollout → pending=等待确认, task_started/task_complete=进行中/就绪
 *   三级: mtime 时间窗(仅当文件无法判断时兜底)
 */
function determineState(
  pids,
  lastEventTimeMs,
  now,
  sessionFile,
  agentName,
  nativeState = null,
  processes = [],
  sessionAnalysis = null
) {
  const alive = pids && pids.length > 0;
  if (!alive) return { state: 'stopped', label: TEXT.status.stopped, emoji: '⚪' };

  const pendingKind = sessionAnalysis?.pendingKind ?? null;
  const transcriptState = sessionAnalysis?.taskState ?? null;
  const hasActiveChild = pids.some(pid => hasActiveChildProcesses(pid, agentName, processes));
  const resolved = resolveAgentState({
    alive,
    pendingKind,
    nativeState,
    hasActiveChild,
    transcriptState,
    replyRequested: sessionAnalysis?.replyRequested || false,
  });
  if (resolved === 'waiting_reply') {
    return { state: resolved, label: TEXT.status.waitingReply, emoji: '🟡' };
  }
  if (resolved === 'waiting') {
    return { state: resolved, label: TEXT.status.waiting, emoji: '🟡' };
  }
  if (resolved === 'working') {
    return { state: resolved, label: TEXT.status.working, emoji: '🔵' };
  }
  if (resolved === 'ready') {
    return { state: resolved, label: TEXT.status.ready, emoji: '🟢' };
  }

  // 三级信号：文件判断无结果 → 用 mtime 兜底
  if (!lastEventTimeMs) return { state: 'ready', label: TEXT.status.ready, emoji: '🟢' };
  const age = now - lastEventTimeMs;
  if (age < WAIT_THRESHOLD_MS) return { state: 'working', label: TEXT.status.working, emoji: '🔵' };
  return { state: 'ready', label: TEXT.status.ready, emoji: '🟢' };
}

function getPidAge(pid, processes) {
  return processes.find(processInfo => processInfo.pid === pid)?.elapsed_sec || 0;
}

function formatUptime(sec) {
  if (sec <= 0) return '';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h${m}m`;
}

/**
 * 检查 PID 是否有实际任务子进程
 */
function hasActiveChildProcesses(pid, agentName, processes) {
  return hasActiveDescendantProcesses(pid, agentName, processes);
}

/**
 * 获取进程的工作目录（项目根路径）
 */
function getProcessCwd(pid) {
  if (PID_CWD_CACHE.has(pid)) return PID_CWD_CACHE.get(pid);
  const cwd = processMetadata.get(pid)?.cwd || null;
  if (cwd) PID_CWD_CACHE.set(pid, cwd);
  return cwd;
}

/**
 * 扫描 session 文件最近 N 行，按 tool ID 配对判断是否有未确认的 tool_use
 * Claude 工作流: 用户发消息 → 写入 tool_use(请求工具) → 问用户确认 → 用户批准 → 写入 tool_result
 * pending = 存在没有对应 tool_result 的 tool_use → 有工具请求在等你批准
 */
function readLastJsonLines(filePath, count) {
  const stat = fs.statSync(filePath);
  const maxBytes = 2 * 1024 * 1024;
  const bytesToRead = Math.min(stat.size, maxBytes);
  const buffer = Buffer.alloc(bytesToRead);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.readSync(descriptor, buffer, 0, bytesToRead, stat.size - bytesToRead);
  } finally {
    fs.closeSync(descriptor);
  }
  const text = buffer.toString('utf8');
  let end = text.length;
  while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r')) end--;

  let cursor = end;
  let linesFound = 0;
  while (cursor > 0 && linesFound < count) {
    const newline = text.lastIndexOf('\n', cursor - 1);
    if (newline < 0) {
      cursor = 0;
      break;
    }
    cursor = newline;
    linesFound++;
  }

  const start = cursor > 0 ? cursor + 1 : 0;
  const lines = text.slice(start, end).split('\n').filter(Boolean);
  if (stat.size > bytesToRead && start === 0) lines.shift();
  return lines.slice(-count);
}

function readFileRange(filePath, start, length) {
  if (length <= 0) return '';
  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const bytesRead = fs.readSync(descriptor, buffer, 0, length, start);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
}

function buildSessionAnalysis(events, agentName, previous = null, appendedEvents = events) {
  return {
    pendingKind: getPendingToolUseKindInLines(events.slice(-30)),
    taskState: agentName === 'Claude'
      ? getClaudeTaskStateInLines(appendedEvents, previous?.taskState || null)
      : (agentName === 'Codex'
          ? getCodexTaskStateInLines(appendedEvents, previous?.taskState || null)
          : null),
    replyRequested: agentName === 'Claude'
      ? getClaudeReplyRequestInLines(appendedEvents, previous?.replyRequested || false)
      : false,
    contextUsage: agentName === 'Codex'
      ? getCodexContextUsageInLines(appendedEvents) || previous?.contextUsage || null
      : null,
    model: agentName === 'Claude'
      ? getClaudeModelInLines(appendedEvents) || previous?.model || null
      : (agentName === 'Codex'
          ? getCodexModelInLines(appendedEvents) || previous?.model || null
          : null),
  };
}

function analyzeSessionFile(sessionFile, agentName) {
  if (!sessionFile) return null;
  try {
    const stat = fs.statSync(sessionFile);
    const cached = SESSION_ANALYSIS_CACHE.get(sessionFile);
    if (cached?.mtimeMs === stat.mtimeMs && cached?.size === stat.size) return cached.analysis;

    let events;
    let appendedEvents;
    let partial = '';
    const appendedBytes = cached && stat.size >= cached.size ? stat.size - cached.size : -1;
    if (cached && appendedBytes >= 0 && appendedBytes <= 2 * 1024 * 1024) {
      const chunks = `${cached.partial || ''}${readFileRange(sessionFile, cached.size, appendedBytes)}`
        .split('\n');
      partial = chunks.pop() || '';
      appendedEvents = chunks.filter(Boolean).map(JSON.parse);
      events = [...cached.events, ...appendedEvents].slice(-200);
    } else {
      events = readLastJsonLines(sessionFile, 200).map(JSON.parse);
      appendedEvents = events;
    }

    const analysis = appendedEvents.length === 0
      ? cached.analysis
      : buildSessionAnalysis(events, agentName, cached?.analysis || null, appendedEvents);
    SESSION_ANALYSIS_CACHE.set(sessionFile, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      partial,
      events,
      analysis,
    });
    return analysis;
  } catch {
    return null;
  }
}

function formatLastActivity(ms) {
  if (ms == null) return '';
  const sec = Math.floor(ms / 1000);
  const value = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m`;
  return TEXT.lastActivity(value);
}

// ============================================================
// 核心：获取每个 agent 的实例列表
// ============================================================

function getInstances(agentDef, processes) {
  const pids = findProcess(agentDef.process, processes);
  const now = Date.now();

  // 无进程 → ⚪ 已停止
  if (!pids || pids.length === 0) {
    const status = determineState(null, 0, now, null, agentDef.name, null, processes);
    return [{
      ...status,
      label: agentDef.name,
      status_label: status.label,
      pids: [],
      uptime_sec: 0,
      last_activity_ms_ago: null,
      model: null,
      context_usage: null,
    }];
  }

  // 用 lsof 将 PID 分组到 session 文件
  const groups = {};
  for (const pid of pids) {
    const sessionFile = getSessionFileForPid(pid, agentDef);
    const key = sessionFile || `__pid_${pid}`;
    if (!groups[key]) groups[key] = { sessionFile, pids: [] };
    groups[key].pids.push(pid);
  }

  // 合并同文件的不同 key（去重 PIDs）
  const merged = {};
  for (const [key, g] of Object.entries(groups)) {
    const mergeKey = g.sessionFile || key;
    if (!merged[mergeKey]) merged[mergeKey] = { sessionFile: g.sessionFile, pids: [] };
    merged[mergeKey].pids.push(...g.pids);
  }

  // 去重 PID
  for (const m of Object.values(merged)) {
    m.pids = [...new Set(m.pids)];
  }

  const keys = Object.keys(merged);
  let idx = 0;

  return keys.map(key => {
    const group = merged[key];
    idx++;
    const mtime = group.sessionFile ? getFileMtime(group.sessionFile) : 0;
    const pidAge = Math.min(...group.pids.map(p => getPidAge(p, processes)));
    // 提取项目名：从第一个 PID 的 CWD 取最后一段路径
    let projectLabel = agentDef.name;
    const firstPid = group.pids[0];
    const claudeRuntime = agentDef.name === 'Claude' && firstPid
      ? getClaudeRuntimeForPid(firstPid)
      : null;
    const cwd = claudeRuntime?.cwd || (firstPid ? getProcessCwd(firstPid) : null);
    if (cwd && keys.length > 1) {
      const projectName = path.basename(cwd);
      projectLabel = `${agentDef.name} (${projectName})`;
    } else if (keys.length > 1) {
      projectLabel = `${agentDef.name} #${idx}`;
    }

    const openCodeRuntime = agentDef.name === 'OpenCode' && cwd
      ? getOpenCodeRuntimeForCwd(cwd, agentDef.sessionDir)
      : null;
    const nativeState = agentDef.name === 'Claude'
      ? getClaudeNativeState(claudeRuntime)
      : openCodeRuntime?.state || null;
    const sessionAnalysis = agentDef.name === 'Claude' || agentDef.name === 'Codex'
      ? analyzeSessionFile(group.sessionFile, agentDef.name)
      : null;
    const status = determineState(
      group.pids,
      mtime,
      now,
      group.sessionFile,
      agentDef.name,
      nativeState,
      openCodeRuntime ? [] : processes,
      sessionAnalysis
    );
    let contextUsage = null;
    let model = null;
    if (agentDef.name === 'Codex' && group.sessionFile) {
      contextUsage = sessionAnalysis?.contextUsage || null;
      model = sessionAnalysis?.model || null;
    } else if (agentDef.name === 'Claude') {
      contextUsage = claudeRuntime?.context_usage || null;
      model = sessionAnalysis?.model
        || claudeRuntime?.model
        || null;
    } else if (agentDef.name === 'OpenCode') {
      model = openCodeRuntime?.model
        || (group.sessionFile
          ? getOpenCodeModel(group.sessionFile, path.join(agentDef.sessionDir, 'storage'))
          : null);
    }
    const processStartedAt = now - pidAge * 1000;
    const lastActivityMs = openCodeRuntime?.lastActivityMs >= processStartedAt
      ? openCodeRuntime.lastActivityMs
      : mtime;
    return {
      ...status,
      label: projectLabel,
      status_label: status.label,
      pids: group.pids,
      uptime_sec: pidAge,
      last_activity_ms_ago: group.pids.length > 0 && lastActivityMs > 0
        ? (now - lastActivityMs)
        : null,
      model,
      context_usage: contextUsage,
    };
  });
}

// ============================================================
// Main loop
// ============================================================

function poll() {
  refreshLocale();
  refreshProcessMetadata();
  const now = Date.now();
  const appConfig = readDisplayConfig();
  const agents = [];
  const processes = getProcessSnapshot();

  for (const agentDef of AGENTS) {
    agents.push({
      name: agentDef.name,
      instances: getInstances(agentDef, processes),
    });
  }

  // ── 汇总数量 ──
  const allWorking = agents.flatMap(a => a.instances).filter(i => i.state === 'working');
  const allReady = agents.flatMap(a => a.instances).filter(i => i.state === 'ready');
  const allWaiting = agents.flatMap(a => a.instances).filter(i => i.state === 'waiting');
  const allWaitingReply = agents.flatMap(a => a.instances).filter(i => i.state === 'waiting_reply');

  const summary = buildStatusSummary({
    waiting: allWaiting.length,
    waitingReply: allWaitingReply.length,
    working: allWorking.length,
    ready: allReady.length,
  }, TEXT);

  // ── 详情行 ──
  const details = [];
  for (const agent of agents) {
    for (const inst of agent.instances) {
      let line = `${inst.emoji} ${inst.label}: ${inst.status_label}`;
      if (inst.pids.length > 0) {
        line += ` (PID ${inst.pids.join(',')})`;
      }
      // 计时：使用 session 文件 mtime（最后活动时间），不用 ps -o etime（进程总寿命不准）
      if (inst.last_activity_ms_ago != null) {
        if (inst.state === 'waiting' || inst.state === 'waiting_reply') {
          line += ` ${formatLastActivity(inst.last_activity_ms_ago)}`;
        } else if (inst.state === 'ready') {
          line += ` ${formatLastActivity(inst.last_activity_ms_ago)}`;
        } else if (inst.state === 'working' && inst.last_activity_ms_ago < WAIT_THRESHOLD_MS) {
          line += ` ${formatLastActivity(inst.last_activity_ms_ago)}`;
        }
      }
      details.push(line);
    }
  }

  // ── 输出 JSON ──
  const output = {
    timestamp: new Date().toISOString(),
    locale: LOCALE,
    summary: `${summary.emoji} ${summary.label}`,
    ui: getUiStrings(LOCALE),
    display_config: appConfig,
    notifications_enabled: appConfig.notifications === true,
    detail: details,
    agents,
    multiSession: true,
  };

  fs.writeFileSync(STATUS_TEMP_FILE, JSON.stringify(output, null, 2));
  fs.renameSync(STATUS_TEMP_FILE, STATUS_FILE);

  // Notifications may block in macOS services. Persist the fresh state first so
  // SwiftBar never keeps showing the previous state while a notification runs.
  const currentInstanceKeys = new Set();
  for (const agent of agents) {
    for (const inst of agent.instances) {
      const key = getInstanceTrackerKey(agent.name, inst);
      currentInstanceKeys.add(key);
      if (appConfig.notifications !== true) {
        delete INSTANCE_TRACKER[key];
        continue;
      }
      const next = advanceWaitingNotification(INSTANCE_TRACKER[key], inst.state, now);
      INSTANCE_TRACKER[key] = next.tracker;
      if (next.reminderStage != null) {
        sendNotification(agent.name, inst.label, next.reminderStage, inst.state, inst.pids[0]);
      }
    }
  }
  for (const key of Object.keys(INSTANCE_TRACKER)) {
    if (!currentInstanceKeys.has(key)) delete INSTANCE_TRACKER[key];
  }

}

// ============================================================
// Start
// ============================================================

console.log('agent-monitor started — polling every', POLL_MS / 1000, 's');
console.log('writing to', STATUS_FILE);
console.log('multi-session tracking enabled');

function runPoll() {
  try {
    poll();
  } catch (error) {
    console.error('poll failed:', error?.stack || error);
  }
}

setInterval(runPoll, POLL_MS);
runPoll();
