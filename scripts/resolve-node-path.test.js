'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const resolverPath = path.join(__dirname, 'resolve-node-path.sh');

function writeExecutable(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '#!/bin/bash\nexit 0\n', { mode: 0o755 });
}

function writeLaunchAgent(file, nodePath) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>ProgramArguments</key><array><string>${nodePath}</string><string>/repo/agent-monitor.js</string></array>
</dict></plist>
`);
}

test('prefers the Node executable recorded by the current LaunchAgent', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-node-path-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const nodePath = path.join(home, '.nvm', 'versions', 'node', 'v24.0.0', 'bin', 'node');
  const plistPath = path.join(home, 'Library', 'LaunchAgents', 'com.agentstatusbar.monitor.plist');
  writeExecutable(nodePath);
  writeLaunchAgent(plistPath, nodePath);

  const resolved = execFileSync('/bin/bash', [resolverPath], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin' },
  }).trim();

  assert.equal(resolved, nodePath);
});

test('falls back to PATH when the LaunchAgent Node executable is unavailable', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-node-fallback-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const fallbackNode = path.join(home, 'bin', 'node');
  const plistPath = path.join(home, 'Library', 'LaunchAgents', 'com.agentstatusbar.monitor.plist');
  writeExecutable(fallbackNode);
  writeLaunchAgent(plistPath, path.join(home, 'missing', 'node'));

  const resolved = execFileSync('/bin/bash', [resolverPath], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.dirname(fallbackNode)}:/usr/bin:/bin` },
  }).trim();

  assert.equal(resolved, fallbackNode);
});
