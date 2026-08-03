'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getStatusPublication,
  shouldPublishStatus,
} = require('./status-publication');

function status({
  timestamp = '2026-08-03T04:00:01.000Z',
  state = 'working',
  uptime = 65,
  lastActivity = 1000,
  percent = 10,
} = {}) {
  return {
    timestamp,
    summary: state,
    detail: [`last activity ${lastActivity}`],
    display_config: {},
    agents: [{
      name: 'Codex',
      instances: [{
        state,
        pids: [42],
        uptime_sec: uptime,
        last_activity_ms_ago: lastActivity,
        context_usage: { used_tokens: 1000, window_tokens: 10000, percent },
      }],
    }],
  };
}

test('ignores second-level timestamps, uptime and activity changes', () => {
  const first = getStatusPublication(status(), 1000);
  const second = getStatusPublication(status({
    timestamp: '2026-08-03T04:00:59.000Z',
    uptime: 119,
    lastActivity: 59000,
  }), 2000);

  assert.equal(second.signature, first.signature);
  assert.equal(shouldPublishStatus(first, second), false);
});

test('publishes immediately when a visible semantic field changes', () => {
  const first = getStatusPublication(status(), 1000);
  const stateChanged = getStatusPublication(status({ state: 'waiting' }), 2000);
  const contextChanged = getStatusPublication(status({ percent: 11 }), 2000);

  assert.equal(shouldPublishStatus(first, stateChanged), true);
  assert.equal(shouldPublishStatus(first, contextChanged), true);
});

test('publishes at a minute boundary even when semantic data is unchanged', () => {
  const first = getStatusPublication(status(), 59_999);
  const second = getStatusPublication(status(), 60_000);

  assert.equal(first.signature, second.signature);
  assert.equal(shouldPublishStatus(first, second), true);
});

test('publishes when the status file is missing', () => {
  const publication = getStatusPublication(status(), 1000);
  assert.equal(shouldPublishStatus(publication, publication, false), true);
});
