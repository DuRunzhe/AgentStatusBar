'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAutomaticConfirmationMode,
  shouldNotifyForInstance,
} = require('./approval-mode');

test('recognizes only an explicit Codex never-approval policy as automatic confirmation', () => {
  assert.equal(isAutomaticConfirmationMode('Codex', { approvalPolicy: 'never' }), true);
  assert.equal(isAutomaticConfirmationMode('Codex', { approvalPolicy: 'on-request' }), false);
  assert.equal(isAutomaticConfirmationMode('Claude', { approvalPolicy: 'never' }), false);
  assert.equal(isAutomaticConfirmationMode('Codex', null), false);
});

test('suppresses only automatic-confirmation waiting alerts when disabled', () => {
  const config = { showWaitingNotificationsInAutoConfirmMode: false };
  assert.equal(shouldNotifyForInstance({ state: 'waiting', automatic_confirmation_mode: true }, config), false);
  assert.equal(shouldNotifyForInstance({ state: 'waiting', automatic_confirmation_mode: false }, config), true);
  assert.equal(shouldNotifyForInstance({ state: 'waiting_reply', automatic_confirmation_mode: true }, config), true);
  assert.equal(shouldNotifyForInstance({ state: 'waiting', automatic_confirmation_mode: true }, {}), true);
});
