'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  encodePiProjectKey,
  findLatestPiSessionFile,
  getPiRuntimeForCwd,
  parsePiSessionSignals,
} = require('./pi-state');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-pi-'));
}

test('encodes Pi session directories from a project cwd', () => {
  assert.equal(encodePiProjectKey('/Users/alice/code/demo'), '--Users-alice-code-demo--');
});

test('selects the latest Pi session for a project', t => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = '/project/demo';
  const dir = path.join(root, encodePiProjectKey(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const older = path.join(dir, 'older.jsonl');
  const newer = path.join(dir, 'newer.jsonl');
  fs.writeFileSync(older, '{}\n');
  fs.writeFileSync(newer, '{}\n');
  fs.utimesSync(older, new Date(1_000), new Date(1_000));
  fs.utimesSync(newer, new Date(2_000), new Date(2_000));

  assert.equal(findLatestPiSessionFile(cwd, root), newer);
});

test('derives Pi working state and model from unresolved tool calls', () => {
  const signals = parsePiSessionSignals([
    JSON.stringify({ type: 'message', message: {
      role: 'assistant', provider: 'openai', model: 'gpt-5', stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'call_1', name: 'bash', arguments: {} }],
    } }),
  ].join('\n'), { modelsFile: path.join(tempDir(), 'missing-models.json') });

  assert.deepEqual(signals, {
    model: 'openai/gpt-5', taskState: 'working', replyRequested: false, contextUsage: null,
  });
});

test('marks Pi ready after its final completed assistant turn', () => {
  const signals = parsePiSessionSignals([
    JSON.stringify({ type: 'message', message: {
      role: 'assistant', provider: 'anthropic', model: 'claude-sonnet', stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'call_1', name: 'read', arguments: {} }],
    } }),
    JSON.stringify({ type: 'message', message: { role: 'toolResult', toolCallId: 'call_1' } }),
    JSON.stringify({ type: 'message', message: {
      role: 'assistant', provider: 'anthropic', model: 'claude-sonnet', stopReason: 'stop', content: [],
    } }),
  ].join('\n'));

  assert.deepEqual(signals, {
    model: 'anthropic/claude-sonnet', taskState: 'ready', replyRequested: false, contextUsage: null,
  });
});

test('reads Pi context usage from assistant usage and model contextWindow', t => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modelsFile = path.join(root, 'models.json');
  fs.writeFileSync(modelsFile, JSON.stringify({ providers: {
    openai: { models: [{ id: 'gpt-5', contextWindow: 10000 }] },
  } }));
  const signals = parsePiSessionSignals(JSON.stringify({ type: 'message', message: {
    role: 'assistant', provider: 'openai', model: 'gpt-5', stopReason: 'stop',
    usage: { input: 1800, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 2000 },
    content: [{ type: 'text', text: 'Done.' }],
  } }), { modelsFile });

  assert.deepEqual(signals.contextUsage, {
    used_tokens: 2000, window_tokens: 10000, percent: 20,
  });
});

test('returns unknown Pi context tokens immediately after compaction', t => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modelsFile = path.join(root, 'models.json');
  fs.writeFileSync(modelsFile, JSON.stringify({ providers: {
    openai: { models: [{ id: 'gpt-5', contextWindow: 10000 }] },
  } }));
  const signals = parsePiSessionSignals([
    JSON.stringify({ type: 'compaction', summary: 'old context' }),
    JSON.stringify({ type: 'message', message: {
      role: 'assistant', provider: 'openai', model: 'gpt-5', stopReason: 'stop', content: [],
    } }),
  ].join('\n'), { modelsFile });

  assert.deepEqual(signals.contextUsage, {
    used_tokens: null, window_tokens: 10000, percent: null,
  });
});

test('marks a completed Pi question as waiting for reply', () => {
  const signals = parsePiSessionSignals(JSON.stringify({ type: 'message', message: {
    role: 'assistant', provider: 'openai', model: 'gpt-5', stopReason: 'stop',
    content: [{ type: 'text', text: 'Should I continue?' }],
  } }));

  assert.deepEqual(signals, {
    model: 'openai/gpt-5', taskState: 'ready', replyRequested: true, contextUsage: null,
  });
});

test('returns the runtime state for a persisted Pi session', t => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = '/project/demo';
  const dir = path.join(root, encodePiProjectKey(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const session = path.join(dir, 'session.jsonl');
  fs.writeFileSync(session, JSON.stringify({ type: 'message', message: {
    role: 'assistant', provider: 'openai', model: 'gpt-5', stopReason: 'stop', content: [],
  } }) + '\n');

  const runtime = getPiRuntimeForCwd(cwd, { sessionDir: root });
  assert.equal(runtime.sessionFile, session);
  assert.equal(runtime.state, 'ready');
  assert.equal(runtime.model, 'openai/gpt-5');
  assert.ok(runtime.lastActivityMs > 0);
});
