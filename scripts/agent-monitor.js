#!/usr/bin/env node
/**
 * agent-monitor.js — AI Coding Agent 状态监控守护进程
 *
 * 检测 Claude Code / Codex CLI / OpenCode 的运行状态，
 * 支持每个 agent 的多个会话（实例）独立追踪。
 * 写入 /tmp/agent-status.json 供 SwiftBar 插件显示。
 * 进入 🟡 等待确认 状态时自动发送 macOS 原生通知。
 *
 * 状态定义：
 *   🟢 running       — 进程存活，session 文件近期有活动
 *   🟡 waiting       — 进程存活，但 >30s 无 session 活动（等待用户确认/输入）
 *   🟠 stale         — 进程存活，>120s 无活动（可能卡死/丢失）
 *   ⚪ stopped       — 进程已退出
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================
// Configuration
// ============================================================
const STATUS_FILE = '/tmp/agent-status.json';
const POLL_MS = 2000;               // 轮询间隔
const WAIT_THRESHOLD_MS = 30000;    // 30s 无活动 → waiting
const STALE_THRESHOLD_MS = 120000;  // 120s 无活动 → stale
const NOTIFICATION_COOLDOWN_MS = 3000; // 同一实例通知冷却（3 秒）

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
    sessionDir: path.join(process.env.HOME, '.codex'),
    sessionGlob: 'history.jsonl',
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

/** @type {Object<string, { previousState: string, notifiedAt: number|null }>} */
const INSTANCE_TRACKER = {};

// ============================================================
// Helpers
// ============================================================

/**
 * 发送 macOS 原生通知
 * @param {string} agentName
 * @param {string} instanceLabel
 */
function sendNotification(agentName, instanceLabel) {
  const msg = `${agentName} (${instanceLabel}) 已进入 🟡 等待确认`;
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
    return out.split('\n').map(s => parseInt(s));
  } catch {
    return null;
  }
}

/**
 * 通过 lsof 查找指定 PID 打开的 session 文件路径。
 * 返回 null 表示无法确定。
 */
function getSessionFileForPid(pid, agentDef) {
  try {
    const out = execSync(`lsof -Fn -p ${pid} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    });
    const files = out.split('\n')
      .filter(l => l.startsWith('n'))
      .map(l => l.slice(1));

    if (agentDef.name === 'Claude') {
      const transcripts = path.join(process.env.HOME, '.claude', 'transcripts');
      return files.find(f => f.endsWith('.jsonl') && f.startsWith(transcripts)) || null;
    }
    if (agentDef.name === 'Codex') {
      const historyFile = path.join(agentDef.sessionDir, 'history.jsonl');
      return files.find(f => f === historyFile) || null;
    }
    if (agentDef.name === 'OpenCode') {
      return files.find(f =>
        f.includes(path.sep + 'storage' + path.sep) &&
        f.includes(path.sep + 'opencode' + path.sep)
      ) || null;
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
 *   🔵 working  — 有子进程在跑 → 正在做事（最准确的信号）
 *                  无子进程但 session 近期有写入 → 刚结束任务不久
 *   🟢 ready    — 无子进程 + session 已空闲较长时间 → 就绪，可以下达新任务
 *   🟡 waiting  — 无子进程 + session 暂停片刻 → 在等你确认/回复
 *   ⚪ stopped  — 进程已退出
 *
 * 判定策略：子进程检测优先（pgrep -P），辅以 session 文件 mtime 时间窗
 */
function determineState(pids, lastEventTimeMs, now) {
  const alive = pids && pids.length > 0;
  if (!alive) return { state: 'stopped', label: '已停止', emoji: '⚪' };

  // 一级信号：是否有子进程（agent 做事时必定 spawn 子进程）
  for (const pid of pids) {
    if (hasChildProcesses(pid)) return { state: 'working', label: '进行中', emoji: '🔵' };
  }

  // 无子进程 → agent 空闲。用 mtime 时间窗区分
  if (!lastEventTimeMs) return { state: 'ready', label: '可交互', emoji: '🟢' };

  const age = now - lastEventTimeMs;
  if (age < WAIT_THRESHOLD_MS) return { state: 'working', label: '进行中', emoji: '🔵' };
  if (age < STALE_THRESHOLD_MS) return { state: 'waiting', label: '等待确认', emoji: '🟡' };
  return { state: 'ready', label: '可交互', emoji: '🟢' };
}

function getPidAge(pid) {
  try {
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

function formatUptime(sec) {
  if (sec <= 0) return '';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h${m}m`;
}

/**
 * 检查 PID 是否有活跃子进程（agent 做事时必定有）
 */
function hasChildProcesses(pid) {
  try {
    const out = execSync(`pgrep -P ${pid} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 2000,
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

/**
 * 获取进程的工作目录（项目根路径）
 */
function getProcessCwd(pid) {
  try {
    const out = execSync(`lsof -d cwd -Fn -p ${pid} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    });
    const cwdLine = out.split('\n').find(l => l.startsWith('n'));
    if (cwdLine) return cwdLine.slice(1);
  } catch {}
  return null;
}

function formatLastActivity(ms) {
  if (ms == null) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `最后活动 ${sec}s 前`;
  return `最后活动 ${Math.floor(sec / 60)}m 前`;
}

// ============================================================
// 核心：获取每个 agent 的实例列表
// ============================================================

function getInstances(agentDef) {
  const pids = findProcess(agentDef.process);
  const now = Date.now();

  // 无进程 → ⚪ 已停止
  if (!pids || pids.length === 0) {
    return [{
      ...determineState(null, 0, now),
      label: agentDef.name,
      pids: [],
      uptime_sec: 0,
      last_activity_ms_ago: null,
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
    const pidAge = Math.min(...group.pids.map(p => getPidAge(p)));
    // 提取项目名：从第一个 PID 的 CWD 取最后一段路径
    let projectLabel = agentDef.name;
    const firstPid = group.pids[0];
    const cwd = firstPid ? getProcessCwd(firstPid) : null;
    if (cwd && keys.length > 1) {
      const projectName = path.basename(cwd);
      projectLabel = `${agentDef.name} (${projectName})`;
    } else if (keys.length > 1) {
      projectLabel = `${agentDef.name} #${idx}`;
    }

    return {
      ...determineState(group.pids, mtime, now),
      label: projectLabel,
      pids: group.pids,
      uptime_sec: pidAge,
      last_activity_ms_ago: group.pids.length > 0 && mtime > 0 ? (now - mtime) : null,
    };
  });
}

// ============================================================
// Main loop
// ============================================================

function poll() {
  const now = Date.now();
  const agents = [];

  for (const agentDef of AGENTS) {
    agents.push({
      name: agentDef.name,
      instances: getInstances(agentDef),
    });
  }

  // ── 汇总数量 ──
  const allWorking = agents.flatMap(a => a.instances).filter(i => i.state === 'working');
  const allReady = agents.flatMap(a => a.instances).filter(i => i.state === 'ready');
  const allWaiting = agents.flatMap(a => a.instances).filter(i => i.state === 'waiting');

  let summaryEmoji = '⚪', summaryLabel = '无活动';
  if (allWorking.length > 0 || allReady.length > 0 || allWaiting.length > 0) {
    const parts = [];
    if (allWorking.length > 0) parts.push(`🔵${allWorking.length}个进行`);
    if (allReady.length > 0) parts.push(`🟢${allReady.length}个就绪`);
    if (allWaiting.length > 0) parts.push(`🟡${allWaiting.length}个等待`);
    summaryLabel = parts.join(' · ');
    summaryEmoji = allWaiting.length > 0 ? '🟡' : (allWorking.length > 0 ? '🔵' : '🟢');
  }

  // ── 详情行 ──
  const details = [];
  for (const agent of agents) {
    for (const inst of agent.instances) {
      let line = `${inst.emoji} ${inst.label}: ${inst.label}`;
      if (inst.pids.length > 0) {
        line += ` (PID ${inst.pids.join(',')}`;
        const uptime = formatUptime(inst.uptime_sec);
        if (uptime) line += `, ${uptime}`;
        line += ')';
      }
      if (inst.last_activity_ms_ago != null && inst.state === 'waiting') {
        line += ` ${formatLastActivity(inst.last_activity_ms_ago)}`;
      } else if (inst.last_activity_ms_ago != null && inst.state === 'ready') {
        line += ` ${formatLastActivity(inst.last_activity_ms_ago)}`;
      }
      details.push(line);
    }
  }

  // ── 通知检测（按实例 key） ──
  for (const agent of agents) {
    for (const inst of agent.instances) {
      const key = `${agent.name}:${inst.label}`;
      const tracker = INSTANCE_TRACKER[key] || { previousState: 'stopped', notifiedAt: null };

      if (inst.state === 'waiting' && tracker.previousState !== 'waiting') {
        if (!tracker.notifiedAt || (now - tracker.notifiedAt) > NOTIFICATION_COOLDOWN_MS) {
          sendNotification(agent.name, inst.label);
          tracker.notifiedAt = now;
        }
      }

      tracker.previousState = inst.state;
      INSTANCE_TRACKER[key] = tracker;
    }
  }

  // ── 输出 JSON ──
  const output = {
    timestamp: new Date().toISOString(),
    summary: `${summaryEmoji} ${summaryLabel}`,
    detail: details,
    agents,
    multiSession: true,
  };

  fs.writeFileSync(STATUS_FILE, JSON.stringify(output, null, 2));
}

// ============================================================
// Start
// ============================================================

console.log('agent-monitor started — polling every', POLL_MS / 1000, 's');
console.log('writing to', STATUS_FILE);
console.log('multi-session tracking enabled');

poll();
setInterval(poll, POLL_MS);
