'use strict';

const fs = require('fs');

const DEFAULT_CHUNK_SIZE = 256 * 1024;

function parseTurnContextLine(buffer) {
  const line = buffer.toString('utf8').trim();
  if (!line.includes('"turn_context"')) return null;
  try {
    const event = JSON.parse(line);
    return event?.type === 'turn_context' && event.payload ? event.payload : null;
  } catch {
    return null;
  }
}

/**
 * Reads backward until it finds the latest complete Codex turn_context event.
 * Long-running rollouts can place this metadata many megabytes before the file
 * tail, so a fixed line or byte window is not sufficient after a cold start.
 */
function readLatestCodexTurnContext(filePath, {
  chunkSize = DEFAULT_CHUNK_SIZE,
  openSync = fs.openSync,
  closeSync = fs.closeSync,
  readSync = fs.readSync,
  statSync = fs.statSync,
} = {}) {
  const size = statSync(filePath).size;
  const descriptor = openSync(filePath, 'r');
  let end = size;
  let carriedFragment = Buffer.alloc(0);

  try {
    while (end > 0) {
      const start = Math.max(0, end - chunkSize);
      const buffer = Buffer.alloc(end - start);
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, start);
      const combined = Buffer.concat([buffer.subarray(0, bytesRead), carriedFragment]);
      let lineEnd = combined.length;

      for (let index = combined.length - 1; index >= 0; index--) {
        if (combined[index] !== 0x0a) continue;
        const payload = parseTurnContextLine(combined.subarray(index + 1, lineEnd));
        if (payload) return payload;
        lineEnd = index;
      }

      if (start === 0) return parseTurnContextLine(combined.subarray(0, lineEnd));
      carriedFragment = Buffer.from(combined.subarray(0, lineEnd));
      end = start;
    }
  } finally {
    closeSync(descriptor);
  }

  return null;
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  readLatestCodexTurnContext,
};
