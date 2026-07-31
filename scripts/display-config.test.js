'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_DISPLAY_CONFIG,
  normalizeDisplayConfig,
  readDisplayConfig,
  setNotificationsEnabled,
  toggleDisplayConfig,
} = require('./display-config');

test('uses enabled defaults when display config is missing', () => {
  assert.deepEqual(readDisplayConfig('/missing/agent-statusbar-config.json'), {
    ...DEFAULT_DISPLAY_CONFIG,
  });
});

test('accepts only known boolean display settings', () => {
  assert.deepEqual(normalizeDisplayConfig({
    duration: false,
    model: 'false',
    unknown: false,
  }), {
    ...DEFAULT_DISPLAY_CONFIG,
    duration: false,
  });
});

test('toggles and persists a display setting', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-config-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, 'nested', 'config.json');

  assert.equal(toggleDisplayConfig('model', configFile).model, false);
  assert.equal(readDisplayConfig(configFile).model, false);
  assert.equal(toggleDisplayConfig('model', configFile).model, true);
});

test('rejects unknown display settings', () => {
  assert.throws(() => toggleDisplayConfig('unknown', '/tmp/unused-config.json'));
});

test('notifications are disabled by default and persist independently', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-notification-config-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, 'config.json');

  assert.equal(readDisplayConfig(configFile).notifications, false);
  assert.equal(setNotificationsEnabled(true, configFile).notifications, true);
  assert.equal(readDisplayConfig(configFile).model, true);
  assert.equal(setNotificationsEnabled(false, configFile).notifications, false);
});
