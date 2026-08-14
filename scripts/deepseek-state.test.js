'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SESSION_DECODE_COOLDOWN_MS,
  buildZstdTailCommand,
  encodeProjectKey,
  findLatestSessionFile,
  getDeepSeekContextUsage,
  getDeepSeekModel,
  getDeepSeekRuntimeForCwd,
  getDeepSeekSessionSignals,
  parseSessionSignals,
  readFileTail,
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

test('builds a zstd tail pipeline that quotes the session path', () => {
  const command = buildZstdTailCommand('/usr/local/bin/zstd', '/tmp/a b/session.jsonl.zstd');
  assert.match(command, /^\/usr\/local\/bin\/zstd -dc '\/tmp\/a b\/session\.jsonl\.zstd' \| \/usr\/bin\/tail -c 262144$/);
});

test('reads only the tail of a plain-text session file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-tail-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.jsonl');
  const marker = 'HEAD-MARKER-';
  const head = `${marker}${'x'.repeat(500_000)}`;
  const tail = JSON.stringify({
    type: 'assistant/message',
    data: { message: { source: { model: 'tail-model' } } },
  });
  fs.writeFileSync(file, `${head}\n${tail}`);

  const read = readFileTail(file, 256 * 1024);
  assert.ok(read.length <= 256 * 1024);
  assert.ok(read.includes('tail-model'));
  assert.ok(!read.includes(marker));
});

test('extracts model and pending approvals from session log text', () => {
  const signals = parseSessionSignals([
    JSON.stringify({ type: 'approval/asked', data: { id: 'approval-9' } }),
    JSON.stringify({ type: 'assistant/message', data: { message: { source: { model: 'deepseek-v4-pro' } } } }),
  ].join('\n'));
  assert.equal(signals.model, 'deepseek-v4-pro');
  assert.equal(signals.pendingKind, 'approval');
});

test('extracts pending user input from an unanswered ask_user_question call', () => {
  const signals = parseSessionSignals(JSON.stringify({
    type: 'tool/call',
    data: { turn: 1, step: 3, callId: 'call_ask_9', name: 'ask_user_question', arguments: '{}' },
  }));
  assert.equal(signals.pendingKind, 'user_input');
});

test('clears pending user input once the user answers the question', () => {
  const signals = parseSessionSignals([
    JSON.stringify({ type: 'tool/call', data: { turn: 1, step: 3, callId: 'call_ask_9', name: 'ask_user_question', arguments: '{}' } }),
    JSON.stringify({ type: 'tool/result', data: { turn: 1, step: 3, message: { source: { kind: 'tool', callId: 'call_ask_9' } } } }),
  ].join('\n'));
  assert.equal(signals.pendingKind, null);
});

test('prefers user-input waits over approval waits in session signals', () => {
  const signals = parseSessionSignals([
    JSON.stringify({ type: 'approval/asked', data: { id: 'approval-1' } }),
    JSON.stringify({ type: 'tool/call', data: { callId: 'call_ask_1', name: 'ask_user_question', arguments: '{}' } }),
  ].join('\n'));
  assert.equal(signals.pendingKind, 'user_input');
});

test('classifies an unanswered ask_user_question as waiting for user reply, not working', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-user-input-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = '/Users/me/code/demo-app';
  writeSession(root, cwd, 'session-a', 2000);
  // 等待期间 step 仍 open，正是导致误判 working 的场景
  writeProjectionCache(root, {
    'session-a': {
      rows: {
        sessionStats: {
          val: { openStep: { turn: 1, step: 3 }, pendingCalls: {} },
        },
      },
    },
  }, 2500);
  const stdout = JSON.stringify({
    type: 'tool/call',
    data: { turn: 1, step: 3, callId: 'call_ask_1', name: 'ask_user_question', arguments: '{"questions":[]}' },
  });

  const runtime = getDeepSeekRuntimeForCwd(cwd, {
    dshHome: root,
    now: 3000,
    run: () => ({ status: 0, stdout }),
  });
  assert.equal(runtime.state, 'waiting_reply');
});

test('does not keep DeepSeek waiting after the user answers the question', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-user-input-resolved-test-'));
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
    JSON.stringify({ type: 'tool/call', data: { turn: 1, step: 3, callId: 'call_ask_1', name: 'ask_user_question', arguments: '{}' } }),
    JSON.stringify({ type: 'tool/result', data: { turn: 1, step: 3, message: { source: { kind: 'tool', callId: 'call_ask_1' } } } }),
  ].join('\n');

  const runtime = getDeepSeekRuntimeForCwd(cwd, {
    dshHome: root,
    now: 3000,
    run: () => ({ status: 0, stdout }),
  });
  assert.equal(runtime.state, 'ready');
});

test('reuses cached session signals while the file is unchanged', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-cache-hit-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.jsonl.zstd');
  fs.writeFileSync(file, 'compressed-placeholder');
  const stdout = JSON.stringify({
    type: 'assistant/message',
    data: { message: { source: { model: 'cached-model' } } },
  });
  let calls = 0;
  const run = () => { calls += 1; return { status: 0, stdout }; };

  assert.equal(getDeepSeekSessionSignals(file, run, { now: 1000 }).model, 'cached-model');
  assert.equal(getDeepSeekSessionSignals(file, run, { now: 3000 }).model, 'cached-model');
  assert.equal(calls, 1);
});

test('skips re-decoding while the session file changes within the cooldown window', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-cooldown-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.jsonl.zstd');
  fs.writeFileSync(file, 'compressed-placeholder-v1');
  const runV1 = () => ({ status: 0, stdout: JSON.stringify({
    type: 'assistant/message',
    data: { message: { source: { model: 'model-v1' } } },
  }) });

  const t0 = 1000;
  // 首次解码
  assert.equal(getDeepSeekSessionSignals(file, runV1, { now: t0 }).model, 'model-v1');
  // 文件变化但仍在冷却窗口内 → 沿用缓存，不重新解压
  fs.writeFileSync(file, 'compressed-placeholder-v2');
  assert.equal(
    getDeepSeekSessionSignals(file, runV1, { now: t0 + SESSION_DECODE_COOLDOWN_MS - 1 }).model,
    'model-v1'
  );
  // 超过冷却窗口 → 重新解压得到最新信号
  const runV2 = () => ({ status: 0, stdout: JSON.stringify({
    type: 'assistant/message',
    data: { message: { source: { model: 'model-v2' } } },
  }) });
  assert.equal(
    getDeepSeekSessionSignals(file, runV2, { now: t0 + SESSION_DECODE_COOLDOWN_MS + 1 }).model,
    'model-v2'
  );
});

test('falls back to cached signals when the session file is temporarily unreadable', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-dsh-unreadable-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.jsonl.zstd');
  fs.writeFileSync(file, 'compressed-placeholder');
  const stdout = JSON.stringify({
    type: 'assistant/message',
    data: { message: { source: { model: 'persisted-model' } } },
  });

  assert.equal(getDeepSeekSessionSignals(file, () => ({ status: 0, stdout }), { now: 1000 }).model, 'persisted-model');
  fs.rmSync(file);
  assert.equal(getDeepSeekSessionSignals(file, () => ({ status: 0, stdout }), { now: 2000 }).model, 'persisted-model');
});
