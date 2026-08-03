'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const installer = path.join(__dirname, 'install-swiftbar-plugin.sh');
const stableSource = path.join(__dirname, 'agent-monitor.sh');

test('installs the sole stable source and removes other AgentStatusBar symlinks', () => {
  const pluginDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'swiftbar-plugin-'));
  const legacyPath = path.join(pluginDirectory, 'agent-monitor.1900ms.sh');
  const alternatePath = path.join(pluginDirectory, 'agent-monitor.2s.sh');
  const regularPath = path.join(pluginDirectory, 'agent-monitor.custom.sh');
  fs.symlinkSync('/obsolete/agent-monitor.1900ms.sh', legacyPath);
  fs.symlinkSync('/obsolete/agent-monitor.2s.sh', alternatePath);
  fs.writeFileSync(regularPath, 'keep me');

  const result = spawnSync('/bin/bash', [installer], {
    encoding: 'utf8',
    env: { ...process.env, SWIFTBAR_PLUGIN_DIR: pluginDirectory },
  });

  assert.equal(result.status, 0, result.stderr);
  const pluginPath = path.join(pluginDirectory, 'agent-monitor.1s.sh');
  assert.equal(fs.readlinkSync(pluginPath), stableSource);
  assert.equal(fs.existsSync(legacyPath), false);
  assert.equal(fs.existsSync(alternatePath), false);
  assert.equal(fs.readFileSync(regularPath, 'utf8'), 'keep me');
});

test('does not overwrite a regular file in the SwiftBar plugin directory', () => {
  const pluginDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'swiftbar-plugin-'));
  const pluginPath = path.join(pluginDirectory, 'agent-monitor.1s.sh');
  fs.writeFileSync(pluginPath, 'user content');

  const result = spawnSync('/bin/bash', [installer], {
    encoding: 'utf8',
    env: { ...process.env, SWIFTBAR_PLUGIN_DIR: pluginDirectory },
  });

  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(pluginPath, 'utf8'), 'user content');
});
