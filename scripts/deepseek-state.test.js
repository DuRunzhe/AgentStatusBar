'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  encodeProjectKey,
  findLatestSessionFile,
  getDeepSeekRuntimeForCwd,
} = require('./deepseek-state');

function writeSession(root, cwd, sessionId, mtimeMs) {
  const file = path.join(root, 'sessions', encodeProjectKey(cwd), sessionId, 'session.jsonl.zstd');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'compressed-placeholder');
  fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  return file;
}

function writeProjectionCache(root, sessions, mtimeMs) {
  const file = path.join(root, 'storages', 'session_projcache.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    unit: { name: 'session_projcache', version: 3 },
    global: null,
    tables: { sessions },
  }));
  fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
}

test('maps DeepSeek cwd to the readable session project key', () => {
  assert.equal(
    encodeProjectKey('/Users/me/code/demo-app'),
    '--Users-me-code-demo-app--'
  );
});

test('finds the latest DeepSeek session file for a cwd', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-session-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = '/Users/me/code/demo-app';
  writeSession(root, cwd, 'older', 1000);
  const latest = writeSession(root, cwd, 'newer', 2000);

  assert.equal(findLatestSessionFile(cwd, root), latest);
});

test('falls back to the latest DeepSeek session across projects', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-global-session-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeSession(root, '/Users/me/code/other-app', 'older', 1000);
  const latest = writeSession(root, '/Users/me/code/current-web-workspace', 'newer', 2000);

  assert.equal(findLatestSessionFile('/Users/me/code/process-start-dir', root), latest);
});

test('classifies DeepSeek runtime as working when a step is open', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-working-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = '/Users/me/code/demo-app';
  const sessionFile = writeSession(root, cwd, 'session-a', 2000);
  writeProjectionCache(root, {
    'session-a': {
      rows: {
        sessionStats: {
          val: { openStep: { turn: 1, step: 2 }, pendingCalls: {} },
        },
      },
    },
  }, 2000);

  assert.deepEqual(getDeepSeekRuntimeForCwd(cwd, { dshHome: root, now: 3000 }), {
    state: 'working',
    lastActivityMs: 2000,
    sessionFile,
  });
});

test('classifies DeepSeek runtime as working when tool calls are pending', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-pending-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = '/Users/me/code/demo-app';
  writeSession(root, cwd, 'session-a', 2000);
  writeProjectionCache(root, {
    'session-a': {
      rows: {
        sessionStats: {
          val: { openStep: null, pendingCalls: { call_1: 1900 } },
        },
      },
    },
  }, 2000);

  assert.equal(getDeepSeekRuntimeForCwd(cwd, { dshHome: root, now: 3000 }).state, 'working');
});

test('classifies DeepSeek runtime as ready when projection cache is current', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-ready-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = '/Users/me/code/demo-app';
  writeSession(root, cwd, 'session-a', 2000);
  writeProjectionCache(root, {
    'session-a': {
      rows: {
        sessionStats: {
          val: { openStep: null, pendingCalls: {} },
        },
      },
    },
  }, 2500);

  assert.equal(getDeepSeekRuntimeForCwd(cwd, { dshHome: root, now: 3000 }).state, 'ready');
});

test('leaves DeepSeek runtime unresolved when projection cache is behind the log', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-stale-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = '/Users/me/code/demo-app';
  writeSession(root, cwd, 'session-a', 4000);
  writeProjectionCache(root, {
    'session-a': {
      rows: {
        sessionStats: {
          val: { openStep: null, pendingCalls: {} },
        },
      },
    },
  }, 1000);

  assert.equal(getDeepSeekRuntimeForCwd(cwd, { dshHome: root, now: 5000 }).state, null);
  assert.equal(getDeepSeekRuntimeForCwd(cwd, { dshHome: root, now: 5000 }).lastActivityMs, 4000);
});
