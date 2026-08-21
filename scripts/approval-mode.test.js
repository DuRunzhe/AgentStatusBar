'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAutomaticConfirmationMode,
  shouldNotifyForInstance,
} = require('./approval-mode');

test('recognizes explicit Codex automatic approval modes from runtime metadata', () => {
  assert.equal(isAutomaticConfirmationMode('Codex', { approvalPolicy: 'never' }), true);
  assert.equal(isAutomaticConfirmationMode('Codex', {
    approvalPolicy: 'on-request', approvalsReviewer: 'auto_review',
  }), true);
  assert.equal(isAutomaticConfirmationMode('Codex', {
    approvalPolicy: 'on-request', approvalsReviewer: 'user',
  }), false);
  assert.equal(isAutomaticConfirmationMode('Claude', { approvalPolicy: 'never' }), false);
  assert.equal(isAutomaticConfirmationMode('Codex', null), false);
});

test('applies each notification preference only to its matching attention state', () => {
  assert.equal(shouldNotifyForInstance({ state: 'waiting' }, {
    notifyWaitingConfirmation: false,
  }), false);
  assert.equal(shouldNotifyForInstance({ state: 'waiting_reply' }, {
    notifyWaitingReply: false,
  }), false);
  assert.equal(shouldNotifyForInstance({ state: 'waiting_reply' }, {
    notifyWaitingConfirmation: false,
  }), true);
});

test('suppresses only automatic-confirmation waiting alerts when that option is disabled', () => {
  const config = { showWaitingNotificationsInAutoConfirmMode: false };
  assert.equal(shouldNotifyForInstance({ state: 'waiting', automatic_confirmation_mode: true }, config), false);
  assert.equal(shouldNotifyForInstance({ state: 'waiting', automatic_confirmation_mode: false }, config), true);
  assert.equal(shouldNotifyForInstance({ state: 'waiting_reply', automatic_confirmation_mode: true }, config), true);
  assert.equal(shouldNotifyForInstance({ state: 'waiting', automatic_confirmation_mode: true }, {}), true);
});
