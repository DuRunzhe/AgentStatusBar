'use strict';

const fs = require('fs');
const path = require('path');

function normalizeModelName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 80) : null;
}

function parseEvent(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function getClaudeModelInLines(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const event = parseEvent(lines[i]);
    if (event.type !== 'assistant') continue;
    const model = normalizeModelName(event.message?.model);
    if (model) return model;
  }
  return null;
}

function getCodexModelInLines(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const event = parseEvent(lines[i]);
    if (event.type === 'turn_context') {
      const model = normalizeModelName(event.payload?.model);
      if (model) return model;
    }
    if (event.type === 'event_msg' && event.payload?.type === 'thread_settings_applied') {
      const model = normalizeModelName(event.payload.thread_settings?.model);
      if (model) return model;
    }
  }
  return null;
}

function getOpenCodeModelFromMessage(message) {
  const model = message?.model || message;
  const modelId = normalizeModelName(model?.modelID);
  if (!modelId) return null;
  const providerId = normalizeModelName(model?.providerID);
  return normalizeModelName(providerId ? `${providerId}/${modelId}` : modelId);
}

function getOpenCodeSessionId(storageFile) {
  if (typeof storageFile !== 'string') return null;
  const pathMatch = storageFile.match(/(?:^|\/)(ses_[A-Za-z0-9]+)(?:\.json|\/|$)/);
  if (pathMatch) return pathMatch[1];

  try {
    const value = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
    for (const candidate of [value.sessionID, value.sessionId, value.id]) {
      if (typeof candidate === 'string' && /^ses_[A-Za-z0-9]+$/.test(candidate)) return candidate;
    }
  } catch {}
  return null;
}

function getOpenCodeModel(storageFile, storageRoot) {
  const sessionId = getOpenCodeSessionId(storageFile);
  if (!sessionId || !storageRoot) return null;
  const messageDir = path.join(storageRoot, 'message', sessionId);

  try {
    const files = fs.readdirSync(messageDir)
      .filter(file => file.endsWith('.json'))
      .map(file => path.join(messageDir, file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const file of files.slice(0, 20)) {
      try {
        const model = getOpenCodeModelFromMessage(JSON.parse(fs.readFileSync(file, 'utf8')));
        if (model) return model;
      } catch {}
    }
  } catch {}
  return null;
}

module.exports = {
  getClaudeModelInLines,
  getCodexModelInLines,
  getOpenCodeModel,
  getOpenCodeModelFromMessage,
  getOpenCodeSessionId,
  normalizeModelName,
};
