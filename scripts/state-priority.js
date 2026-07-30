'use strict';

function resolveAgentState({
  alive,
  pendingKind = null,
  nativeState = null,
  hasActiveChild = false,
  transcriptState = null,
}) {
  if (!alive) return 'stopped';
  if (pendingKind === 'user_input') return 'waiting_reply';
  if (nativeState === 'waiting') return 'waiting';
  if (nativeState === 'working') return 'working';
  if (hasActiveChild) return 'working';
  if (pendingKind === 'tool') return 'waiting';
  if (transcriptState === 'working') return 'working';
  if (nativeState === 'ready') return 'ready';
  if (transcriptState === 'ready') return 'ready';
  if (pendingKind === 'none') return 'ready';
  return null;
}

module.exports = { resolveAgentState };
