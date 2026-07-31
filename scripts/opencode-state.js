'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { textEndsWithQuestion } = require('./tool-state');

const DEFAULT_SQLITE = '/usr/bin/sqlite3';
const DEFAULT_MODEL_CATALOG = path.join(os.homedir(), '.cache', 'opencode', 'models.json');
const RUNTIME_CACHE = new Map();

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 80) : null;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getModelIdentity(sessionModel, messageData) {
  const session = parseJson(sessionModel);
  const message = parseJson(messageData);
  const messageModel = message?.model
    || (message?.modelID != null || message?.id != null ? message : null);
  const model = messageModel || session;
  const modelId = normalizeText(model?.modelID ?? model?.id);
  if (!modelId) return { providerId: null, modelId: null };
  const providerId = normalizeText(model?.providerID);
  return { providerId, modelId };
}

function getModelName(sessionModel, messageData) {
  const { providerId, modelId } = getModelIdentity(sessionModel, messageData);
  if (!modelId) return null;
  return normalizeText(providerId ? `${providerId}/${modelId}` : modelId);
}

function getContextUsage(messageData, modelCatalog, sessionModel = null) {
  const message = parseJson(messageData);
  const usedTokens = Number(message?.tokens?.total);
  const { providerId, modelId } = getModelIdentity(sessionModel, messageData);
  const windowTokens = Number(modelCatalog?.[providerId]?.models?.[modelId]?.limit?.context);
  if (!Number.isFinite(usedTokens) || usedTokens < 0
      || !Number.isFinite(windowTokens) || windowTokens <= 0) {
    return null;
  }
  return {
    used_tokens: usedTokens,
    window_tokens: windowTokens,
    percent: Number(((usedTokens / windowTokens) * 100).toFixed(1)),
  };
}

function getStateFromMessage(messageData, assistantText = null) {
  const message = parseJson(messageData);
  if (!message) return 'ready';
  if (message.role === 'user') return 'working';
  if (message.role !== 'assistant') return 'ready';
  if (message.time?.completed == null) return 'working';
  if (message.finish === 'tool-calls') return 'working';
  if (textEndsWithQuestion(assistantText)) return 'waiting_reply';
  return 'ready';
}

function parseOpenCodeRuntimeRows(rows, modelCatalog = null) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  return {
    state: getStateFromMessage(row.message_data, row.assistant_text),
    model: getModelName(row.session_model, row.assistant_data),
    contextUsage: getContextUsage(row.assistant_data, modelCatalog, row.session_model),
    lastActivityMs: Number(row.message_created || row.session_updated) || null,
    sessionId: row.session_id || null,
  };
}

function getFileMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function getRuntimeSignature(databasePath, modelCatalogPath) {
  return `${getFileMtime(databasePath)}:${getFileMtime(`${databasePath}-wal`)}:${getFileMtime(modelCatalogPath)}`;
}

function escapeSql(value) {
  return String(value).replaceAll("'", "''");
}

function readModelCatalog(modelCatalogPath) {
  try {
    return JSON.parse(fs.readFileSync(modelCatalogPath, 'utf8'));
  } catch {
    return null;
  }
}

function queryOpenCodeRuntime(
  databasePath,
  cwd,
  sqlitePath = DEFAULT_SQLITE,
  modelCatalogPath = DEFAULT_MODEL_CATALOG
) {
  if (!fs.existsSync(databasePath) || !fs.existsSync(sqlitePath)) return null;
  const directory = escapeSql(cwd);
  const sql = `
    WITH latest_session AS (
      SELECT id, model, time_updated
      FROM session
      WHERE directory = '${directory}'
        AND parent_id IS NULL
        AND time_archived IS NULL
      ORDER BY time_updated DESC
      LIMIT 1
    ), latest_message AS (
      SELECT message.data, message.time_created
      FROM message
      JOIN latest_session ON latest_session.id = message.session_id
      ORDER BY message.time_created DESC, message.id DESC
      LIMIT 1
    ), latest_assistant AS (
      SELECT message.id, message.data
      FROM message
      JOIN latest_session ON latest_session.id = message.session_id
      WHERE json_extract(message.data, '$.role') = 'assistant'
      ORDER BY message.time_created DESC, message.id DESC
      LIMIT 1
    ), latest_assistant_text AS (
      SELECT json_extract(part.data, '$.text') AS text
      FROM part
      JOIN latest_assistant ON latest_assistant.id = part.message_id
      WHERE json_extract(part.data, '$.type') = 'text'
      ORDER BY part.time_created DESC, part.id DESC
      LIMIT 1
    )
    SELECT latest_session.id AS session_id,
           latest_session.model AS session_model,
           latest_session.time_updated AS session_updated,
           latest_message.data AS message_data,
           latest_message.time_created AS message_created,
           latest_assistant.data AS assistant_data,
           latest_assistant_text.text AS assistant_text
    FROM latest_session
    LEFT JOIN latest_message
    LEFT JOIN latest_assistant
    LEFT JOIN latest_assistant_text;
  `;
  try {
    const result = spawnSync(sqlitePath, ['-readonly', '-json', databasePath, sql], {
      encoding: 'utf8',
      timeout: 1000,
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout.trim()) return null;
    return parseOpenCodeRuntimeRows(
      JSON.parse(result.stdout),
      readModelCatalog(modelCatalogPath)
    );
  } catch {
    return null;
  }
}

function getOpenCodeRuntimeForCwd(cwd, dataDir, options = {}) {
  if (!cwd || !dataDir) return null;
  const databasePath = path.join(dataDir, 'opencode.db');
  const modelCatalogPath = options.modelCatalogPath || DEFAULT_MODEL_CATALOG;
  const signature = getRuntimeSignature(databasePath, modelCatalogPath);
  const cacheKey = `${databasePath}:${cwd}`;
  const cached = RUNTIME_CACHE.get(cacheKey);
  if (cached?.signature === signature) return cached.runtime;

  const runtime = (options.query || queryOpenCodeRuntime)(
    databasePath,
    cwd,
    options.sqlitePath || DEFAULT_SQLITE,
    modelCatalogPath
  );
  RUNTIME_CACHE.set(cacheKey, { signature, runtime });
  return runtime;
}

module.exports = {
  getContextUsage,
  getModelIdentity,
  getModelName,
  getOpenCodeRuntimeForCwd,
  getStateFromMessage,
  parseOpenCodeRuntimeRows,
  queryOpenCodeRuntime,
};
