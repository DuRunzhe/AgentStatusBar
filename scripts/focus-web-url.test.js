'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBrowserFocusScript,
  focusWebUrl,
  normalizeLocalUrl,
} = require('./focus-web-url');

test('normalizes only local http URLs', () => {
  assert.equal(normalizeLocalUrl('http://127.0.0.1:3080/path?q=1'), 'http://127.0.0.1:3080/');
  assert.equal(normalizeLocalUrl('http://localhost:5173/'), 'http://127.0.0.1:5173/');
  assert.equal(normalizeLocalUrl('https://127.0.0.1:3080/'), null);
  assert.equal(normalizeLocalUrl('http://example.com:3080/'), null);
});

test('builds a browser focus script for an existing local tab', () => {
  const script = buildBrowserFocusScript('http://127.0.0.1:3080/');
  assert.match(script, /Google Chrome/);
  assert.match(script, /Safari/);
  assert.match(script, /http:\/\/127\.0\.0\.1:3080\//);
  assert.match(script, /activeTabIndex = tabIndex \+ 1/);
  assert.doesNotMatch(script, /active tab index/);
});

test('opens the URL directly when tab reuse is disabled, even if a browser is running', () => {
  let opened = null;
  const ok = focusWebUrl('http://127.0.0.1:3080/', {
    reuseTabs: false,
    activateBrowser: () => true,
    openUrl: url => { opened = url; return true; },
  });
  assert.equal(ok, true);
  assert.equal(opened, 'http://127.0.0.1:3080/');
});

test('skips tab focus entirely when tab reuse is disabled', () => {
  let focused = false;
  focusWebUrl('http://127.0.0.1:3080/', {
    reuseTabs: false,
    focusTab: () => { focused = true; return { focused: true }; },
    openUrl: () => true,
  });
  assert.equal(focused, false);
});

test('focuses an existing tab when reuse is enabled', () => {
  let opened = null;
  const ok = focusWebUrl('http://127.0.0.1:3080/', {
    reuseTabs: true,
    focusTab: () => ({ focused: true, automationDenied: false }),
    openUrl: url => { opened = url; return true; },
  });
  assert.equal(ok, true);
  assert.equal(opened, null);
});

test('opens a new tab when reuse finds no existing tab', () => {
  let opened = null;
  const ok = focusWebUrl('http://127.0.0.1:3080/', {
    reuseTabs: true,
    focusTab: () => ({ focused: false, automationDenied: false }),
    openUrl: url => { opened = url; return true; },
  });
  assert.equal(ok, true);
  assert.equal(opened, 'http://127.0.0.1:3080/');
});

test('activates the browser instead of duplicating a tab when automation is denied', () => {
  let opened = null;
  let activated = false;
  const ok = focusWebUrl('http://127.0.0.1:3080/', {
    reuseTabs: true,
    focusTab: () => ({ focused: false, automationDenied: true }),
    activateBrowser: () => { activated = true; return true; },
    openUrl: url => { opened = url; return true; },
  });
  assert.equal(ok, true);
  assert.equal(activated, true);
  assert.equal(opened, null);
});

test('rejects non-local URLs before attempting to open', () => {
  let opened = null;
  const ok = focusWebUrl('https://example.com/', {
    reuseTabs: true,
    focusTab: () => ({ focused: false, automationDenied: false }),
    openUrl: url => { opened = url; return true; },
  });
  assert.equal(ok, false);
  assert.equal(opened, null);
});
