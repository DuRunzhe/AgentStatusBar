#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { textEndsWithQuestion } = require('./tool-state');

const DEFAULT_PI_AGENT_DIR = path.join(os.homedir(), '.pi', 'agent');
const DEFAULT_PI_SESSION_DIR = path.join(DEFAULT_PI_AGENT_DIR, 'sessions');
const DEFAULT_PI_MODELS_FILE = path.join(DEFAULT_PI_AGENT_DIR, 'models.json');
const SESSION_TAIL_BYTES = 2 * 1024 * 1024;
const SESSION_TAIL_LINES = 1000;
const MODEL_CACHE = new Map();

function encodePiProjectKey(cwd) {
  const normalized = String(cwd || '').replace(/^[\\/:]+/, '');
  return `--${normalized.replace(/[\\/:]+/g, '-')}--`;
}

function findLatestPiSessionFile(cwd, sessionDir = DEFAULT_PI_SESSION_DIR) {
  if (!cwd) return null;
  const projectDir = path.join(sessionDir, encodePiProjectKey(cwd));
  try {
    return fs.readdirSync(projectDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => path.join(projectDir, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  } catch {
    return null;
  }
}

function readFileTail(file, maxBytes = SESSION_TAIL_BYTES) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeModel(value) {
  if (typeof value !== 'string') return null;
  const model = value.replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return model ? model.slice(0, 80) : null;
}

function getPiModel(message) {
  const model = normalizeModel(message?.model);
  if (!model) return null;
  const provider = normalizeModel(message?.provider);
  return provider ? `${provider}/${model}` : model;
}

function getPiModelParts(message) {
  return {
    provider: normalizeModel(message?.provider),
    model: normalizeModel(message?.model),
  };
}

function calculateUsageTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const total = Number(usage.totalTokens);
  if (Number.isFinite(total) && total > 0) return total;
  return ['input', 'output', 'cacheRead', 'cacheWrite']
    .map(key => Number(usage[key]) || 0)
    .reduce((sum, value) => sum + value, 0);
}

function estimatePiContentTokens(content) {
  if (typeof content === 'string') return Math.ceil(content.length / 4);
  if (!Array.isArray(content)) return 0;
  return Math.ceil(content.reduce((chars, block) => {
    if (block?.type === 'text') return chars + String(block.text || '').length;
    if (block?.type === 'thinking') return chars + String(block.thinking || '').length;
    if (block?.type === 'toolCall') {
      return chars + String(block.name || '').length + JSON.stringify(block.arguments || {}).length;
    }
    if (block?.type === 'image') return chars + 4800;
    return chars;
  }, 0) / 4);
}

function estimatePiMessageTokens(message) {
  if (!message || typeof message !== 'object') return 0;
  if (message.role === 'user' || message.role === 'toolResult' || message.role === 'custom') {
    return estimatePiContentTokens(message.content);
  }
  if (message.role === 'assistant') return estimatePiContentTokens(message.content);
  if (message.role === 'bashExecution') {
    return Math.ceil((String(message.command || '').length + String(message.output || '').length) / 4);
  }
  if (message.role === 'compactionSummary' || message.role === 'branchSummary') {
    return Math.ceil(String(message.summary || '').length / 4);
  }
  return 0;
}

function readPiModels(modelsFile = DEFAULT_PI_MODELS_FILE) {
  try {
    const stat = fs.statSync(modelsFile);
    const cached = MODEL_CACHE.get(modelsFile);
    if (cached?.mtimeMs === stat.mtimeMs && cached?.size === stat.size) return cached.models;
    const models = JSON.parse(fs.readFileSync(modelsFile, 'utf8'));
    MODEL_CACHE.set(modelsFile, { mtimeMs: stat.mtimeMs, size: stat.size, models });
    return models;
  } catch {
    return null;
  }
}

function getPiContextWindow(provider, model, modelsFile = DEFAULT_PI_MODELS_FILE) {
  if (!provider || !model) return null;
  const catalog = readPiModels(modelsFile);
  const entry = catalog?.providers?.[provider]?.models?.find(item => item?.id === model);
  const value = Number(entry?.contextWindow);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getLastAssistantText(message) {
  if (!Array.isArray(message?.content)) return null;
  return message.content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text.trim())
    .filter(Boolean)
    .at(-1) || null;
}

function parsePiSessionSignals(text, { modelsFile = DEFAULT_PI_MODELS_FILE } = {}) {
  let model = null;
  let modelParts = { provider: null, model: null };
  let taskState = null;
  let replyRequested = false;
  let contextUsage = null;
  let lastUsage = null;
  let lastUsageIndex = -1;
  let latestCompactionIndex = -1;
  let latestCompactionMessageIndex = -1;
  const pendingToolCalls = new Set();
  const messages = [];
  const lines = String(text || '').trim().split('\n').slice(-SESSION_TAIL_LINES);

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry?.type === 'compaction') {
        latestCompactionIndex = messages.length;
        latestCompactionMessageIndex = messages.length;
        messages.push({ role: 'compactionSummary', summary: entry.summary || '' });
        continue;
      }
      if (entry?.type !== 'message') continue;
      const message = entry.message || {};
      messages.push(message);
      if (message.role === 'user') {
        replyRequested = false;
        continue;
      }
      if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
        pendingToolCalls.delete(message.toolCallId);
        continue;
      }
      if (message.role !== 'assistant') continue;

      model = getPiModel(message) || model;
      modelParts = getPiModelParts(message);
      const calls = Array.isArray(message.content)
        ? message.content.filter(block => block?.type === 'toolCall' && typeof block.id === 'string')
        : [];
      for (const call of calls) pendingToolCalls.add(call.id);

      if (message.stopReason === 'toolUse' || calls.length > 0) {
        taskState = 'working';
        replyRequested = false;
      } else if (['stop', 'length', 'error', 'aborted'].includes(message.stopReason)) {
        taskState = 'ready';
        replyRequested = message.stopReason === 'stop'
          && textEndsWithQuestion(getLastAssistantText(message) || '');
      }
      if (message.role === 'assistant' && message.stopReason !== 'aborted'
          && message.stopReason !== 'error' && calculateUsageTokens(message.usage) > 0) {
        lastUsage = message.usage;
        lastUsageIndex = messages.length - 1;
      }
    } catch {}
  }

  if (pendingToolCalls.size > 0) taskState = 'working';
  const contextWindow = getPiContextWindow(modelParts.provider, modelParts.model, modelsFile);
  if (lastUsage && contextWindow && latestCompactionIndex < lastUsageIndex) {
    const usageTokens = calculateUsageTokens(lastUsage);
    const trailingTokens = messages.slice(lastUsageIndex + 1)
      .reduce((sum, item) => sum + estimatePiMessageTokens(item), 0);
    const usedTokens = usageTokens + trailingTokens;
    contextUsage = {
      used_tokens: usedTokens,
      window_tokens: contextWindow,
      percent: Number(((usedTokens / contextWindow) * 100).toFixed(1)),
    };
  } else if (latestCompactionMessageIndex >= 0 && latestCompactionMessageIndex > lastUsageIndex) {
    contextUsage = { used_tokens: null, window_tokens: contextWindow, percent: null };
  }
  return { model, taskState, replyRequested, contextUsage };
}

function getPiRuntimeForCwd(cwd, {
  sessionDir = DEFAULT_PI_SESSION_DIR,
  modelsFile = DEFAULT_PI_MODELS_FILE,
  sessionFile = null,
} = {}) {
  const file = sessionFile || findLatestPiSessionFile(cwd, sessionDir);
  if (!file) return { state: null, lastActivityMs: null, sessionFile: null, model: null };
  try {
    const signals = parsePiSessionSignals(readFileTail(file), { modelsFile });
    return {
      state: signals.replyRequested ? 'waiting_reply' : signals.taskState,
      lastActivityMs: fs.statSync(file).mtimeMs,
      sessionFile: file,
      model: signals.model,
      contextUsage: signals.contextUsage,
    };
  } catch {
    return { state: null, lastActivityMs: null, sessionFile: file, model: null };
  }
}

module.exports = {
  DEFAULT_PI_SESSION_DIR,
  SESSION_TAIL_BYTES,
  encodePiProjectKey,
  findLatestPiSessionFile,
  getLastAssistantText,
  getPiModel,
  getPiRuntimeForCwd,
  parsePiSessionSignals,
  readFileTail,
};
