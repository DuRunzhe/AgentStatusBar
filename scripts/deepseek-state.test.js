'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  encodeProjectKey,
  findLatestSessionFile,
  getDeepSeekContextUsage,
  getDeepSeekModel,
  getDeepSeekRuntimeForCwd,
  getDeepSeekSessionSignals,
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

  const runtime = getDeepSeekRuntimeForCwd(cwd, { dshHome: root, now: 3000 });
  assert.equal(runtime.state, 'working');
  assert.equal(runtime.lastActivityMs, 2000);
  assert.equal(runtime.sessionFile, sessionFile);
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

test('classifies DeepSeek runtime as waiting when approval is unresolved', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-approval-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = '/Users/me/code/demo-app';
  const sessionFile = writeSession(root, cwd, 'session-a', 2000);
  writeProjectionCache(root, {
    'session-a': {
      rows: {
        sessionStats: {
          val: { openStep: null, pendingCalls: { call_1: 1900 } },
        },
      },
    },
  }, 2500);
  const stdout = JSON.stringify({
    type: 'approval/asked',
    data: { id: 'approval-1', toolName: 'bash', callId: 'call_1' },
  });

  const run = () => ({ status: 0, stdout });
  assert.equal(getDeepSeekSessionSignals(sessionFile, run).pendingKind, 'approval');
  assert.equal(getDeepSeekRuntimeForCwd(cwd, { dshHome: root, now: 3000, run }).state, 'waiting');
});

test('does not keep DeepSeek runtime waiting after approval is decided', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-approval-resolved-test-'));
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
  const stdout = [
    JSON.stringify({
      type: 'approval/asked',
      data: { id: 'approval-1', toolName: 'bash', callId: 'call_1' },
    }),
    JSON.stringify({
      type: 'approval/decided',
      data: { id: 'approval-1', outcome: 'allowed-once' },
    }),
  ].join('\n');

  const runtime = getDeepSeekRuntimeForCwd(cwd, {
    dshHome: root,
    now: 3000,
    run: () => ({ status: 0, stdout }),
  });
  assert.equal(runtime.state, 'ready');
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

test('reads DeepSeek context usage from projection cache pressure data', () => {
  assert.deepEqual(getDeepSeekContextUsage({
    contextPressure: {
      pressureTokens: 250000,
      contextWindow: 1000000,
    },
  }), {
    used_tokens: 250000,
    window_tokens: 1000000,
    percent: 25,
  });
});

test('uses surface tokens as DeepSeek context fallback', () => {
  assert.deepEqual(getDeepSeekContextUsage({
    contextPressure: {
      surfaceTokens: 125000,
      contextWindow: 500000,
    },
  }), {
    used_tokens: 125000,
    window_tokens: 500000,
    percent: 25,
  });
});

test('reads the latest DeepSeek assistant model from session log text', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-model-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.jsonl.zstd');
  fs.writeFileSync(file, 'compressed-placeholder');
  const stdout = [
    JSON.stringify({
      type: 'assistant/message',
      data: { message: { source: { model: 'deepseek-v4-flash' } } },
    }),
    JSON.stringify({
      type: 'assistant/message',
      data: { message: { source: { model: 'deepseek-v4-pro' } } },
    }),
  ].join('\n');

  assert.equal(getDeepSeekModel(file, () => ({ status: 0, stdout })), 'deepseek-v4-pro');
});

test('returns DeepSeek model and context usage in runtime data', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-runtime-display-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = '/Users/me/code/demo-app';
  writeSession(root, cwd, 'session-a', 2000);
  writeProjectionCache(root, {
    'session-a': {
      rows: {
        sessionStats: {
          val: { openStep: null, pendingCalls: {} },
        },
        contextPressure: {
          val: { pressureTokens: 200000, contextWindow: 1000000 },
        },
      },
    },
  }, 2500);
  const stdout = JSON.stringify({
    type: 'assistant/message',
    data: { message: { source: { model: 'deepseek-v4-pro' } } },
  });

  const runtime = getDeepSeekRuntimeForCwd(cwd, {
    dshHome: root,
    now: 3000,
    run: () => ({ status: 0, stdout }),
  });
  assert.equal(runtime.model, 'deepseek-v4-pro');
  assert.deepEqual(runtime.contextUsage, {
    used_tokens: 200000,
    window_tokens: 1000000,
    percent: 20,
  });
});
