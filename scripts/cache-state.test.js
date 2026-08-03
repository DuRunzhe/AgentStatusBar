'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  prunePidCaches,
  pruneSessionAnalysisCache,
} = require('./cache-state');

test('removes PID cache entries as soon as their process is no longer live', () => {
  const sessions = new Map([
    ['Codex:42', '/sessions/live.jsonl'],
    ['Codex:99', '/sessions/dead.jsonl'],
  ]);
  const cwds = new Map([[42, '/live'], [99, '/dead']]);

  prunePidCaches(sessions, cwds, new Set([42]));

  assert.deepEqual([...sessions.keys()], ['Codex:42']);
  assert.deepEqual([...cwds.keys()], [42]);
});

test('protects active analyses while pruning expired and missing files', () => {
  const cache = new Map([
    ['/active', { lastAccessMs: 0 }],
    ['/fresh', { lastAccessMs: 900 }],
    ['/expired', { lastAccessMs: 0 }],
    ['/missing', { lastAccessMs: 900 }],
  ]);

  pruneSessionAnalysisCache(cache, new Set(['/active']), 1000, {
    ttlMs: 500,
    maxEntries: 10,
    fileExists: file => file !== '/missing',
  });

  assert.deepEqual([...cache.keys()], ['/active', '/fresh']);
});

test('uses an LRU cap without evicting active sessions', () => {
  const cache = new Map([
    ['/active', { lastAccessMs: 0 }],
    ['/old', { lastAccessMs: 100 }],
    ['/new', { lastAccessMs: 200 }],
  ]);

  pruneSessionAnalysisCache(cache, new Set(['/active']), 300, {
    ttlMs: 1000,
    maxEntries: 2,
    fileExists: () => true,
  });

  assert.deepEqual([...cache.keys()], ['/active', '/new']);
});
