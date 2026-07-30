'use strict';

const WAITING_REMINDER_DELAYS_MS = [0, 60_000, 180_000];
const ATTENTION_STATES = new Set(['waiting', 'waiting_reply']);

function advanceWaitingNotification(tracker, state, now) {
  const current = tracker || {
    previousState: 'stopped',
    waitingSince: null,
    remindersSent: 0,
  };

  if (!ATTENTION_STATES.has(state)) {
    return {
      tracker: {
        previousState: state,
        waitingSince: null,
        remindersSent: 0,
      },
      reminderStage: null,
    };
  }

  if (current.previousState !== state || !Number.isFinite(current.waitingSince)) {
    return {
      tracker: {
        previousState: state,
        waitingSince: now,
        remindersSent: 1,
      },
      reminderStage: 0,
    };
  }

  const elapsed = Math.max(0, now - current.waitingSince);
  let dueStage = 0;
  for (let stage = 1; stage < WAITING_REMINDER_DELAYS_MS.length; stage++) {
    if (elapsed >= WAITING_REMINDER_DELAYS_MS[stage]) dueStage = stage;
  }

  if (dueStage >= current.remindersSent) {
    return {
      tracker: {
        ...current,
        previousState: state,
        remindersSent: dueStage + 1,
      },
      reminderStage: dueStage,
    };
  }

  return {
    tracker: { ...current, previousState: state },
    reminderStage: null,
  };
}

module.exports = {
  WAITING_REMINDER_DELAYS_MS,
  advanceWaitingNotification,
};
