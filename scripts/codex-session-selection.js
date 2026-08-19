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

function fileIdentity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

/**
 * Selects the most recently active primary Codex rollout for a PID.
 *
 * A Codex CLI process may outlive a rollout switch, so the selected file may
 * not be cached solely by PID. Header classification is immutable and cached
 * per candidate file identity; only lightweight stats are repeated per poll.
 */
function selectCodexSessionFile({
  cache,
  cacheKey,
  files,
  sessionDir,
  statSync = fs.statSync,
  readHeader = readCodexSessionHeader,
  isPrimaryHeader = isPrimaryCodexSessionHeader,
} = {}) {
  const prefix = `${sessionDir}${path.sep}`;
  const candidates = [...new Set((files || []).filter(file =>
    file.endsWith('.jsonl') && file.startsWith(prefix)
  ))].sort();

  if (candidates.length === 0) {
    cache?.delete(cacheKey);
    return null;
  }

  const previous = cache?.get(cacheKey);
  const nextEntries = new Map();
  const primaryFiles = [];

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
    if (prior?.identity === identity) {
      primary = prior.primary;
    } else {
      try {
        primary = isPrimaryHeader(readHeader(file));
      } catch {
        continue;
      }
    }

    nextEntries.set(file, { identity, primary });
    if (primary) primaryFiles.push({ file, mtimeMs: stat.mtimeMs });
  }

  if (cache) cache.set(cacheKey, { entries: nextEntries });
  primaryFiles.sort((a, b) => b.mtimeMs - a.mtimeMs || a.file.localeCompare(b.file));
  return primaryFiles[0]?.file || null;
}

module.exports = {
  HEADER_BYTES,
  readCodexSessionHeader,
  selectCodexSessionFile,
};
