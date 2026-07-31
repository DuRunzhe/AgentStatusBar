'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readDisplayConfig, setNotificationsEnabled } = require('./display-config');
const {
  configureNotifications,
  findBrew,
  openSystemNotificationSettings,
} = require('./notification-settings');

test('finds Homebrew in the standard Apple Silicon or Intel locations', () => {
  assert.equal(findBrew(value => value === '/usr/local/bin/brew'), '/usr/local/bin/brew');
  assert.equal(findBrew(() => false), null);
});

test('opens the macOS Notification settings pane', () => {
  const calls = [];
  openSystemNotificationSettings((command, args, options) => calls.push({ command, args, options }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/usr/bin/open');
  assert.deepEqual(calls[0].args, [
    'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
  ]);
});

test('turns notifications off without running commands or changing macOS settings', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-notification-toggle-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, 'config.json');
  setNotificationsEnabled(true, configFile);

  const result = configureNotifications({
    configFile,
    locale: 'en',
    run: () => { throw new Error('should not run'); },
  });
  assert.deepEqual(result, { enabled: false, reason: 'disabled' });
  assert.equal(readDisplayConfig(configFile).notifications, false);
});

test('keeps notifications disabled when dependency installation is declined', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-notification-decline-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, 'config.json');

  const result = configureNotifications({
    configFile,
    locale: 'en',
    exists: () => false,
    run: command => {
      assert.equal(command, '/usr/bin/osascript');
      return 'button returned:Cancel\n';
    },
  });
  assert.deepEqual(result, { enabled: false, reason: 'install-declined' });
  assert.equal(readDisplayConfig(configFile).notifications, false);
});

test('enables notifications only after the user verifies the permission test', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-notification-verify-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, 'config.json');
  const dialogResults = ['button returned:Open Settings\n', 'button returned:I saw it\n', 'button returned:OK\n'];
  const calls = [];

  const result = configureNotifications({
    configFile,
    locale: 'en',
    exists: value => value === '/opt/homebrew/bin/terminal-notifier',
    run: (command, args) => {
      calls.push({ command, args });
      if (command === '/usr/bin/osascript') return dialogResults.shift();
      return '';
    },
  });
  assert.deepEqual(result, { enabled: true, reason: 'verified' });
  assert.equal(readDisplayConfig(configFile).notifications, true);
  assert.equal(calls.some(call => call.command === '/opt/homebrew/bin/terminal-notifier'), true);
  assert.equal(calls.some(call => call.command === '/usr/bin/open'), true);
});

test('still opens Notification settings when the permission probe fails', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-notification-probe-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, 'config.json');
  const dialogResults = ['button returned:Open Settings\n', 'button returned:Not yet\n'];
  const calls = [];

  const result = configureNotifications({
    configFile,
    locale: 'en',
    exists: value => value === '/opt/homebrew/bin/terminal-notifier',
    run: command => {
      calls.push(command);
      if (command === '/opt/homebrew/bin/terminal-notifier') throw new Error('not authorized');
      if (command === '/usr/bin/osascript') return dialogResults.shift();
      return '';
    },
  });
  assert.deepEqual(result, { enabled: false, reason: 'not-verified' });
  assert.equal(calls.includes('/usr/bin/open'), true);
  assert.equal(readDisplayConfig(configFile).notifications, false);
});
