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
    pendingKind: 'approval',
    nativeState: 'ready',
    transcriptState: 'working',
  }), 'waiting');
});

test('explicit approval overrides an unrelated active child process', () => {
  assert.equal(resolveAgentState({
    alive: true,
    pendingKind: 'approval',
    hasActiveChild: true,
    transcriptState: 'working',
  }), 'waiting');
});

test('ordinary pending tool remains working without a process snapshot', () => {
  assert.equal(resolveAgentState({
    alive: true,
    pendingKind: 'running',
    nativeState: 'ready',
    transcriptState: 'working',
  }), 'working');
});

test('active child process remains working for an ordinary pending tool', () => {
  assert.equal(resolveAgentState({
    alive: true,
    pendingKind: 'running',
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
