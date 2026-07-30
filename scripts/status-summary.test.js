'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getMessages } = require('./i18n');
const { buildStatusSummary } = require('./status-summary');

test('orders summary by required human action before active and ready sessions', () => {
  const summary = buildStatusSummary({
    waiting: 2,
    waitingReply: 1,
    working: 3,
    ready: 4,
  }, getMessages('zh-Hans'));

  assert.deepEqual(summary, {
    emoji: '🟡',
    label: '2个等待确认 · 1个等待回复 · 3个进行中 · 4个就绪',
  });
});

test('keeps working and ready order when no session needs attention', () => {
  const summary = buildStatusSummary({ working: 1, ready: 2 }, getMessages('en'));
  assert.deepEqual(summary, {
    emoji: '🔵',
    label: '1 working · 2 ready',
  });
});
