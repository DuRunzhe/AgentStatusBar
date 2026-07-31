'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_SQLITE = '/usr/bin/sqlite3';
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

function getModelName(sessionModel, messageData) {
  const session = parseJson(sessionModel);
  const message = parseJson(messageData);
  const model = message?.model || session || message;
  const modelId = normalizeText(model?.modelID ?? model?.id);
  if (!modelId) return null;
  const providerId = normalizeText(model?.providerID);
  return normalizeText(providerId ? `${providerId}/${modelId}` : modelId);
}

function getStateFromMessage(messageData) {
  const message = parseJson(messageData);
  if (!message) return 'ready';
  if (message.role === 'user') return 'working';
  if (message.role !== 'assistant') return 'ready';
  if (message.time?.completed == null) return 'working';
  if (message.finish === 'tool-calls') return 'working';
  return 'ready';
}

function parseOpenCodeRuntimeRows(rows) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  return {
    state: getStateFromMessage(row.message_data),
    model: getModelName(row.session_model, row.message_data),
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

function getDatabaseSignature(databasePath) {
  return `${getFileMtime(databasePath)}:${getFileMtime(`${databasePath}-wal`)}`;
}

function escapeSql(value) {
  return String(value).replaceAll("'", "''");
}

function queryOpenCodeRuntime(databasePath, cwd, sqlitePath = DEFAULT_SQLITE) {
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
    )
    SELECT latest_session.id AS session_id,
           latest_session.model AS session_model,
           latest_session.time_updated AS session_updated,
           latest_message.data AS message_data,
           latest_message.time_created AS message_created
    FROM latest_session
    LEFT JOIN latest_message;
  `;
  try {
    const result = spawnSync(sqlitePath, ['-readonly', '-json', databasePath, sql], {
      encoding: 'utf8',
      timeout: 1000,
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout.trim()) return null;
    return parseOpenCodeRuntimeRows(JSON.parse(result.stdout));
  } catch {
    return null;
  }
}

function getOpenCodeRuntimeForCwd(cwd, dataDir, options = {}) {
  if (!cwd || !dataDir) return null;
  const databasePath = path.join(dataDir, 'opencode.db');
  const signature = getDatabaseSignature(databasePath);
  const cacheKey = `${databasePath}:${cwd}`;
  const cached = RUNTIME_CACHE.get(cacheKey);
  if (cached?.signature === signature) return cached.runtime;

  const runtime = (options.query || queryOpenCodeRuntime)(
    databasePath,
    cwd,
    options.sqlitePath || DEFAULT_SQLITE
  );
  RUNTIME_CACHE.set(cacheKey, { signature, runtime });
  return runtime;
}

module.exports = {
  getModelName,
  getOpenCodeRuntimeForCwd,
  getStateFromMessage,
  parseOpenCodeRuntimeRows,
  queryOpenCodeRuntime,
};
