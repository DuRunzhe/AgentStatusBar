'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getClaudeModelInLines,
  getCodexModelInLines,
  getOpenCodeModel,
  getOpenCodeModelFromMessage,
  normalizeModelName,
} = require('./model-state');

function lines(events) {
  return events.map(event => JSON.stringify(event));
}

test('uses the latest Claude assistant model', () => {
  assert.equal(getClaudeModelInLines(lines([
    { type: 'assistant', message: { model: 'claude-sonnet-4' } },
    { type: 'user', message: {} },
    { type: 'assistant', message: { model: 'deepseek-v4-flash' } },
  ])), 'deepseek-v4-flash');
});

test('uses the latest Codex turn model with settings fallback', () => {
  assert.equal(getCodexModelInLines(lines([
    { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-5.5' } } },
    { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
  ])), 'gpt-5.6-sol');
  assert.equal(getCodexModelInLines(lines([
    { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-5.5' } } },
  ])), 'gpt-5.5');
});

test('reads models from already parsed transcript events', () => {
  assert.equal(getCodexModelInLines([
    { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
  ]), 'gpt-5.6-sol');
});

test('formats an OpenCode provider and model', () => {
  assert.equal(getOpenCodeModelFromMessage({
    model: { providerID: 'google', modelID: 'gemini-3-pro-preview' },
  }), 'google/gemini-3-pro-preview');
});

test('finds the latest OpenCode model for a session storage file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-model-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const messageDir = path.join(root, 'message', 'ses_example1');
  fs.mkdirSync(messageDir, { recursive: true });
  const older = path.join(messageDir, 'older.json');
  const newer = path.join(messageDir, 'newer.json');
  fs.writeFileSync(older, JSON.stringify({ model: { providerID: 'openai', modelID: 'gpt-old' } }));
  fs.writeFileSync(newer, JSON.stringify({ modelID: 'gpt-new', providerID: 'openai' }));
  fs.utimesSync(older, 1, 1);
  fs.utimesSync(newer, 2, 2);

  assert.equal(
    getOpenCodeModel(path.join(root, 'session', 'project', 'ses_example1.json'), root),
    'openai/gpt-new'
  );
});

test('sanitizes model text for SwiftBar output', () => {
  assert.equal(normalizeModelName('  model|name\nnext  '), 'model name next');
  assert.equal(normalizeModelName(''), null);
});
