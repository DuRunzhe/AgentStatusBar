'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectCodexTerminalState,
  parseTerminalTabs,
  probeTerminalTabs,
  readFreshTerminalSnapshot,
  writeSnapshotAtomic,
} = require('./terminal-prompt-state');
const fs = require('fs');
const os = require('os');
const path = require('path');

const approvalPrompt = `
  Would you like to make the following edits?

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for these files (a)
  3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
`;

test('detects an active Codex approval prompt at the terminal bottom', () => {
  assert.equal(detectCodexTerminalState(approvalPrompt), 'approval');
});

test('accepts command approval wording without depending on exact option text', () => {
  assert.equal(detectCodexTerminalState(`
Would you like to run the following command?
› 1. Yes, allow once
  2. No, continue without running it
Press enter to confirm or esc to cancel
`), 'approval');
});

test('ignores old approval text when newer terminal output follows it', () => {
  assert.equal(detectCodexTerminalState(`${approvalPrompt}\n• Continuing work`), null);
});

test('does not classify ordinary terminal output or reply questions as approval', () => {
  assert.equal(detectCodexTerminalState('Installing package...'), null);
  assert.equal(detectCodexTerminalState(`
Would you like to continue?
1. Minimal fix
2. Full fix
Press enter to submit or esc to cancel
`), null);
});

test('parses only matching TTY records', () => {
  const output = `running\x1d/dev/ttys016\x1f${approvalPrompt}\x1e/dev/ttys002\x1f${approvalPrompt}\x1e`;
  assert.deepEqual(parseTerminalTabs(output, ['/dev/ttys016']), {
    terminalRunning: true,
    states: [{ tty: '/dev/ttys016', state: 'approval' }],
  });
});

test('does not launch or scan Terminal when it is not running', () => {
  assert.deepEqual(parseTerminalTabs('not_running\x1d', ['/dev/ttys016']), {
    terminalRunning: false,
    states: [],
  });
});

test('records probe failures for diagnostics', () => {
  const snapshot = probeTerminalTabs(['/dev/ttys016'], () => ({
    status: null,
    error: new Error('timed out'),
    stdout: '',
  }));
  assert.equal(snapshot.ok, false);
  assert.match(snapshot.error, /timed out/);
  assert.deepEqual(snapshot.targetTtys, ['/dev/ttys016']);
});

test('reads only successful and fresh terminal snapshots', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-state-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  writeSnapshotAtomic(snapshotPath, {
    version: 1,
    ok: true,
    updatedAtMs: 1000,
    states: { '/dev/ttys016': 'approval' },
  });
  assert.equal(readFreshTerminalSnapshot(snapshotPath, 4000)?.states['/dev/ttys016'], 'approval');
  assert.equal(readFreshTerminalSnapshot(snapshotPath, 7000), null);
  writeSnapshotAtomic(snapshotPath, { version: 1, ok: false, updatedAtMs: 7000, states: {} });
  assert.equal(readFreshTerminalSnapshot(snapshotPath, 7000), null);
});
