#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_DSH_HOME = path.join(os.homedir(), '.dsh');
const SESSION_SIGNAL_CACHE = new Map();
const ZSTD_COMMANDS = [
  'zstd',
  '/opt/homebrew/bin/zstd',
  '/usr/local/bin/zstd',
];
// 只保留 session 文件尾部做解析，限制内存与 JSON 解析成本
const SESSION_TAIL_BYTES = 256 * 1024;
const SESSION_TAIL_LINES = 500;
// 活跃流式期间 session 文件每秒都在变，冷却窗口内不重新解压，
// 模型/审批信号几秒的延迟对状态栏可接受，换取大幅降低 CPU 开销
const SESSION_DECODE_COOLDOWN_MS = 2000;

function encodeProjectKey(cwd) {
  if (!cwd) return '_no-cwd';
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

function findLatestSessionFile(cwd, dshHome = DEFAULT_DSH_HOME) {
  const projectDir = path.join(dshHome, 'sessions', encodeProjectKey(cwd));
  try {
    const file = fs.readdirSync(projectDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(entry => [
        path.join(projectDir, entry.name, 'session.jsonl.zstd'),
        path.join(projectDir, entry.name, 'session.jsonl'),
      ])
      .filter(file => fs.existsSync(file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
    if (file) return file;
  } catch {
    return findLatestSessionFileAcrossProjects(dshHome);
  }
  return findLatestSessionFileAcrossProjects(dshHome);
}

function findLatestSessionFileAcrossProjects(dshHome = DEFAULT_DSH_HOME) {
  const sessionsRoot = path.join(dshHome, 'sessions');
  try {
    return fs.readdirSync(sessionsRoot, { withFileTypes: true })
      .filter(project => project.isDirectory())
      .flatMap(project => {
        const projectDir = path.join(sessionsRoot, project.name);
        return fs.readdirSync(projectDir, { withFileTypes: true })
          .filter(session => session.isDirectory())
          .flatMap(session => [
            path.join(projectDir, session.name, 'session.jsonl.zstd'),
            path.join(projectDir, session.name, 'session.jsonl'),
          ]);
      })
      .filter(file => fs.existsSync(file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  } catch {
    return null;
  }
}

function getSessionIdFromFile(sessionFile) {
  return path.basename(path.dirname(sessionFile || '')) || null;
}

function readProjectionStats(sessionId, dshHome = DEFAULT_DSH_HOME) {
  if (!sessionId) return null;
  try {
    const cacheFile = path.join(dshHome, 'storages', 'session_projcache.json');
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const session = cache?.tables?.sessions?.[sessionId];
    const stats = session?.rows?.sessionStats?.val;
    if (!stats || typeof stats !== 'object') return null;
    return {
      cacheFile,
      openStep: stats.openStep ?? null,
      pendingCalls: stats.pendingCalls && typeof stats.pendingCalls === 'object'
        ? stats.pendingCalls
        : {},
      tokenUsage: session?.rows?.tokenUsage?.val || null,
      contextPressure: session?.rows?.contextPressure?.val || null,
    };
  } catch {
    return null;
  }
}

function getFileMtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function getDeepSeekContextUsage(stats) {
  const pressure = stats?.contextPressure;
  if (!pressure || typeof pressure !== 'object') return null;
  const usedTokens = Number(pressure.pressureTokens ?? pressure.surfaceTokens);
  const windowTokens = Number(pressure.contextWindow);
  if (!Number.isFinite(usedTokens) || usedTokens <= 0 ||
      !Number.isFinite(windowTokens) || windowTokens <= 0) {
    return null;
  }
  return {
    used_tokens: Math.round(usedTokens),
    window_tokens: Math.round(windowTokens),
    percent: Math.min(100, Math.max(0, usedTokens / windowTokens * 100)),
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function buildZstdTailCommand(command, sessionFile) {
  return `${command} -dc ${shellQuote(sessionFile)} | /usr/bin/tail -c ${SESSION_TAIL_BYTES}`;
}

function runZstdDecode(sessionFile, run) {
  for (const command of ZSTD_COMMANDS) {
    const result = run('/bin/sh', ['-c', buildZstdTailCommand(command, sessionFile)], {
      encoding: 'utf8',
      maxBuffer: SESSION_TAIL_BYTES * 4,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    if (result.status === 0) return result.stdout;
  }
  return '';
}

function readFileTail(file, maxBytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readDeepSeekSessionText(sessionFile, run = spawnSync) {
  if (!sessionFile) return '';
  try {
    if (sessionFile.endsWith('.jsonl')) return readFileTail(sessionFile, SESSION_TAIL_BYTES);
    if (!sessionFile.endsWith('.jsonl.zstd')) return '';
    return runZstdDecode(sessionFile, run);
  } catch {
    return '';
  }
}

function parseSessionSignals(text) {
  let model = null;
  const pendingApprovals = new Set();
  const lines = String(text || '').trim().split('\n').slice(-SESSION_TAIL_LINES);
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event?.type === 'approval/asked' && typeof event?.data?.id === 'string') {
        pendingApprovals.add(event.data.id);
      } else if (event?.type === 'approval/decided' && typeof event?.data?.id === 'string') {
        pendingApprovals.delete(event.data.id);
      }
      const candidate = event?.data?.message?.source?.model;
      if (event?.type === 'assistant/message' && typeof candidate === 'string' && candidate.trim()) {
        model = candidate.trim();
      }
    } catch {}
  }
  return { model, pendingKind: pendingApprovals.size > 0 ? 'approval' : null };
}

function getDeepSeekSessionSignals(sessionFile, run = spawnSync, { now = Date.now() } = {}) {
  try {
    const stat = fs.statSync(sessionFile);
    const cached = SESSION_SIGNAL_CACHE.get(sessionFile);

    // 文件未变化：直接复用缓存，避免无谓解压
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.signals;
    }

    // 文件在变但处于冷却窗口：沿用缓存，限制活跃流式期间的全量解压频率
    if (cached && now - cached.checkedAtMs < SESSION_DECODE_COOLDOWN_MS) {
      return cached.signals;
    }

    const signals = parseSessionSignals(readDeepSeekSessionText(sessionFile, run));
    SESSION_SIGNAL_CACHE.set(sessionFile, {
      checkedAtMs: now,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      signals,
    });
    return signals;
  } catch {
    // 文件瞬时不可读时沿用上次缓存，避免状态抖动
    return SESSION_SIGNAL_CACHE.get(sessionFile)?.signals || { model: null, pendingKind: null };
  }
}

function getDeepSeekModel(sessionFile, run = spawnSync) {
  return getDeepSeekSessionSignals(sessionFile, run).model;
}

function getDeepSeekRuntimeForCwd(cwd, {
  dshHome = DEFAULT_DSH_HOME,
  now = Date.now(),
  run = spawnSync,
} = {}) {
  const sessionFile = findLatestSessionFile(cwd, dshHome);
  if (!sessionFile) return { state: null, lastActivityMs: null, sessionFile: null };

  const lastActivityMs = getFileMtimeMs(sessionFile);
  const stats = readProjectionStats(getSessionIdFromFile(sessionFile), dshHome);
  const signals = getDeepSeekSessionSignals(sessionFile, run, { now });
  const baseRuntime = {
    lastActivityMs,
    sessionFile,
    model: signals.model,
    contextUsage: getDeepSeekContextUsage(stats),
  };
  if (!stats) return { state: null, ...baseRuntime };

  if (signals.pendingKind === 'approval') {
    return { state: 'waiting', ...baseRuntime };
  }

  const hasPendingCalls = Object.keys(stats.pendingCalls).length > 0;
  if (stats.openStep || hasPendingCalls) {
    return { state: 'working', ...baseRuntime };
  }

  const cacheMtimeMs = getFileMtimeMs(stats.cacheFile);
  if (cacheMtimeMs + 1000 >= lastActivityMs && cacheMtimeMs <= now + 1000) {
    return { state: 'ready', ...baseRuntime };
  }
  return { state: null, ...baseRuntime };
}

module.exports = {
  SESSION_DECODE_COOLDOWN_MS,
  buildZstdTailCommand,
  encodeProjectKey,
  findLatestSessionFile,
  findLatestSessionFileAcrossProjects,
  getDeepSeekContextUsage,
  getDeepSeekModel,
  getDeepSeekRuntimeForCwd,
  getDeepSeekSessionSignals,
  getSessionIdFromFile,
  parseSessionSignals,
  readFileTail,
  readProjectionStats,
  readDeepSeekSessionText,
  runZstdDecode,
};
