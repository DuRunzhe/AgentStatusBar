'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBrowserFocusScript,
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
