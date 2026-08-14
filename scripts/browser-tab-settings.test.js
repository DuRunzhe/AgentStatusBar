'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readDisplayConfig, setBrowserTabReuseEnabled } = require('./display-config');
const {
  COPY,
  buildAutomationProbeScript,
  configureBrowserTabReuse,
  openAutomationSettings,
  probeBrowserAutomation,
} = require('./browser-tab-settings');

test('provides complete localized copy for browser tab reuse setup', () => {
  const expectedKeys = Object.keys(COPY.en).sort();
  assert.deepEqual(Object.keys(COPY['zh-Hans']).sort(), expectedKeys);
  assert.deepEqual(Object.keys(COPY['zh-Hant']).sort(), expectedKeys);

  assert.equal(COPY.en.setupTitle, 'Reuse browser tabs');
  assert.equal(COPY['zh-Hans'].setupTitle, '复用浏览器标签页');
  assert.equal(COPY['zh-Hant'].setupTitle, '重用瀏覽器分頁');
  assert.equal(COPY['zh-Hans'].successMessage, '浏览器标签页复用已开启。');
  assert.equal(COPY['zh-Hant'].successMessage, '瀏覽器分頁重用已開啟。');

  for (const [locale, copy] of Object.entries(COPY)) {
    for (const [key, value] of Object.entries(copy)) {
      assert.equal(typeof value, 'string', `${locale}.${key}`);
      assert.notEqual(value.trim(), '', `${locale}.${key}`);
    }
  }
});

test('builds an automation probe for supported browsers', () => {
  const script = buildAutomationProbeScript();
  assert.match(script, /Google Chrome/);
  assert.match(script, /URL of tabs of windows/);
});

test('opens the macOS Automation settings pane', () => {
  const calls = [];
  openAutomationSettings((command, args, options) => calls.push({ command, args, options }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/usr/bin/open');
  assert.deepEqual(calls[0].args, [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  ]);
});

test('detects denied browser automation probes', () => {
  const result = probeBrowserAutomation(() => {
    const error = new Error('denied');
    error.stderr = 'execution error: Not authorized (-1743)';
    throw error;
  });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
});

test('turns browser tab reuse off without opening settings', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-browser-tab-toggle-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, 'config.json');
  setBrowserTabReuseEnabled(true, configFile);

  const result = configureBrowserTabReuse({
    configFile,
    locale: 'en',
    run: () => { throw new Error('should not run'); },
  });
  assert.deepEqual(result, { enabled: false, reason: 'disabled' });
  assert.equal(readDisplayConfig(configFile).browserTabReuse, false);
});

test('enables browser tab reuse after a successful automation probe', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-browser-tab-enable-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, 'config.json');
  const dialogResults = ['button returned:Continue\n', 'button returned:OK\n'];

  const result = configureBrowserTabReuse({
    configFile,
    locale: 'en',
    run: command => {
      if (command === '/usr/bin/osascript') return dialogResults.shift() || 'http://127.0.0.1:3080/\n';
      return '';
    },
  });
  assert.deepEqual(result, { enabled: true, reason: 'verified' });
  assert.equal(readDisplayConfig(configFile).browserTabReuse, true);
});

test('asks the user to verify after a denied automation probe', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-browser-tab-denied-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, 'config.json');
  const dialogResults = [
    'button returned:Continue\n',
    'button returned:Granted\n',
    'button returned:OK\n',
  ];
  const calls = [];
  let osascriptCalls = 0;

  const result = configureBrowserTabReuse({
    configFile,
    locale: 'en',
    run: command => {
      calls.push(command);
      if (command === '/usr/bin/osascript') {
        osascriptCalls++;
        if (osascriptCalls === 2) {
          const error = new Error('denied');
          error.stderr = 'execution error: Not authorized (-1743)';
          throw error;
        }
        return dialogResults.shift();
      }
      return '';
    },
  });
  assert.deepEqual(result, { enabled: true, reason: 'user-verified' });
  assert.equal(calls.includes('/usr/bin/open'), true);
  assert.equal(readDisplayConfig(configFile).browserTabReuse, true);
});
