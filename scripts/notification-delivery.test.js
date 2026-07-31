'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAppleScript,
  buildFocusCommand,
  buildTerminalNotifierArgs,
  findTerminalNotifier,
  sendNativeNotification,
} = require('./notification-delivery');

test('finds an explicit terminal-notifier path before Homebrew defaults', () => {
  const existing = new Set(['/custom/terminal-notifier', '/opt/homebrew/bin/terminal-notifier']);
  assert.equal(findTerminalNotifier(
    { AGENT_STATUSBAR_TERMINAL_NOTIFIER: '/custom/terminal-notifier' },
    value => existing.has(value)
  ), '/custom/terminal-notifier');
});

test('builds a shell-safe focus command from fixed paths and a PID', () => {
  assert.equal(
    buildFocusCommand(123, '/usr/local/bin/node', "/tmp/Agent's/focus.js"),
    "'/usr/local/bin/node' '/tmp/Agent'\\''s/focus.js' 123"
  );
  assert.throws(() => buildFocusCommand(0, '/usr/bin/node', '/tmp/focus.js'));
});

test('builds a clickable terminal-notifier request', () => {
  assert.deepEqual(buildTerminalNotifierArgs({
    title: 'Agent Monitor',
    subtitle: 'Claude 等待回复',
    message: 'Claude 正在等待你的回复',
    pid: 321,
    nodePath: '/usr/local/bin/node',
    focusPath: '/repo/scripts/focus-agent-session.js',
  }), [
    '-title', 'Agent Monitor',
    '-subtitle', 'Claude 等待回复',
    '-message', 'Claude 正在等待你的回复',
    '-sound', 'default',
    '-execute', "'/usr/local/bin/node' '/repo/scripts/focus-agent-session.js' 321",
  ]);
});

test('escapes notification text in the osascript fallback', () => {
  assert.equal(
    buildAppleScript({ title: 'Agent "Monitor"', subtitle: 'Claude', message: 'A \\ B' }),
    'display notification "A \\\\ B" with title "Agent \\"Monitor\\"" subtitle "Claude" sound name "default"'
  );
});

test('uses terminal-notifier and falls back to osascript after a send failure', () => {
  const calls = [];
  const run = (command, args, _options, callback) => {
    calls.push({ command, args });
    callback(command.includes('terminal-notifier') ? new Error('failed') : null);
  };
  const delivery = sendNativeNotification({
    subtitle: 'Codex 等待确认',
    message: 'Codex 已进入等待确认',
    pid: 456,
  }, {
    exists: value => value === '/opt/homebrew/bin/terminal-notifier',
    run,
    nodePath: '/usr/local/bin/node',
    focusPath: '/repo/scripts/focus-agent-session.js',
  });

  assert.equal(delivery, 'terminal-notifier');
  assert.equal(calls[0].command, '/opt/homebrew/bin/terminal-notifier');
  assert.equal(calls[1].command, '/usr/bin/osascript');
});

test('uses osascript directly when terminal-notifier is unavailable', () => {
  const calls = [];
  const delivery = sendNativeNotification({
    subtitle: 'Claude 等待回复',
    message: 'Claude 正在等待你的回复',
    pid: 789,
  }, {
    exists: () => false,
    run: (command, args, _options, callback) => {
      calls.push({ command, args });
      callback(null);
    },
  });

  assert.equal(delivery, 'osascript');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/usr/bin/osascript');
});
