'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAgentState } = require('./state-priority');

test('transcript activity overrides stale native ready state', () => {
  assert.equal(resolveAgentState({
    alive: true,
    pendingKind: 'none',
    nativeState: 'ready',
    transcriptState: 'working',
  }), 'working');
});

test('pending tool approval overrides stale native ready state', () => {
  assert.equal(resolveAgentState({
    alive: true,
    pendingKind: 'tool',
    nativeState: 'ready',
    transcriptState: 'working',
  }), 'waiting');
});

test('active child process wins over unmatched executable tool event', () => {
  assert.equal(resolveAgentState({
    alive: true,
    pendingKind: 'tool',
    nativeState: 'ready',
    hasActiveChild: true,
    transcriptState: 'working',
  }), 'working');
});

test('structured user input remains the highest priority live state', () => {
  assert.equal(resolveAgentState({
    alive: true,
    pendingKind: 'user_input',
    nativeState: 'working',
    hasActiveChild: true,
    transcriptState: 'working',
  }), 'waiting_reply');
});

test('terminal Claude question overrides idle transcript state', () => {
  assert.equal(resolveAgentState({
    alive: true,
    pendingKind: 'none',
    nativeState: 'ready',
    transcriptState: 'ready',
    replyRequested: true,
  }), 'waiting_reply');
});
