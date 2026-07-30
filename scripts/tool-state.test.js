'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasPendingToolUseInLines } = require('./tool-state');

function lines(events) {
  return events.map(event => JSON.stringify(event));
}

test('completed tool use is not pending', () => {
  assert.equal(hasPendingToolUseInLines(lines([
    { type: 'tool_use', id: 'tool-1' },
    { type: 'tool_result', tool_use_id: 'tool-1' },
  ])), false);
});

test('tool use without a matching result is pending', () => {
  assert.equal(hasPendingToolUseInLines(lines([
    { type: 'tool_use', id: 'tool-1' },
  ])), true);
});

test('parallel tool uses are matched independently', () => {
  assert.equal(hasPendingToolUseInLines(lines([
    { type: 'tool_use', id: 'tool-1' },
    { type: 'tool_use', id: 'tool-2' },
    { type: 'tool_result', tool_use_id: 'tool-1' },
  ])), true);

  assert.equal(hasPendingToolUseInLines(lines([
    { type: 'tool_use', id: 'tool-1' },
    { type: 'tool_use', id: 'tool-2' },
    { type: 'tool_result', tool_use_id: 'tool-2' },
    { type: 'tool_result', tool_use_id: 'tool-1' },
  ])), false);
});

test('result whose tool use is outside the scan window does not create pending work', () => {
  assert.equal(hasPendingToolUseInLines(lines([
    { type: 'tool_result', tool_use_id: 'older-tool' },
    { type: 'progress' },
  ])), false);
});

test('extracts tool events nested in transcript messages', () => {
  assert.equal(hasPendingToolUseInLines(lines([
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1' }] } },
  ])), false);
});

test('matches Codex function calls by call ID', () => {
  assert.equal(hasPendingToolUseInLines(lines([
    { type: 'response_item', payload: { type: 'function_call', call_id: 'call-1' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1' } },
  ])), false);
});

test('matches Codex custom tool calls by call ID', () => {
  assert.equal(hasPendingToolUseInLines(lines([
    { type: 'response_item', payload: { type: 'custom_tool_call', id: 'ctc-1', call_id: 'call-1' } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'call-1' } },
  ])), false);
});

test('uses the latest Codex task lifecycle event', () => {
  const { getCodexTaskStateInLines } = require('./tool-state');
  assert.equal(getCodexTaskStateInLines(lines([
    { type: 'event_msg', payload: { type: 'task_started' } },
    { type: 'event_msg', payload: { type: 'task_complete' } },
  ])), 'ready');
  assert.equal(getCodexTaskStateInLines(lines([
    { type: 'event_msg', payload: { type: 'task_complete' } },
    { type: 'event_msg', payload: { type: 'task_started' } },
  ])), 'working');
});

test('returns unknown when a tool event has no usable ID', () => {
  assert.equal(hasPendingToolUseInLines(lines([
    { type: 'tool_use' },
  ])), null);
});
