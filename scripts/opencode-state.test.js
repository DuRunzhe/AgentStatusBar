'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getModelName,
  getOpenCodeRuntimeForCwd,
  getStateFromMessage,
  parseOpenCodeRuntimeRows,
} = require('./opencode-state');

test('maps a completed OpenCode assistant response to ready', () => {
  assert.equal(getStateFromMessage(JSON.stringify({
    role: 'assistant',
    finish: 'stop',
    time: { created: 1000, completed: 2000 },
  })), 'ready');
});

test('maps incomplete, user, and tool-call messages to working', () => {
  assert.equal(getStateFromMessage(JSON.stringify({
    role: 'assistant',
    time: { created: 1000 },
  })), 'working');
  assert.equal(getStateFromMessage(JSON.stringify({ role: 'user' })), 'working');
  assert.equal(getStateFromMessage(JSON.stringify({
    role: 'assistant',
    finish: 'tool-calls',
    time: { created: 1000, completed: 2000 },
  })), 'working');
});

test('reads the OpenCode model from current SQLite formats', () => {
  assert.equal(getModelName(
    JSON.stringify({ id: 'MiniMax-M2.7', providerID: 'minimax-cn-coding-plan' }),
    null
  ), 'minimax-cn-coding-plan/MiniMax-M2.7');
  assert.equal(getModelName(null, JSON.stringify({
    modelID: 'gpt-5',
    providerID: 'openai',
  })), 'openai/gpt-5');
});

test('parses the latest OpenCode session row', () => {
  assert.deepEqual(parseOpenCodeRuntimeRows([{
    session_id: 'ses_1',
    session_model: JSON.stringify({ id: 'model-1', providerID: 'provider' }),
    session_updated: 1000,
    message_data: JSON.stringify({ role: 'assistant', finish: 'stop', time: { completed: 900 } }),
    message_created: 800,
  }]), {
    state: 'ready',
    model: 'provider/model-1',
    lastActivityMs: 800,
    sessionId: 'ses_1',
  });
});

test('caches OpenCode database reads until the database changes', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-opencode-test-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'opencode.db'), 'fixture');
  let calls = 0;
  const query = () => {
    calls++;
    return { state: 'ready', model: null, lastActivityMs: null, sessionId: null };
  };

  getOpenCodeRuntimeForCwd('/project', dataDir, { query });
  getOpenCodeRuntimeForCwd('/project', dataDir, { query });
  assert.equal(calls, 1);

  fs.writeFileSync(path.join(dataDir, 'opencode.db-wal'), 'changed');
  getOpenCodeRuntimeForCwd('/project', dataDir, { query });
  assert.equal(calls, 2);
});
