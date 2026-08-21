'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAppleScript,
  buildCodexFocusCommand,
  buildFocusCommand,
  buildNotificationExecuteCommand,
  buildTerminalNotifierArgs,
  buildWebFocusCommand,
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
    title: 'AgentStatusBar',
    subtitle: 'Claude 等待回复',
    message: 'Claude 正在等待你的回复',
    pid: 321,
    nodePath: '/usr/local/bin/node',
    focusPath: '/repo/scripts/focus-agent-session.js',
  }), [
    '-title', 'AgentStatusBar',
    '-subtitle', 'Claude 等待回复',
    '-message', 'Claude 正在等待你的回复',
    '-sound', 'default',
    '-execute', "'/usr/local/bin/node' '/repo/scripts/focus-agent-session.js' 321",
  ]);
});

test('builds a browser focus command for web agent notifications', () => {
  assert.equal(
    buildWebFocusCommand(
      'http://127.0.0.1:3080/',
      '/usr/local/bin/node',
      "/repo/scripts/focus-web-url.js",
      true
    ),
    "'/usr/local/bin/node' '/repo/scripts/focus-web-url.js' 'http://127.0.0.1:3080/' 'reuse-tabs'"
  );
});

test('prefers web focus over pid focus for notification clicks', () => {
  assert.equal(
    buildNotificationExecuteCommand({
      pid: 321,
      openUrl: 'http://127.0.0.1:3080/',
      reuseTabs: true,
      nodePath: '/usr/local/bin/node',
      focusPath: '/repo/scripts/focus-agent-session.js',
      focusWebPath: '/repo/scripts/focus-web-url.js',
    }),
    "'/usr/local/bin/node' '/repo/scripts/focus-web-url.js' 'http://127.0.0.1:3080/' 'reuse-tabs'"
  );
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

test('uses terminal-notifier for web notification clicks without a pid', () => {
  const calls = [];
  const delivery = sendNativeNotification({
    subtitle: 'DeepSeek Harness 等待确认',
    message: 'DeepSeek Harness 已进入等待确认',
    openUrl: 'http://127.0.0.1:3080/',
    reuseTabs: true,
  }, {
    exists: value => value === '/opt/homebrew/bin/terminal-notifier',
    run: (command, args, _options, callback) => {
      calls.push({ command, args });
      callback(null);
    },
    nodePath: '/usr/local/bin/node',
    focusWebPath: '/repo/scripts/focus-web-url.js',
  });

  assert.equal(delivery, 'terminal-notifier');
  assert.equal(calls[0].command, '/opt/homebrew/bin/terminal-notifier');
  assert.deepEqual(calls[0].args.slice(-2), [
    '-execute',
    "'/usr/local/bin/node' '/repo/scripts/focus-web-url.js' 'http://127.0.0.1:3080/' 'reuse-tabs'",
  ]);
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


test('builds an exact ChatGPT Codex thread focus command', () => {
  assert.equal(
    buildCodexFocusCommand(
      '01a02389-7898-7f60-a1b8-799d9017fe52',
      '/usr/local/bin/node',
      '/repo/scripts/focus-codex-thread.js'
    ),
    "'/usr/local/bin/node' '/repo/scripts/focus-codex-thread.js' '01a02389-7898-7f60-a1b8-799d9017fe52'"
  );
});

test('prefers a ChatGPT Codex thread over the shared app-server PID', () => {
  assert.equal(
    buildNotificationExecuteCommand({
      pid: 44793,
      codexThreadId: '01a02389-7898-7f60-a1b8-799d9017fe52',
      nodePath: '/usr/local/bin/node',
      focusPath: '/repo/scripts/focus-agent-session.js',
      focusCodexPath: '/repo/scripts/focus-codex-thread.js',
    }),
    "'/usr/local/bin/node' '/repo/scripts/focus-codex-thread.js' '01a02389-7898-7f60-a1b8-799d9017fe52'"
  );
});

test('uses terminal-notifier for ChatGPT Codex thread notification clicks', () => {
  const calls = [];
  const delivery = sendNativeNotification({
    subtitle: 'ChatGPT 等待回复',
    message: 'ChatGPT 正在等待你的回复',
    codexThreadId: '01a02389-7898-7f60-a1b8-799d9017fe52',
  }, {
    exists: value => value === '/opt/homebrew/bin/terminal-notifier',
    run: (command, args, _options, callback) => {
      calls.push({ command, args });
      callback(null);
    },
    nodePath: '/usr/local/bin/node',
    focusCodexPath: '/repo/scripts/focus-codex-thread.js',
  });

  assert.equal(delivery, 'terminal-notifier');
  assert.deepEqual(calls[0].args.slice(-2), [
    '-execute',
    "'/usr/local/bin/node' '/repo/scripts/focus-codex-thread.js' '01a02389-7898-7f60-a1b8-799d9017fe52'",
  ]);
});
