#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_DSH_HOME = path.join(os.homedir(), '.dsh');

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

function getDeepSeekRuntimeForCwd(cwd, {
  dshHome = DEFAULT_DSH_HOME,
  now = Date.now(),
} = {}) {
  const sessionFile = findLatestSessionFile(cwd, dshHome);
  if (!sessionFile) return { state: null, lastActivityMs: null, sessionFile: null };

  const lastActivityMs = getFileMtimeMs(sessionFile);
  const stats = readProjectionStats(getSessionIdFromFile(sessionFile), dshHome);
  if (!stats) return { state: null, lastActivityMs, sessionFile };

  const hasPendingCalls = Object.keys(stats.pendingCalls).length > 0;
  if (stats.openStep || hasPendingCalls) {
    return { state: 'working', lastActivityMs, sessionFile };
  }

  const cacheMtimeMs = getFileMtimeMs(stats.cacheFile);
  if (cacheMtimeMs + 1000 >= lastActivityMs && cacheMtimeMs <= now + 1000) {
    return { state: 'ready', lastActivityMs, sessionFile };
  }
  return { state: null, lastActivityMs, sessionFile };
}

module.exports = {
  encodeProjectKey,
  findLatestSessionFile,
  findLatestSessionFileAcrossProjects,
  getDeepSeekRuntimeForCwd,
  getSessionIdFromFile,
  readProjectionStats,
};
