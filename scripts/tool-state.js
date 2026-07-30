'use strict';

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

function collectToolEvents(value, events) {
  if (!value || typeof value !== 'object') return;

  if (value.type === 'tool_use' || value.type === 'function_call' || value.type === 'custom_tool_call') {
    events.push({ type: 'tool_use', id: getToolEventId(value) });
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

/**
 * Returns true when at least one tool_use in the scanned window has no matching
 * tool_result. A result whose use fell outside the window is harmless because
 * matching is based on IDs rather than event counts.
 */
function hasPendingToolUseInLines(lines) {
  const toolUses = new Set();
  const toolResults = new Set();

  for (const line of lines) {
    const events = [];
    collectToolEvents(JSON.parse(line), events);

    for (const event of events) {
      if (event.id == null || event.id === '') return null;
      const id = String(event.id);
      if (event.type === 'tool_use') toolUses.add(id);
      if (event.type === 'tool_result') toolResults.add(id);
    }
  }

  for (const id of toolUses) {
    if (!toolResults.has(id)) return true;
  }
  return false;
}

function getCodexTaskStateInLines(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const event = JSON.parse(lines[i]);
    if (event.type !== 'event_msg') continue;
    if (event.payload?.type === 'task_complete') return 'ready';
    if (event.payload?.type === 'task_started') return 'working';
  }
  return null;
}

function getCodexContextUsageInLines(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const event = JSON.parse(lines[i]);
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
  getCodexContextUsageInLines,
  getCodexTaskStateInLines,
  hasPendingToolUseInLines,
};
