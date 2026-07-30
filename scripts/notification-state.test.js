'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceWaitingNotification } = require('./notification-state');

test('notifies immediately when an instance enters waiting', () => {
  const result = advanceWaitingNotification(null, 'waiting', 1000);
  assert.equal(result.reminderStage, 0);
  assert.deepEqual(result.tracker, {
    previousState: 'waiting',
    waitingSince: 1000,
    remindersSent: 1,
  });
});

test('reminds once at 60 seconds and once at 3 minutes', () => {
  let tracker = advanceWaitingNotification(null, 'waiting', 1000).tracker;

  let result = advanceWaitingNotification(tracker, 'waiting', 60_999);
  assert.equal(result.reminderStage, null);

  result = advanceWaitingNotification(result.tracker, 'waiting', 61_000);
  assert.equal(result.reminderStage, 1);
  tracker = result.tracker;

  result = advanceWaitingNotification(tracker, 'waiting', 181_000);
  assert.equal(result.reminderStage, 2);

  result = advanceWaitingNotification(result.tracker, 'waiting', 600_000);
  assert.equal(result.reminderStage, null);
});

test('skips stale intermediate reminders after a long polling gap', () => {
  const tracker = advanceWaitingNotification(null, 'waiting', 1000).tracker;
  const result = advanceWaitingNotification(tracker, 'waiting', 181_000);
  assert.equal(result.reminderStage, 2);
  assert.equal(result.tracker.remindersSent, 3);
});

test('resets reminders after leaving waiting', () => {
  const waiting = advanceWaitingNotification(null, 'waiting', 1000).tracker;
  const ready = advanceWaitingNotification(waiting, 'ready', 2000);
  assert.equal(ready.reminderStage, null);
  assert.equal(ready.tracker.waitingSince, null);

  const waitingAgain = advanceWaitingNotification(ready.tracker, 'waiting', 3000);
  assert.equal(waitingAgain.reminderStage, 0);
  assert.equal(waitingAgain.tracker.waitingSince, 3000);
});

test('uses the same reminder schedule while waiting for a reply', () => {
  let result = advanceWaitingNotification(null, 'waiting_reply', 1000);
  assert.equal(result.reminderStage, 0);
  assert.equal(result.tracker.previousState, 'waiting_reply');

  result = advanceWaitingNotification(result.tracker, 'waiting_reply', 61_000);
  assert.equal(result.reminderStage, 1);
});

test('notifies again when the required human action changes', () => {
  const waiting = advanceWaitingNotification(null, 'waiting', 1000).tracker;
  const reply = advanceWaitingNotification(waiting, 'waiting_reply', 2000);
  assert.equal(reply.reminderStage, 0);
  assert.equal(reply.tracker.previousState, 'waiting_reply');
});
