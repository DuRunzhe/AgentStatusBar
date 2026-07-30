#!/usr/bin/env node
/**
 * agent-monitor.js — AI Coding Agent 状态监控守护进程
 *
 * 检测 Claude Code / Codex CLI / OpenCode 的运行状态，
 * 写入 /tmp/agent-status.json 供 SwiftBar 插件显示。
 * 进入 🟡 等待确认 状态时自动发送 macOS 原生通知。
 *
 * 状态定义：
 *   🟢 running       — 进程存活，session 文件近期有活动
 *   🟡 waiting       — 进程存活，但 >30s 无 session 活动（等待用户确认/输入）
 *   🟠 stale         — 进程存活，>120s 无活动（可能卡死/丢失）
 *   ⚪ stopped       — 进程已退出（exit code 0 = 完成，非 0 = 异常）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================
// Configuration
// ============================================================
const STATUS_FILE = '/tmp/agent-status.json';
const POLL_MS = 2000;        // 轮询间隔
const WAIT_THRESHOLD_MS = 30000;   // 30s 无活动 → waiting
const STALE_THRESHOLD_MS = 120000; // 120s 无活动 → stale
const NO_FILE_TIMEOUT_MS = 5000;   // 5s 内找不到 session 文件也不再重试
const NOTIFICATION_COOLDOWN_MS = 3000; // 同一 agent 通知冷却时间（3 秒）

// Agent definitions
const AGENTS = [
  {
    name: 'Claude',
    process: 'claude',
    sessionDir: path.join(process.env.HOME, '.claude', 'transcripts'),
    sessionGlob: '*.jsonl',
    lastEventFile: null,
    lastEventTime: 0,
    exitCode: null,
  },
  {
    name: 'Codex',
    process: 'codex',
    sessionDir: path.join(process.env.HOME, '.codex'),
    sessionGlob: 'history.jsonl',
    lastEventFile: null,
    lastEventTime: 0,
    exitCode: null,
  },
  {
    name: 'OpenCode',
    process: 'opencode',
    sessionDir: path.join(process.env.HOME, '.local', 'share', 'opencode'),
    sessionGlob: '**/storage/*',
    lastEventFile: null,
    lastEventTime: 0,
    exitCode: null,
  },
];

// ============================================================
// 状态追踪（用于状态变更检测）
// ============================================================

/** @type {Object<string, { previousState: string, notifiedAt: number|null }>} */
const AGENT_TRACKER = {};

// ============================================================
// Helpers
// ============================================================

/**
 * 发送 macOS 原生通知
 * @param {string} agentName
 * @param {string} agentLabel
 */
function sendNotification(agentName, agentLabel) {
  const msg = `${agentName} 已进入 🟡 等待确认（${agentLabel || '等待用户输入'}）`;
  try {
    const escaped = msg.replace(/"/g, '\\"');
    execSync(
      `osascript -e 'display notification "${escaped}" with title "Agent Monitor" subtitle "${agentName} 等待确认"'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000 }
    );
  } catch { /* silent */ }
}

function findProcess(name) {
  try {
    const out = execSync(`pgrep -x "${name}" 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!out) return null;
    const pids = out.split('\n').map(s => parseInt(s));
    return pids;
  } catch {
    return null;
  }
}

function getLatestMtime(dir, glob) {
  try {
    if (!fs.existsSync(dir)) return 0;

    const items = fs.readdirSync(dir, { withFileTypes: true });
    let latest = 0;

    if (glob === '*.jsonl') {
      for (const item of items) {
        if (item.isFile() && item.name.endsWith('.jsonl')) {
          const mtime = fs.statSync(path.join(dir, item.name)).mtimeMs;
          if (mtime > latest) latest = mtime;
        }
      }
    } else if (glob === 'history.jsonl') {
      const p = path.join(dir, 'history.jsonl');
      if (fs.existsSync(p)) {
        latest = fs.statSync(p).mtimeMs;
      }
    } else if (glob === '**/storage/*') {
      // Simple one-level deep scan for MVP
      const projectDir = path.join(dir, 'project');
      if (fs.existsSync(projectDir)) {
        for (const proj of fs.readdirSync(projectDir)) {
          const storageDir = path.join(projectDir, proj, 'storage');
          if (fs.existsSync(storageDir)) {
            for (const f of fs.readdirSync(storageDir)) {
              const fp = path.join(storageDir, f);
              const mtime = fs.statSync(fp).mtimeMs;
              if (mtime > latest) latest = mtime;
            }
          }
        }
      }
    }

    return latest;
  } catch {
    return 0;
  }
}

/**
 * 状态判定策略：
 * 1. 进程存在 = 首要信号 → 绿
 * 2. 进程存在 + 最近有 session 文件写入 → '进行中'（正在做事）
 * 3. 进程存在 + session 文件有一阵子没更新 → '等待确认'（可能在等输入）
 * 4. 进程存在 + 完全找不到 session 文件 → '运行中'（无法判断，默认为正常）
 * 5. 进程消失 → '已停止'
 */
function determineState(agent, now) {
  const processAlive = agent.pids && agent.pids.length > 0;

  if (!processAlive) {
    return { state: 'stopped', label: '已停止', emoji: '⚪' };
  }

  // 进程存在 = 最低限度认为在运行
  // 如果能找到 session 文件 mtime，再用它判断是否活跃
  if (agent.lastEventTime === 0 || agent.lastEventTime == null) {
    return { state: 'running', label: '运行中', emoji: '🟢' };
  }

  const age = now - agent.lastEventTime;

  if (age < WAIT_THRESHOLD_MS) {
    return { state: 'running', label: '进行中', emoji: '🟢' };
  } else if (age < STALE_THRESHOLD_MS) {
    return { state: 'waiting', label: '等待确认', emoji: '🟡' };
  } else {
    // 进程在跑但 session 文件很久没更新了——不一定是卡死，可能是没写新 session
    // 降低严重程度，显示为 '运行中 (空闲)'
    return { state: 'running', label: '运行中', emoji: '🟢' };
  }
}

function getPidAge(pid) {
  try {
    // macOS: ps -o etime= returns format [[DD-]hh:]mm:ss
    const out = execSync(`ps -o etime= -p ${pid} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!out) return 0;
    const parts = out.split('-');
    let days = 0, timeStr = parts[0];
    if (parts.length > 1) { days = parseInt(parts[0]); timeStr = parts[1]; }
    const [h, m, s] = timeStr.split(':').map(Number);
    return days * 86400 + (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
  } catch {
    return 0;
  }
}

// ============================================================
// Main loop
// ============================================================

function poll() {
  const now = Date.now();
  const agents = [];

  for (const agent of AGENTS) {
    const pids = findProcess(agent.process);
    const mtime = getLatestMtime(agent.sessionDir, agent.sessionGlob);

    agent.pids = pids;
    agent.lastEventTime = mtime;

    const status = determineState(agent, now);
    const pidAge = pids ? Math.min(...pids.map(p => getPidAge(p))) : 0;

    agents.push({
      name: agent.name,
      pids: pids || [],
      uptime_sec: pidAge,
      last_activity_ms_ago: pids ? (now - mtime) : null,
      ...status,
    });
  }

  // Count how many agents are active
  const activeCount = agents.filter(a => a.state === 'running').length;
  const waitingCount = agents.filter(a => a.state === 'waiting').length;

  // Build summary
  const anyActive = agents.some(a => a.state === 'running');
  const anyWaiting = agents.some(a => a.state === 'waiting');
  
  let summaryEmoji = '⚪';
  let summaryLabel = '无活动';
  if (anyActive || anyWaiting) {
    const parts = [];
    const runCount = agents.filter(a => a.state === 'running').length;
    const waitCount = agents.filter(a => a.state === 'waiting').length;
    if (runCount > 0) parts.push(`${runCount}个运行`);
    if (waitCount > 0) parts.push(`${waitCount}个等待`);
    summaryLabel = parts.join(' · ');
    summaryEmoji = waitCount > 0 ? '🟡' : '🟢';
  }

  const output = {
    timestamp: new Date().toISOString(),
    summary: `${summaryEmoji} ${summaryLabel}`,
    detail: agents.map(a =>
      `${a.emoji} ${a.name}: ${a.label}${a.pids.length ? ` (PID ${a.pids.join(',')})` : ''}`
    ),
    agents,
  };

  // │ 通知检测：等待确认 → 发送通知 │
  // └────────────────────────────────┘
  for (const agent of agents) {
    const tracker = AGENT_TRACKER[agent.name] || { previousState: 'stopped', notifiedAt: null };

    if (agent.state === 'waiting' && tracker.previousState !== 'waiting') {
      // 状态变更为 waiting，检查冷却时间
      const now = Date.now();
      if (!tracker.notifiedAt || (now - tracker.notifiedAt) > NOTIFICATION_COOLDOWN_MS) {
        sendNotification(agent.name, agent.label);
        tracker.notifiedAt = now;
      }
    }

    tracker.previousState = agent.state;
    AGENT_TRACKER[agent.name] = tracker;
  }

  fs.writeFileSync(STATUS_FILE, JSON.stringify(output, null, 2));
}

// ============================================================
// Start
// ============================================================

console.log('agent-monitor started — polling every', POLL_MS / 1000, 's');
console.log('writing to', STATUS_FILE);

poll(); // immediate first poll
setInterval(poll, POLL_MS);
