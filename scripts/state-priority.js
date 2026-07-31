'use strict';

function resolveAgentState({
  alive,
  pendingKind = null,
  nativeState = null,
  hasActiveChild = false,
  transcriptState = null,
  replyRequested = false,
}) {
  if (!alive) return 'stopped';
  if (pendingKind === 'user_input') return 'waiting_reply';
  if (pendingKind === 'approval') return 'waiting';
  if (nativeState === 'waiting') return 'waiting';
  if (nativeState === 'working') return 'working';
  if (replyRequested) return 'waiting_reply';
  if (hasActiveChild) return 'working';
  if (pendingKind === 'running') return 'working';
  if (transcriptState === 'working') return 'working';
  if (nativeState === 'ready') return 'ready';
  if (transcriptState === 'ready') return 'ready';
  if (pendingKind === 'none') return 'ready';
  return null;
}

module.exports = { resolveAgentState };
