'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireProcessLock } = require('./process-lock');

test('allows only one live owner and releases its lock', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const lockFile = path.join(directory, 'monitor.pid');

  const release = acquireProcessLock(lockFile, 101, pid => pid === 101);
  assert.equal(typeof release, 'function');
  assert.equal(acquireProcessLock(lockFile, 202, pid => pid === 101), null);

  release();
  assert.equal(fs.existsSync(lockFile), false);
});

test('replaces a stale process lock', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const lockFile = path.join(directory, 'monitor.pid');
  fs.writeFileSync(lockFile, '101\n');

  const release = acquireProcessLock(lockFile, 202, () => false);
  assert.equal(typeof release, 'function');
  assert.equal(fs.readFileSync(lockFile, 'utf8'), '202\n');
  release();
});
