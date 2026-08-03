'use strict';

const fs = require('fs');

const DEFAULT_SESSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_CACHE_MAX_ENTRIES = 200;

function pidFromSessionCacheKey(key) {
  const separator = String(key).lastIndexOf(':');
  const pid = Number.parseInt(String(key).slice(separator + 1), 10);
  return Number.isInteger(pid) ? pid : null;
}

function prunePidCaches(pidSessionCache, pidCwdCache, livePids) {
  const live = livePids instanceof Set ? livePids : new Set(livePids || []);
  for (const key of pidSessionCache.keys()) {
    const pid = pidFromSessionCacheKey(key);
    if (pid == null || !live.has(pid)) pidSessionCache.delete(key);
  }
  for (const pid of pidCwdCache.keys()) {
    if (!live.has(Number(pid))) pidCwdCache.delete(pid);
  }
}

function pruneSessionAnalysisCache(
  cache,
  activeFiles,
  now = Date.now(),
  {
    ttlMs = DEFAULT_SESSION_CACHE_TTL_MS,
    maxEntries = DEFAULT_SESSION_CACHE_MAX_ENTRIES,
    fileExists = fs.existsSync,
  } = {}
) {
  const active = activeFiles instanceof Set ? activeFiles : new Set(activeFiles || []);
  for (const [file, entry] of cache) {
    if (active.has(file)) continue;
    const lastAccessMs = Number(entry?.lastAccessMs) || 0;
    if (!fileExists(file) || now - lastAccessMs >= ttlMs) cache.delete(file);
  }

  if (cache.size <= maxEntries) return;
  const inactive = [...cache.entries()]
    .filter(([file]) => !active.has(file))
    .sort((a, b) => (Number(a[1]?.lastAccessMs) || 0) - (Number(b[1]?.lastAccessMs) || 0));
  for (const [file] of inactive) {
    if (cache.size <= maxEntries) break;
    cache.delete(file);
  }
}

module.exports = {
  DEFAULT_SESSION_CACHE_MAX_ENTRIES,
  DEFAULT_SESSION_CACHE_TTL_MS,
  pidFromSessionCacheKey,
  prunePidCaches,
  pruneSessionAnalysisCache,
};
