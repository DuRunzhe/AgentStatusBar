'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getClaudeNativeState,
  getClaudeRuntimeForPid,
  parseClaudeStatusLinePayload,
} = require('./claude-context');
const { installClaudeStatusLine } = require('./install-claude-statusline');

test('parses native Claude status line context usage', () => {
  assert.deepEqual(parseClaudeStatusLinePayload({
    session_id: 'b6597fbf-6258-444f-b066-a9b1aa7c9441',
    transcript_path: '/tmp/session.jsonl',
    cwd: '/tmp/project',
    model: { id: 'claude-sonnet-4', display_name: 'Claude Sonnet 4' },
    context_window: {
      total_input_tokens: 125855,
      context_window_size: 200000,
      used_percentage: 62.9,
    },
  }, 1234), {
    session_id: 'b6597fbf-6258-444f-b066-a9b1aa7c9441',
    transcript_path: '/tmp/session.jsonl',
    cwd: '/tmp/project',
    captured_at: 1234,
    model: 'Claude Sonnet 4',
    context_usage: {
      used_tokens: 125855,
      window_tokens: 200000,
      percent: 62.9,
    },
  });
});

test('keeps session metadata when Claude has no context usage yet', () => {
  const snapshot = parseClaudeStatusLinePayload({
    session_id: 'new-session',
    transcript_path: '/tmp/new-session.jsonl',
    context_window: { used_percentage: null },
  });
  assert.equal(snapshot.context_usage, null);
  assert.equal(snapshot.model, null);
});

test('matches a Claude PID to its captured session snapshot', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const contextDir = path.join(root, 'context');
  fs.mkdirSync(path.join(homeDir, '.claude', 'sessions'), { recursive: true });
  fs.mkdirSync(contextDir, { recursive: true });

  fs.writeFileSync(path.join(homeDir, '.claude', 'sessions', '42.json'), JSON.stringify({
    pid: 42,
    sessionId: 'session-42',
    cwd: '/projects/example',
    status: 'idle',
    waitingFor: null,
  }));
  fs.writeFileSync(path.join(contextDir, 'session-42.json'), JSON.stringify({
    session_id: 'session-42',
    transcript_path: '/transcripts/session-42.jsonl',
    cwd: '/projects/example',
    model: 'claude-sonnet-4',
    context_usage: { used_tokens: 80000, window_tokens: 200000, percent: 40 },
  }));

  assert.deepEqual(getClaudeRuntimeForPid(42, { homeDir, contextDir }), {
    session_id: 'session-42',
    cwd: '/projects/example',
    status: 'idle',
    waiting_for: null,
    transcript_path: '/transcripts/session-42.jsonl',
    model: 'claude-sonnet-4',
    context_usage: { used_tokens: 80000, window_tokens: 200000, percent: 40 },
  });
});

test('maps Claude native session status before transcript inference', () => {
  assert.equal(getClaudeNativeState({ status: 'waiting', waiting_for: 'permission prompt' }), 'waiting');
  assert.equal(getClaudeNativeState({ status: 'busy' }), 'working');
  assert.equal(getClaudeNativeState({ status: 'idle' }), 'ready');
  assert.equal(getClaudeNativeState({ status: 'future-status' }), null);
  assert.equal(getClaudeNativeState(null), null);
});

test('installer preserves an existing Claude status line across repeated installs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-install-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const settingsPath = path.join(root, 'settings.json');
  const previousStatusLine = { type: 'command', command: 'printf existing-status' };
  fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: previousStatusLine }));

  const first = installClaudeStatusLine({ configDir: root, collectorPath: '/repo/collector.js' });
  const second = installClaudeStatusLine({ configDir: root, collectorPath: '/repo/collector.js' });
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const integration = JSON.parse(fs.readFileSync(first.integrationPath, 'utf8'));

  assert.equal(first.collectorCommand, second.collectorCommand);
  assert.equal(settings.statusLine.command, first.collectorCommand);
  assert.deepEqual(integration.previous_status_line, previousStatusLine);
});
