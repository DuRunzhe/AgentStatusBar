'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const TERMINAL_NOTIFIER_PATHS = [
  '/opt/homebrew/bin/terminal-notifier',
  '/usr/local/bin/terminal-notifier',
];

function findTerminalNotifier(
  env = process.env,
  exists = fs.existsSync
) {
  const candidates = [env.AGENT_STATUSBAR_TERMINAL_NOTIFIER, ...TERMINAL_NOTIFIER_PATHS];
  return candidates.find(candidate => candidate && exists(candidate)) || null;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildFocusCommand(pid, nodePath, focusPath) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid agent PID');
  return `${shellQuote(nodePath)} ${shellQuote(focusPath)} ${pid}`;
}

function buildTerminalNotifierArgs({ title, subtitle, message, pid, nodePath, focusPath }) {
  return [
    '-title', title,
    '-subtitle', subtitle,
    '-message', message,
    '-sound', 'default',
    '-execute', buildFocusCommand(pid, nodePath, focusPath),
  ];
}

function escapeAppleScript(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildAppleScript({ title, subtitle, message }) {
  return `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}" subtitle "${escapeAppleScript(subtitle)}" sound name "default"`;
}

function sendNativeNotification(
  { title = 'Agent Monitor', subtitle, message, pid },
  {
    env = process.env,
    exists = fs.existsSync,
    run = execFile,
    nodePath = process.execPath,
    focusPath = path.join(__dirname, 'focus-agent-session.js'),
  } = {}
) {
  const options = { encoding: 'utf8', timeout: 3000 };
  const fallback = () => {
    run(
      '/usr/bin/osascript',
      ['-e', buildAppleScript({ title, subtitle, message })],
      options,
      () => { /* notification failures must never block monitoring */ }
    );
  };

  const notifierPath = findTerminalNotifier(env, exists);
  if (!notifierPath || !Number.isInteger(pid) || pid <= 0) {
    fallback();
    return 'osascript';
  }

  const args = buildTerminalNotifierArgs({
    title,
    subtitle,
    message,
    pid,
    nodePath,
    focusPath,
  });
  run(notifierPath, args, options, error => {
    if (error) fallback();
  });
  return 'terminal-notifier';
}

module.exports = {
  buildAppleScript,
  buildFocusCommand,
  buildTerminalNotifierArgs,
  findTerminalNotifier,
  sendNativeNotification,
  shellQuote,
};
