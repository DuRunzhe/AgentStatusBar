'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const resolverPath = path.join(__dirname, 'resolve-node-path.sh');

function resolverEnv(home, env = {}) {
  return {
    ...process.env,
    HOME: home,
    PATH: '/usr/bin:/bin',
    AGENT_STATUSBAR_STANDARD_NODE_PATHS: '',
    ...env,
  };
}

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
    env: resolverEnv(home),
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
    env: resolverEnv(home, { PATH: `${path.dirname(fallbackNode)}:/usr/bin:/bin` }),
  }).trim();

  assert.equal(resolved, fallbackNode);
});

test('uses the NVM default version when GUI PATH has no Node executable', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-node-nvm-default-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const nodePath = path.join(home, '.nvm', 'versions', 'node', 'v24.19.0', 'bin', 'node');
  const standardNode = path.join(home, 'standard', 'node');
  const aliasPath = path.join(home, '.nvm', 'alias', 'default');
  writeExecutable(nodePath);
  writeExecutable(standardNode);
  fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
  fs.writeFileSync(aliasPath, 'v24.19.0\n');

  const resolved = execFileSync('/bin/bash', [resolverPath], {
    encoding: 'utf8',
    env: resolverEnv(home, { AGENT_STATUSBAR_STANDARD_NODE_PATHS: standardNode }),
  }).trim();

  assert.equal(resolved, nodePath);
});

test('uses the newest installed NVM version when the default alias is unavailable', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-node-nvm-latest-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const olderNode = path.join(home, '.nvm', 'versions', 'node', 'v9.9.0', 'bin', 'node');
  const newerNode = path.join(home, '.nvm', 'versions', 'node', 'v24.2.0', 'bin', 'node');
  writeExecutable(olderNode);
  writeExecutable(newerNode);

  const resolved = execFileSync('/bin/bash', [resolverPath], {
    encoding: 'utf8',
    env: resolverEnv(home),
  }).trim();

  assert.equal(resolved, newerNode);
});

test('resolves major-version and LTS default aliases', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-node-nvm-alias-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const node20 = path.join(home, '.nvm', 'versions', 'node', 'v20.12.2', 'bin', 'node');
  const node22 = path.join(home, '.nvm', 'versions', 'node', 'v22.11.0', 'bin', 'node');
  const node24 = path.join(home, '.nvm', 'versions', 'node', 'v24.2.0', 'bin', 'node');
  const defaultAlias = path.join(home, '.nvm', 'alias', 'default');
  writeExecutable(node20);
  writeExecutable(node22);
  writeExecutable(node24);
  fs.mkdirSync(path.join(home, '.nvm', 'alias', 'lts'), { recursive: true });
  fs.writeFileSync(path.join(home, '.nvm', 'alias', 'lts', 'iron'), 'v20.12.2\n');
  fs.writeFileSync(path.join(home, '.nvm', 'alias', 'lts', 'jod'), 'v22.11.0\n');
  fs.writeFileSync(defaultAlias, 'lts/*\n');

  let resolved = execFileSync('/bin/bash', [resolverPath], {
    encoding: 'utf8',
    env: resolverEnv(home),
  }).trim();
  assert.equal(resolved, node22);

  fs.writeFileSync(defaultAlias, '24\n');
  resolved = execFileSync('/bin/bash', [resolverPath], {
    encoding: 'utf8',
    env: resolverEnv(home),
  }).trim();
  assert.equal(resolved, node24);
});

test('uses a standard installation path only after PATH and NVM fail', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-node-standard-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const standardNode = path.join(home, 'standard', 'node');
  writeExecutable(standardNode);

  const resolved = execFileSync('/bin/bash', [resolverPath], {
    encoding: 'utf8',
    env: resolverEnv(home, { AGENT_STATUSBAR_STANDARD_NODE_PATHS: standardNode }),
  }).trim();

  assert.equal(resolved, standardNode);
});

test('honors an NVM system default by falling back to a standard Node installation', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-node-system-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const nvmNode = path.join(home, '.nvm', 'versions', 'node', 'v24.2.0', 'bin', 'node');
  const standardNode = path.join(home, 'standard', 'node');
  const defaultAlias = path.join(home, '.nvm', 'alias', 'default');
  writeExecutable(nvmNode);
  writeExecutable(standardNode);
  fs.mkdirSync(path.dirname(defaultAlias), { recursive: true });
  fs.writeFileSync(defaultAlias, 'system\n');

  const resolved = execFileSync('/bin/bash', [resolverPath], {
    encoding: 'utf8',
    env: resolverEnv(home, { AGENT_STATUSBAR_STANDARD_NODE_PATHS: standardNode }),
  }).trim();

  assert.equal(resolved, standardNode);
});
