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

function buildWebFocusCommand(openUrl, nodePath, focusWebPath, reuseTabs = false) {
  const url = String(openUrl || '').trim();
  if (!url) throw new Error('Invalid web URL');
  const reuseArg = reuseTabs ? ` ${shellQuote('reuse-tabs')}` : '';
  return `${shellQuote(nodePath)} ${shellQuote(focusWebPath)} ${shellQuote(url)}${reuseArg}`;
}

function buildNotificationExecuteCommand({
  pid,
  openUrl,
  reuseTabs = false,
  nodePath,
  focusPath,
  focusWebPath,
}) {
  if (openUrl) return buildWebFocusCommand(openUrl, nodePath, focusWebPath, reuseTabs);
  return buildFocusCommand(pid, nodePath, focusPath);
}

function buildTerminalNotifierArgs({
  title,
  subtitle,
  message,
  pid,
  openUrl,
  reuseTabs = false,
  nodePath,
  focusPath,
  focusWebPath,
}) {
  return [
    '-title', title,
    '-subtitle', subtitle,
    '-message', message,
    '-sound', 'default',
    '-execute', buildNotificationExecuteCommand({
      pid,
      openUrl,
      reuseTabs,
      nodePath,
      focusPath,
      focusWebPath,
    }),
  ];
}

function escapeAppleScript(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildAppleScript({ title, subtitle, message }) {
  return `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}" subtitle "${escapeAppleScript(subtitle)}" sound name "default"`;
}

function sendNativeNotification(
  { title = 'AgentStatusBar', subtitle, message, pid, openUrl, reuseTabs = false },
  {
    env = process.env,
    exists = fs.existsSync,
    run = execFile,
    nodePath = process.execPath,
    focusPath = path.join(__dirname, 'focus-agent-session.js'),
    focusWebPath = path.join(__dirname, 'focus-web-url.js'),
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
  const hasPidAction = Number.isInteger(pid) && pid > 0;
  const hasWebAction = typeof openUrl === 'string' && openUrl.trim();
  if (!notifierPath || (!hasPidAction && !hasWebAction)) {
    fallback();
    return 'osascript';
  }

  const args = buildTerminalNotifierArgs({
    title,
    subtitle,
    message,
    pid,
    openUrl,
    reuseTabs,
    nodePath,
    focusPath,
    focusWebPath,
  });
  run(notifierPath, args, options, error => {
    if (error) fallback();
  });
  return 'terminal-notifier';
}

module.exports = {
  buildAppleScript,
  buildFocusCommand,
  buildNotificationExecuteCommand,
  buildTerminalNotifierArgs,
  buildWebFocusCommand,
  findTerminalNotifier,
  sendNativeNotification,
  shellQuote,
};
