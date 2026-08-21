'use strict';

const fs = require('fs');
const path = require('path');
const { isPrimaryCodexSessionHeader } = require('./process-state');

const HEADER_BYTES = 8192;

function readCodexSessionHeader(filePath, {
  openSync = fs.openSync,
  readSync = fs.readSync,
  closeSync = fs.closeSync,
} = {}) {
  const descriptor = openSync(filePath, 'r');
  const buffer = Buffer.alloc(HEADER_BYTES);
  try {
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}

function extractJsonStringField(header, field) {
  const pattern = new RegExp(`"${field}":("(?:\\\\.|[^"\\\\])*")`);
  const match = String(header || '').match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function getCodexSessionMetadataInHeader(header) {
  return {
    id: extractJsonStringField(header, 'id'),
    sessionId: extractJsonStringField(header, 'session_id'),
    cwd: extractJsonStringField(header, 'cwd'),
    originator: extractJsonStringField(header, 'originator'),
    model: extractJsonStringField(header, 'model'),
    timestamp: extractJsonStringField(header, 'timestamp'),
  };
}

function fileIdentity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

/**
 * Returns active primary Codex rollouts ordered by latest file activity.
 * Header classification and stable session metadata are cached by file inode.
 */
function selectCodexSessions({
  cache,
  cacheKey,
  files,
  sessionDir,
  statSync = fs.statSync,
  readHeader = readCodexSessionHeader,
  isPrimaryHeader = isPrimaryCodexSessionHeader,
  sessionFilter = null,
} = {}) {
  const prefix = `${sessionDir}${path.sep}`;
  const candidates = [...new Set((files || []).filter(file =>
    file.endsWith('.jsonl') && file.startsWith(prefix)
  ))].sort();

  if (candidates.length === 0) {
    cache?.delete(cacheKey);
    return [];
  }

  const previous = cache?.get(cacheKey);
  const nextEntries = new Map();
  const primarySessions = [];

  for (const file of candidates) {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue;
    }

    const identity = fileIdentity(stat);
    const prior = previous?.entries?.get(file);
    let primary;
    let metadata;
    if (prior?.identity === identity) {
      primary = prior.primary;
      metadata = prior.metadata;
    } else {
      try {
        const header = readHeader(file);
        primary = isPrimaryHeader(header);
        metadata = getCodexSessionMetadataInHeader(header);
      } catch {
        continue;
      }
    }

    nextEntries.set(file, { identity, primary, metadata });
    if (primary && (!sessionFilter || sessionFilter(metadata))) {
      primarySessions.push({ file, mtimeMs: stat.mtimeMs, metadata });
    }
  }

  if (cache) cache.set(cacheKey, { entries: nextEntries });
  primarySessions.sort((a, b) => b.mtimeMs - a.mtimeMs || a.file.localeCompare(b.file));
  return primarySessions;
}

/**
 * Selects the most recently active primary Codex rollout for a CLI PID.
 *
 * A Codex CLI process may outlive a rollout switch, so the selected file may
 * not be cached solely by PID. Only lightweight stats are repeated per poll.
 */
function selectCodexSessionFile(options = {}) {
  return selectCodexSessions(options)[0]?.file || null;
}

module.exports = {
  HEADER_BYTES,
  getCodexSessionMetadataInHeader,
  readCodexSessionHeader,
  selectCodexSessionFile,
  selectCodexSessions,
};
