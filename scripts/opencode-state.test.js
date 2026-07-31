'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getContextUsage,
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
  assert.equal(getModelName(
    JSON.stringify({ id: 'session-default', providerID: 'provider-a' }),
    JSON.stringify({ modelID: 'response-model', providerID: 'provider-b' })
  ), 'provider-b/response-model');
});

test('reads OpenCode context usage from assistant tokens and the model catalog', () => {
  const assistant = JSON.stringify({
    role: 'assistant',
    providerID: 'opencode',
    modelID: 'deepseek-v4-flash-free',
    tokens: { total: 12038 },
  });
  const catalog = {
    opencode: {
      models: {
        'deepseek-v4-flash-free': { limit: { context: 200000 } },
      },
    },
  };
  assert.deepEqual(getContextUsage(assistant, catalog), {
    used_tokens: 12038,
    window_tokens: 200000,
    percent: 6,
  });
});

test('returns no OpenCode context usage when model metadata is missing', () => {
  const assistant = JSON.stringify({
    role: 'assistant',
    providerID: 'opencode',
    modelID: 'unknown',
    tokens: { total: 100 },
  });
  assert.equal(getContextUsage(assistant, {}), null);
});

test('parses the latest OpenCode session row', () => {
  assert.deepEqual(parseOpenCodeRuntimeRows([{
    session_id: 'ses_1',
    session_model: JSON.stringify({ id: 'model-1', providerID: 'provider' }),
    session_updated: 1000,
    message_data: JSON.stringify({ role: 'assistant', finish: 'stop', time: { completed: 900 } }),
    assistant_data: JSON.stringify({
      role: 'assistant',
      providerID: 'provider',
      modelID: 'model-1',
      tokens: { total: 12038 },
    }),
    message_created: 800,
  }], {
    provider: { models: { 'model-1': { limit: { context: 200000 } } } },
  }), {
    state: 'ready',
    model: 'provider/model-1',
    contextUsage: { used_tokens: 12038, window_tokens: 200000, percent: 6 },
    lastActivityMs: 800,
    sessionId: 'ses_1',
  });
});

test('uses the latest message for state and latest assistant for context', () => {
  assert.deepEqual(parseOpenCodeRuntimeRows([{
    session_id: 'ses_1',
    session_model: null,
    session_updated: 1000,
    message_data: JSON.stringify({ role: 'user' }),
    assistant_data: JSON.stringify({
      role: 'assistant',
      providerID: 'provider',
      modelID: 'model-1',
      tokens: { total: 1000 },
    }),
    message_created: 900,
  }], {
    provider: { models: { 'model-1': { limit: { context: 10000 } } } },
  }), {
    state: 'working',
    model: 'provider/model-1',
    contextUsage: { used_tokens: 1000, window_tokens: 10000, percent: 10 },
    lastActivityMs: 900,
    sessionId: 'ses_1',
  });
});

test('caches OpenCode database reads until the database changes', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-opencode-test-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'opencode.db'), 'fixture');
  const modelCatalogPath = path.join(dataDir, 'models.json');
  fs.writeFileSync(modelCatalogPath, '{}');
  let calls = 0;
  const query = () => {
    calls++;
    return { state: 'ready', model: null, lastActivityMs: null, sessionId: null };
  };

  const options = { query, modelCatalogPath };
  getOpenCodeRuntimeForCwd('/project', dataDir, options);
  getOpenCodeRuntimeForCwd('/project', dataDir, options);
  assert.equal(calls, 1);

  fs.writeFileSync(path.join(dataDir, 'opencode.db-wal'), 'changed');
  getOpenCodeRuntimeForCwd('/project', dataDir, options);
  assert.equal(calls, 2);

  const nextMtime = new Date(Date.now() + 2000);
  fs.utimesSync(modelCatalogPath, nextMtime, nextMtime);
  getOpenCodeRuntimeForCwd('/project', dataDir, options);
  assert.equal(calls, 3);
});
