'use strict';

function parseEvent(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function getToolEventId(event) {
  if (event.type === 'tool_use') {
    return event.id ?? event.tool_use_id ?? event.call_id;
  }
  if (event.type === 'function_call' || event.type === 'custom_tool_call') {
    return event.call_id ?? event.id;
  }
  if (event.type === 'tool_result') {
    return event.tool_use_id ?? event.id ?? event.call_id;
  }
  if (event.type === 'function_call_output' || event.type === 'custom_tool_call_output') {
    return event.call_id ?? event.id;
  }
  return null;
}

function getToolEventName(event) {
  return event.name ?? event.tool_name ?? event.function?.name ?? null;
}

function isUserInputTool(name) {
  const normalized = String(name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized === 'requestuserinput' || normalized === 'askuserquestion';
}

function collectToolEvents(value, events) {
  if (!value || typeof value !== 'object') return;

  if (value.type === 'tool_use' || value.type === 'function_call' || value.type === 'custom_tool_call') {
    events.push({ type: 'tool_use', id: getToolEventId(value), name: getToolEventName(value) });
    return;
  }
  if (value.type === 'tool_result' || value.type === 'function_call_output' || value.type === 'custom_tool_call_output') {
    events.push({ type: 'tool_result', id: getToolEventId(value) });
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectToolEvents(item, events);
    return;
  }

  for (const nested of Object.values(value)) {
    collectToolEvents(nested, events);
  }
}

function getPendingToolUseKindInLines(lines) {
  const toolUses = new Map();
  const toolResults = new Set();

  for (const line of lines) {
    const events = [];
    collectToolEvents(parseEvent(line), events);

    for (const event of events) {
      if (event.id == null || event.id === '') return null;
      const id = String(event.id);
      if (event.type === 'tool_use') toolUses.set(id, event.name);
      if (event.type === 'tool_result') toolResults.add(id);
    }
  }

  let hasPendingTool = false;
  for (const [id, name] of toolUses) {
    if (toolResults.has(id)) continue;
    if (isUserInputTool(name)) return 'user_input';
    hasPendingTool = true;
  }
  return hasPendingTool ? 'tool' : 'none';
}

/**
 * Returns true when at least one tool_use in the scanned window has no matching
 * tool_result. A result whose use fell outside the window is harmless because
 * matching is based on IDs rather than event counts.
 */
function hasPendingToolUseInLines(lines) {
  const kind = getPendingToolUseKindInLines(lines);
  return kind == null ? null : kind !== 'none';
}

function getCodexTaskStateInLines(lines, initialState = null) {
  let state = initialState;
  for (const line of lines) {
    const event = parseEvent(line);
    const payloadType = event.payload?.type;

    if (event.type === 'event_msg' && payloadType === 'task_complete') {
      state = 'ready';
      continue;
    }
    if (event.type === 'event_msg' && payloadType === 'task_started') {
      state = 'working';
      continue;
    }

    const isResponseActivity = event.type === 'response_item' && [
      'reasoning',
      'message',
      'function_call',
      'function_call_output',
      'custom_tool_call',
      'custom_tool_call_output',
    ].includes(payloadType);
    const isAgentActivity = event.type === 'event_msg' && [
      'agent_message',
      'patch_apply_end',
    ].includes(payloadType);
    if (isResponseActivity || isAgentActivity) state = 'working';
  }
  return state;
}

function getClaudeTaskStateInLines(lines, initialState = null) {
  let state = initialState;
  for (const line of lines) {
    const event = parseEvent(line);

    if (event.type === 'system' && event.subtype === 'turn_duration') {
      state = 'ready';
      continue;
    }

    if (event.type === 'user') {
      state = 'working';
      continue;
    }

    if (event.type !== 'assistant') continue;
    const content = event.message?.content;
    const hasFinalText = Array.isArray(content)
      && content.some(block => block?.type === 'text')
      && event.message?.stop_reason === 'end_turn';
    state = hasFinalText ? 'ready' : 'working';
  }
  return state;
}

function isHumanUserEvent(event) {
  if (event.type !== 'user') return false;
  if (event.origin?.kind === 'human' || event.promptSource === 'typed') return true;
  return typeof event.message?.content === 'string';
}

function textEndsWithQuestion(text) {
  return /[?？](?:[\s"'”’）)\]】}。.!！*_`~～]|\p{Extended_Pictographic}|\uFE0F)*$/u.test(
    String(text || '').trim()
  );
}

function getClaudeReplyRequestInLines(lines, initialState = false) {
  let waitingForReply = initialState;
  for (const line of lines) {
    const event = parseEvent(line);
    if (isHumanUserEvent(event)) {
      waitingForReply = false;
      continue;
    }
    if (event.type !== 'assistant' || event.message?.stop_reason !== 'end_turn') continue;

    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    const finalText = content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text.trim())
      .filter(Boolean)
      .at(-1);
    if (finalText) waitingForReply = textEndsWithQuestion(finalText);
  }
  return waitingForReply;
}

function getCodexContextUsageInLines(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const event = parseEvent(lines[i]);
    if (event.type !== 'event_msg' || event.payload?.type !== 'token_count') continue;

    const info = event.payload.info;
    const usedTokens = info?.last_token_usage?.total_tokens;
    const windowTokens = info?.model_context_window;
    if (!Number.isFinite(usedTokens) || !Number.isFinite(windowTokens) || windowTokens <= 0) {
      continue;
    }

    return {
      used_tokens: usedTokens,
      window_tokens: windowTokens,
      percent: Math.round((usedTokens / windowTokens) * 1000) / 10,
    };
  }
  return null;
}

module.exports = {
  getClaudeReplyRequestInLines,
  getClaudeTaskStateInLines,
  getCodexContextUsageInLines,
  getCodexTaskStateInLines,
  getPendingToolUseKindInLines,
  hasPendingToolUseInLines,
  isUserInputTool,
};
