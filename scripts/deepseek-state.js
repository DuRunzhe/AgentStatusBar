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

function runZstdDecode(sessionFile, run) {
  for (const command of ZSTD_COMMANDS) {
    const result = run(command, ['-dc', sessionFile], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    if (result.status === 0) return result.stdout;
  }
  return '';
}

function readDeepSeekSessionText(sessionFile, run = spawnSync) {
  if (!sessionFile) return '';
  try {
    if (sessionFile.endsWith('.jsonl')) return fs.readFileSync(sessionFile, 'utf8');
    if (!sessionFile.endsWith('.jsonl.zstd')) return '';
    return runZstdDecode(sessionFile, run);
  } catch {
    return '';
  }
}

function getDeepSeekSessionSignals(sessionFile, run = spawnSync) {
  try {
    const stat = fs.statSync(sessionFile);
    const cached = SESSION_SIGNAL_CACHE.get(sessionFile);
    if (cached?.mtimeMs === stat.mtimeMs && cached?.size === stat.size) return cached.signals;

    let model = null;
    const pendingApprovals = new Set();
    const lines = readDeepSeekSessionText(sessionFile, run).trim().split('\n').slice(-500);
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
    const signals = {
      model,
      pendingKind: pendingApprovals.size > 0 ? 'approval' : null,
    };
    SESSION_SIGNAL_CACHE.set(sessionFile, {
      checkedAtMs: Date.now(),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      signals,
    });
    return signals;
  } catch {
    return { model: null, pendingKind: null };
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
  const signals = getDeepSeekSessionSignals(sessionFile, run);
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
  encodeProjectKey,
  findLatestSessionFile,
  findLatestSessionFileAcrossProjects,
  getDeepSeekContextUsage,
  getDeepSeekModel,
  getDeepSeekRuntimeForCwd,
  getDeepSeekSessionSignals,
  getSessionIdFromFile,
  readProjectionStats,
  readDeepSeekSessionText,
  runZstdDecode,
};
