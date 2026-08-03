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
    '/opt/node',
    '/repo/restart-agent-monitor.sh',
    '/repo/display-config.js',
    '/repo/notification-settings.js',
    '--static',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('renders one working menu without Base64 image payloads', () => {
  const output = render({
    summary: '🔵 1 working',
    notifications_enabled: true,
    display_config: {},
    ui: {
      settings: 'Settings',
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
  assert.match(output, /🔵 Codex \(project\): Working \(1m5s\) · gpt-test · 12\.0% \(12k\/100k\)/);
  assert.match(output, /param1=42 terminal=false/);
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

  assert.match(output, /^1 awaiting confirmation \| sfimage=largecircle\.fill\.circle/m);
  assert.match(output, /⚪ Claude: Stopped \| color=#8E8E93/);
});

test('sanitizes SwiftBar delimiters in dynamic text', () => {
  const output = render({
    summary: 'Ready | unsafe',
    display_config: {},
    agents: [],
  });
  assert.match(output, /^Ready ¦ unsafe$/m);
});
