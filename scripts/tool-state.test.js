'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getClaudeReplyRequestInLines,
  getClaudeTaskStateInLines,
  getCodexContextUsageInLines,
  getCodexTaskStateInLines,
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
  assert.equal(getCodexTaskStateInLines(lines([
    { type: 'event_msg', payload: { type: 'task_started' } },
    { type: 'event_msg', payload: { type: 'task_complete' } },
  ])), 'ready');
  assert.equal(getCodexTaskStateInLines(lines([
    { type: 'event_msg', payload: { type: 'task_complete' } },
    { type: 'event_msg', payload: { type: 'task_started' } },
  ])), 'working');
});

test('advances Codex task state incrementally from parsed events', () => {
  assert.equal(getCodexTaskStateInLines([
    { type: 'response_item', payload: { type: 'reasoning' } },
  ], 'ready'), 'working');
  assert.equal(getCodexTaskStateInLines([
    { type: 'event_msg', payload: { type: 'task_complete' } },
  ], 'working'), 'ready');
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

test('detects a terminal Claude question until the next human reply', () => {
  const question = [
    {
      type: 'assistant',
      message: {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '**要升级到最新版吗？** \u{1F4AC}' }],
      },
    },
    { type: 'system', subtype: 'turn_duration' },
  ];
  assert.equal(getClaudeReplyRequestInLines(question), true);
  assert.equal(getClaudeReplyRequestInLines([
    ...question,
    { type: 'user', origin: { kind: 'human' }, message: { content: '可以' } },
  ]), false);
});

test('does not treat a declarative Claude final response as waiting for reply', () => {
  assert.equal(getClaudeReplyRequestInLines([{
    type: 'assistant',
    message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '升级已经完成。' }] },
  }]), false);
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

test('classifies an ordinary pending Codex exec as running', () => {
  const transcript = lines([
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'call-1',
        input: 'const r = await tools.exec_command({ cmd: "git status" });',
      },
    },
  ]);
  assert.equal(getPendingToolUseKindInLines(transcript), 'running');
});

test('classifies pending Codex require_escalated exec as approval', () => {
  const transcript = lines([
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'call-1',
        input: `const r = await tools.exec_command({
          cmd: "brew install terminal-notifier",
          sandbox_permissions: "require_escalated",
          justification: "Allow installation?",
        });`,
      },
    },
  ]);
  assert.equal(getPendingToolUseKindInLines(transcript), 'approval');
});

test('does not treat require_escalated text inside a command string as approval', () => {
  const transcript = lines([
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'call-1',
        input: `const r = await tools.exec_command({
          cmd: "rg -n 'sandbox_permissions: \\\"require_escalated\\\"' scripts",
        });`,
      },
    },
  ]);
  assert.equal(getPendingToolUseKindInLines(transcript), 'running');
});

test('detects require_escalated in structured and JSON-encoded arguments', () => {
  assert.equal(getPendingToolUseKindInLines(lines([
    {
      type: 'function_call',
      name: 'exec_command',
      call_id: 'call-1',
      arguments: JSON.stringify({ sandbox_permissions: 'require_escalated' }),
    },
  ])), 'approval');

  assert.equal(getPendingToolUseKindInLines(lines([
    {
      type: 'tool_use',
      name: 'exec_command',
      id: 'call-2',
      input: { sandbox_permissions: 'require_escalated' },
    },
  ])), 'approval');
});

test('completed escalated exec is not pending', () => {
  const transcript = lines([
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'call-1',
        input: 'tools.exec_command({ sandbox_permissions: "require_escalated" })',
      },
    },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'call-1' } },
  ]);
  assert.equal(getPendingToolUseKindInLines(transcript), 'none');
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
