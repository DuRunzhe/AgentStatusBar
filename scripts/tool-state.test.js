'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getClaudeTaskStateInLines,
  getCodexContextUsageInLines,
  getPendingToolUseKindInLines,
  hasPendingToolUseInLines,
} = require('./tool-state');

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

test('treats response activity after an older task_complete as working', () => {
  const { getCodexTaskStateInLines } = require('./tool-state');
  assert.equal(getCodexTaskStateInLines(lines([
    { type: 'event_msg', payload: { type: 'task_complete' } },
    { type: 'response_item', payload: { type: 'reasoning' } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'call-1' } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'call-1' } },
  ])), 'working');
});

test('latest task_complete settles Codex response activity to ready', () => {
  const { getCodexTaskStateInLines } = require('./tool-state');
  assert.equal(getCodexTaskStateInLines(lines([
    { type: 'response_item', payload: { type: 'reasoning' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant' } },
    { type: 'event_msg', payload: { type: 'task_complete' } },
  ])), 'ready');
});

test('treats Claude transcript activity after an older turn as working', () => {
  assert.equal(getClaudeTaskStateInLines(lines([
    { type: 'system', subtype: 'turn_duration' },
    { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'continue' } },
    { type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'thinking' }] } },
    { type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash', id: 'call-1' }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1' }] } },
  ])), 'working');
});

test('settles Claude final response to ready', () => {
  assert.equal(getClaudeTaskStateInLines(lines([
    { type: 'user', message: { role: 'user', content: 'continue' } },
    { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'thinking' }] } },
    { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } },
  ])), 'ready');
  assert.equal(getClaudeTaskStateInLines(lines([
    { type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'call-1' }] } },
    { type: 'system', subtype: 'turn_duration' },
  ])), 'ready');
});

test('extracts context usage from the latest valid Codex token count', () => {
  assert.deepEqual(getCodexContextUsageInLines(lines([
    { type: 'event_msg', payload: { type: 'token_count', info: null } },
    {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          model_context_window: 258400,
          last_token_usage: { total_tokens: 180084 },
          total_token_usage: { total_tokens: 15535156 },
        },
      },
    },
  ])), {
    used_tokens: 180084,
    window_tokens: 258400,
    percent: 69.7,
  });
});

test('returns no context usage when token count data is unavailable', () => {
  assert.equal(getCodexContextUsageInLines(lines([
    { type: 'event_msg', payload: { type: 'token_count', info: null } },
  ])), null);
});

test('returns unknown when a tool event has no usable ID', () => {
  assert.equal(hasPendingToolUseInLines(lines([
    { type: 'tool_use' },
  ])), null);
});

test('classifies pending Codex request_user_input as user input', () => {
  const transcript = lines([
    { type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: 'question-1' } },
  ]);
  assert.equal(getPendingToolUseKindInLines(transcript), 'user_input');
});

test('classifies pending Claude AskUserQuestion as user input', () => {
  const transcript = lines([
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', id: 'question-1' }] } },
  ]);
  assert.equal(getPendingToolUseKindInLines(transcript), 'user_input');
});

test('completed user input request is not pending', () => {
  const transcript = lines([
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', id: 'question-1' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'question-1' }] } },
  ]);
  assert.equal(getPendingToolUseKindInLines(transcript), 'none');
});
