'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectTerminalApp,
  parseTtyFromLsof,
} = require('./focus-agent-session');

test('extracts an agent TTY from lsof field output', () => {
  assert.equal(parseTtyFromLsof('p123\nf0\nn/dev/ttys016\nf1\nn/dev/ttys016\n'), '/dev/ttys016');
  assert.equal(parseTtyFromLsof('p123\nf0\nn/dev/null\n'), null);
});

test('detects terminal applications from process ancestry', () => {
  assert.equal(detectTerminalApp([
    'claude',
    '/Applications/Warp.app/Contents/MacOS/Warp',
  ]), 'Warp');
  assert.equal(detectTerminalApp([
    'codex',
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  ]), 'Visual Studio Code');
  assert.equal(detectTerminalApp(['codex', '/bin/zsh']), null);
});
