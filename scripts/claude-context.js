'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONTEXT_DIR = '/tmp/agent-statusbar-claude-context';

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function isSafeSessionId(sessionId) {
  return typeof sessionId === 'string' && /^[A-Za-z0-9_-]+$/.test(sessionId);
}

function getContextUsage(contextWindow) {
  if (!contextWindow || typeof contextWindow !== 'object') return null;

  const usedTokens = contextWindow.total_input_tokens;
  const windowTokens = contextWindow.context_window_size;
  if (!isFiniteNonNegative(usedTokens) || !Number.isFinite(windowTokens) || windowTokens <= 0) {
    return null;
  }

  const suppliedPercent = contextWindow.used_percentage;
  const percent = isFiniteNonNegative(suppliedPercent)
    ? suppliedPercent
    : Math.round((usedTokens / windowTokens) * 1000) / 10;

  return {
    used_tokens: usedTokens,
    window_tokens: windowTokens,
    percent,
  };
}

function getStatusLineModel(model) {
  if (typeof model === 'string') return model || null;
  if (!model || typeof model !== 'object') return null;
  return model.display_name || model.id || null;
}

function parseClaudeStatusLinePayload(payload, capturedAt = Date.now()) {
  if (!payload || typeof payload !== 'object' || !isSafeSessionId(payload.session_id)) {
    return null;
  }

  return {
    session_id: payload.session_id,
    transcript_path: typeof payload.transcript_path === 'string' ? payload.transcript_path : null,
    cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
    captured_at: capturedAt,
    model: getStatusLineModel(payload.model),
    context_usage: getContextUsage(payload.context_window),
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getClaudeSessionInfo(pid, homeDir = process.env.HOME) {
  if (!Number.isInteger(pid) || pid <= 0 || !homeDir) return null;
  const sessionFile = path.join(homeDir, '.claude', 'sessions', `${pid}.json`);
  const session = readJson(sessionFile);
  if (!session || session.pid !== pid || !isSafeSessionId(session.sessionId)) return null;

  return {
    session_id: session.sessionId,
    cwd: typeof session.cwd === 'string' ? session.cwd : null,
    status: typeof session.status === 'string' ? session.status : null,
    waiting_for: typeof session.waitingFor === 'string' ? session.waitingFor : null,
  };
}

function getClaudeNativeState(runtime) {
  const status = runtime?.status?.toLowerCase();
  if (status === 'waiting') return 'waiting';
  if (status === 'busy' || status === 'working' || status === 'running') return 'working';
  if (status === 'idle' || status === 'ready') return 'ready';
  return null;
}

function getClaudeContextSnapshot(sessionId, contextDir = DEFAULT_CONTEXT_DIR) {
  if (!isSafeSessionId(sessionId)) return null;
  const snapshot = readJson(path.join(contextDir, `${sessionId}.json`));
  if (!snapshot || snapshot.session_id !== sessionId) return null;
  return snapshot;
}

function getClaudeRuntimeForPid(
  pid,
  { homeDir = process.env.HOME, contextDir = DEFAULT_CONTEXT_DIR } = {}
) {
  const session = getClaudeSessionInfo(pid, homeDir);
  if (!session) return null;
  const snapshot = getClaudeContextSnapshot(session.session_id, contextDir);

  return {
    ...session,
    cwd: snapshot?.cwd || session.cwd,
    transcript_path: snapshot?.transcript_path || null,
    model: snapshot?.model || null,
    context_usage: snapshot?.context_usage || null,
  };
}

module.exports = {
  DEFAULT_CONTEXT_DIR,
  getClaudeContextSnapshot,
  getClaudeNativeState,
  getClaudeRuntimeForPid,
  getClaudeSessionInfo,
  parseClaudeStatusLinePayload,
};
