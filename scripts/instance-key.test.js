'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getInstanceTrackerKey } = require('./instance-key');

test('gives same-label live instances distinct tracker keys by PID', () => {
  const first = getInstanceTrackerKey('Codex', {
    label: 'Codex (AgentStatusBar)',
    pids: [34088],
  });
  const second = getInstanceTrackerKey('Codex', {
    label: 'Codex (AgentStatusBar)',
    pids: [22284],
  });

  assert.notEqual(first, second);
});

test('keeps a multi-PID tracker key stable when PID order changes', () => {
  assert.equal(
    getInstanceTrackerKey('Codex', { label: 'Codex', pids: [42, 7] }),
    getInstanceTrackerKey('Codex', { label: 'Codex', pids: [7, 42] })
  );
});

test('falls back to the label when an instance has no live PID', () => {
  assert.equal(
    getInstanceTrackerKey('Claude', { label: 'Claude', pids: [] }),
    'Claude:label:Claude'
  );
});
