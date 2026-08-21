'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, 'render-menu.py');
const python = process.env.PYTHON || 'python3';

function render(data) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'render-menu-'));
  const statusPath = path.join(directory, 'status.json');
  fs.writeFileSync(statusPath, JSON.stringify(data));
  const result = spawnSync(python, [
    script,
    statusPath,
    '/repo/focus-agent-session.js',
    '/repo/focus-web-url.js',
    '/opt/node',
    '/repo/restart-agent-monitor.sh',
    '/repo/display-config.js',
    '/repo/notification-settings.js',
    '/repo/browser-tab-settings.js',
    '/repo/startup-settings.js',
    '--static',
  ], { encoding: 'utf8', env: { ...process.env, HOME: directory } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function renderCache(data, cacheKey = 'status-key') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'render-menu-cache-'));
  const statusPath = path.join(directory, 'status.json');
  const cachePrefix = path.join(directory, 'menu');
  fs.writeFileSync(statusPath, JSON.stringify(data));
  const result = spawnSync(python, [
    script,
    statusPath,
    '/repo/focus-agent-session.js',
    '/repo/focus-web-url.js',
    '/opt/node',
    '/repo/restart-agent-monitor.sh',
    '/repo/display-config.js',
    '/repo/notification-settings.js',
    '/repo/browser-tab-settings.js',
    '/repo/startup-settings.js',
    '--cache-prefix',
    cachePrefix,
    '--cache-key',
    cacheKey,
  ], { encoding: 'utf8', env: { ...process.env, HOME: directory } });
  assert.equal(result.status, 0, result.stderr);
  return {
    frame0: fs.readFileSync(`${cachePrefix}.0`, 'utf8'),
    frame1: fs.readFileSync(`${cachePrefix}.1`, 'utf8'),
    mode: fs.readFileSync(`${cachePrefix}.mode`, 'utf8').trim(),
    key: fs.readFileSync(`${cachePrefix}.key`, 'utf8').trim(),
  };
}

function workingData({ timestamp, uptimeSec }) {
  return {
    timestamp,
    summary: '🔵 1 working',
    display_config: {},
    ui: { lastUpdated: 'Last updated', statusUnknown: 'Unknown' },
    agents: [{
      name: 'Codex',
      instances: [{
        state: 'working',
        label: 'Codex (project)',
        status_label: 'Working',
        pids: [42],
        uptime_sec: uptimeSec,
      }],
    }],
  };
}

test('renders one working menu without Base64 image payloads', () => {
  const output = render({
    summary: '🔵 1 working',
    notifications_enabled: true,
    display_config: {},
    ui: {
      settings: 'Settings',
      startup: 'Start at login',
      enableStartup: 'Enable startup',
      notifications: 'Notifications',
      disableNotifications: 'Disable notifications',
      displayConfig: 'Display options',
      statusUnknown: 'Unknown',
    },
    agents: [{
      name: 'Codex',
      instances: [{
        state: 'working',
        label: 'Codex (project)',
        status_label: 'Working',
        pids: [42],
        uptime_sec: 65,
        model: 'gpt-test',
        context_usage: { used_tokens: 12000, window_tokens: 100000, percent: 12 },
      }],
    }],
  });

  assert.match(output, /^1 working \| sfimage=smallcircle\.fill\.circle/m);
  const config = output.match(/sfconfig=(\S+)/)?.[1];
  assert.doesNotThrow(() => JSON.parse(Buffer.from(config, 'base64').toString('utf8')));
  assert.match(output, /🔵 Codex \(project\): Working \(1m\) · gpt-test · 12\.0% \(12k\/100k\)/);
  assert.match(output, /param1=42 terminal=false/);
  assert.match(output, /Enable startup .*param0=\/repo\/startup-settings\.js param1=toggle/);
  assert.doesNotMatch(output, /\| image=/);
});

test('renders waiting and stopped states with lightweight symbols', () => {
  const output = render({
    summary: '🟡 1 awaiting confirmation',
    display_config: {},
    ui: { statusStopped: 'Stopped' },
    agents: [{
      name: 'Claude',
      instances: [{ state: 'stopped', label: 'Claude', status_label: 'Stopped', pids: [] }],
    }],
  });

  assert.match(output, /^1 awaiting confirmation \| sfimage=smallcircle\.fill\.circle/m);
  assert.match(output, /⚪ Claude: Stopped \| color=#8E8E93/);
});

test('renders web agent instances as browser links', () => {
  const output = render({
    summary: '🟢 1 ready',
    display_config: { browserTabReuse: true },
    ui: { statusUnknown: 'Unknown' },
    agents: [{
      name: 'DeepSeek Harness',
      instances: [{
        state: 'ready',
        label: 'DeepSeek Harness',
        status_label: 'Ready',
        pids: [387],
        open_url: 'http://127.0.0.1:3080/',
      }],
    }],
  });

  assert.match(output, /🟢 DeepSeek Harness: Ready .*param0=\/repo\/focus-web-url\.js param1=http:\/\/127\.0\.0\.1:3080\/ param2=reuse-tabs terminal=false/);
  assert.doesNotMatch(output, /param1=387 terminal=false/);
});

test('renders browser tab reuse as an explicit setting', () => {
  const output = render({
    summary: '🟢 1 ready',
    display_config: { browserTabReuse: false },
    ui: {
      settings: 'Settings',
      displayConfig: 'Display options',
      browserTabs: 'Browser tabs',
      enableBrowserTabReuse: 'Click to enable browser tab reuse',
      openAutomationSettings: 'Open Automation Settings',
      browserTabReusePermission: 'Requires browser Automation permission',
      statusUnknown: 'Unknown',
    },
    agents: [{
      name: 'DeepSeek Harness',
      instances: [{
        state: 'ready',
        label: 'DeepSeek Harness',
        status_label: 'Ready',
        pids: [387],
        open_url: 'http://127.0.0.1:3080/',
      }],
    }],
  });

  assert.match(output, /param0=\/repo\/focus-web-url\.js param1=http:\/\/127\.0\.0\.1:3080\/ terminal=false/);
  assert.doesNotMatch(output, /param2=reuse-tabs/);
  assert.match(output, /--Browser tabs \| sfimage=rectangle\.on\.rectangle/);
  assert.match(output, /Click to enable browser tab reuse .*param0=\/repo\/browser-tab-settings\.js param1=toggle/);
  assert.match(output, /Open Automation Settings .*param0=\/repo\/browser-tab-settings\.js param1=open-settings/);
  assert.doesNotMatch(output, /param2=browserTabReuse/);
});

test('sanitizes SwiftBar delimiters in dynamic text', () => {
  const output = render({
    summary: 'Ready | unsafe',
    display_config: {},
    agents: [],
  });
  assert.match(output, /^Ready ¦ unsafe$/m);
});

test('keeps rendered output stable within the same displayed minute', () => {
  const first = render(workingData({
    timestamp: '2026-08-03T03:52:01.000Z',
    uptimeSec: 65,
  }));
  const second = render(workingData({
    timestamp: '2026-08-03T03:52:59.000Z',
    uptimeSec: 119,
  }));

  assert.equal(second, first);
});

test('updates rendered output after a displayed minute boundary', () => {
  const first = render(workingData({
    timestamp: '2026-08-03T03:52:59.000Z',
    uptimeSec: 119,
  }));
  const second = render(workingData({
    timestamp: '2026-08-03T03:53:01.000Z',
    uptimeSec: 120,
  }));

  assert.notEqual(second, first);
  assert.match(second, /Working \(2m\)/);
});

test('writes both animation frames into an atomic menu cache', () => {
  const cache = renderCache(workingData({
    timestamp: '2026-08-03T03:52:01.000Z',
    uptimeSec: 65,
  }));

  assert.equal(cache.mode, 'working');
  assert.equal(cache.key, 'status-key');
  assert.match(cache.frame0, /^1 working \| sfimage=smallcircle\.fill\.circle/m);
  assert.match(cache.frame1, /^1 working \| sfimage=smallcircle\.fill\.circle/m);
  const frame0Config = JSON.parse(Buffer.from(cache.frame0.match(/sfconfig=(\S+)/)[1], 'base64'));
  const frame1Config = JSON.parse(Buffer.from(cache.frame1.match(/sfconfig=(\S+)/)[1], 'base64'));
  assert.equal(frame0Config.weight, 'regular');
  assert.equal(frame1Config.weight, 'regular');
  assert.notDeepEqual(frame0Config.colors, frame1Config.colors);
  assert.notEqual(cache.frame0, cache.frame1);
});

test('keeps both waiting animation frames bold with color-only animation', () => {
  const cache = renderCache({
    summary: '🟡 1 awaiting confirmation',
    display_config: {},
    agents: [],
  });

  const frame0Config = JSON.parse(Buffer.from(cache.frame0.match(/sfconfig=(\S+)/)[1], 'base64'));
  const frame1Config = JSON.parse(Buffer.from(cache.frame1.match(/sfconfig=(\S+)/)[1], 'base64'));
  assert.equal(cache.mode, 'waiting');
  assert.match(cache.frame0, /^1 awaiting confirmation \| sfimage=smallcircle\.fill\.circle/m);
  assert.match(cache.frame1, /^1 awaiting confirmation \| sfimage=smallcircle\.fill\.circle/m);
  assert.equal(frame0Config.weight, 'bold');
  assert.equal(frame1Config.weight, 'bold');
  assert.notDeepEqual(frame0Config.colors, frame1Config.colors);
});


test('renders enabled notification types as a multi-select submenu', () => {
  const enabled = render({
    summary: '🟢 1 ready',
    notifications_enabled: true,
    display_config: {
      notifyWaitingConfirmation: true,
      notifyWaitingReply: false,
      showWaitingNotificationsInAutoConfirmMode: true,
    },
    ui: {
      settings: 'Settings',
      notifications: 'Notifications',
      disableNotifications: 'Disable notifications',
      notificationOptions: 'Notification options',
      notifyWaitingConfirmation: 'Awaiting confirmation',
      notifyWaitingReply: 'Waiting for reply',
      notifyAutoConfirmWaiting: 'Notify in auto-confirmation mode',
      openNotificationSettings: 'Open System Notification Settings',
      notificationSettingsApp: 'App shown in Notifications: terminal-notifier',
      statusUnknown: 'Unknown',
    },
    agents: [],
  });
  const disabled = render({
    summary: '🟢 1 ready',
    notifications_enabled: false,
    display_config: {},
    ui: {
      settings: 'Settings',
      notifications: 'Notifications',
      enableNotifications: 'Enable notifications',
      notificationOptions: 'Notification options',
      statusUnknown: 'Unknown',
    },
    agents: [],
  });

  assert.match(enabled, /----Notification options \| sfimage=checklist/);
  assert.match(enabled, /------Awaiting confirmation .*param1=toggle-preference param2=notifyWaitingConfirmation.*checked=true/);
  assert.match(enabled, /------Waiting for reply .*param1=toggle-preference param2=notifyWaitingReply/);
  assert.doesNotMatch(enabled, /Waiting for reply.*checked=true/);
  assert.match(enabled, /------Notify in auto-confirmation mode .*param1=toggle-preference param2=showWaitingNotificationsInAutoConfirmMode.*checked=true/);
  assert.match(disabled, /----Notification options \| sfimage=checklist disabled=true/);
  assert.doesNotMatch(disabled, /------Awaiting confirmation/);
  assert.match(disabled, /----Enable notifications .*param1=toggle/);
});
