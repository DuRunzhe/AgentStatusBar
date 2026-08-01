'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  COPY,
  installStartup,
  isStartupEnabled,
  launchAgentPath,
  legacyLaunchAgentPath,
  plistContent,
  serviceTarget,
  uninstallStartup,
} = require('./startup-settings');

test('provides complete localized startup guidance', () => {
  const requiredKeys = [
    'title', 'enableMessage', 'disableMessage', 'enable', 'disable',
    'cancel', 'success', 'disabled', 'failed', 'ok',
  ];
  for (const locale of ['en', 'zh-Hans', 'zh-Hant']) {
    assert.deepEqual(Object.keys(COPY[locale]).sort(), [...requiredKeys].sort());
    for (const key of requiredKeys) assert.ok(COPY[locale][key].trim(), `${locale}.${key}`);
  }
  assert.match(COPY['zh-Hans'].success, /SwiftBar/);
  assert.match(COPY['zh-Hant'].success, /SwiftBar/);
});

test('builds a launch agent with escaped executable paths', () => {
  const plist = plistContent('/opt/a&b/node', '/repo/<agent>/agent-monitor.js');
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /\/opt\/a&amp;b\/node/);
  assert.match(plist, /\/repo\/&lt;agent&gt;\/agent-monitor\.js/);
});

test('installs, detects, loads and removes the user launch agent', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-startup-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'bootout') throw new Error('not loaded');
    return '';
  };

  assert.equal(isStartupEnabled({ home }), false);
  installStartup({
    home,
    nodePath: '/opt/homebrew/bin/node',
    daemonPath: '/repo/scripts/agent-monitor.js',
    uid: 501,
    run,
  });
  assert.equal(isStartupEnabled({ home }), true);
  assert.match(fs.readFileSync(launchAgentPath(home), 'utf8'), /\/repo\/scripts\/agent-monitor\.js/);
  assert.deepEqual(
    calls.map(call => call[1][0]).filter(command => command !== 'bootout'),
    ['bootstrap', 'enable']
  );

  uninstallStartup({ home, uid: 501, run: () => '' });
  assert.equal(isStartupEnabled({ home }), false);
});

test('uses the current GUI user service target', () => {
  assert.equal(serviceTarget(501), 'gui/501/com.agentstatusbar.monitor');
});

test('removes the legacy OpenClaw launch agent during migration', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-legacy-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(legacyLaunchAgentPath(home)), { recursive: true });
  fs.writeFileSync(legacyLaunchAgentPath(home), 'legacy');
  const calls = [];
  installStartup({ home, uid: 501, run: (command, args) => {
    calls.push(args);
    if (args[0] === 'bootout') throw new Error('not loaded');
    return '';
  }});
  assert.equal(fs.existsSync(legacyLaunchAgentPath(home)), false);
  assert.ok(calls.some(args => args.includes('gui/501/openclaw.agent-monitor')));
});
