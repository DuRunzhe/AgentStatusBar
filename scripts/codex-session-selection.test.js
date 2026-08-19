'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { selectCodexSessionFile } = require('./codex-session-selection');

const sessionDir = '/home/test/.codex/sessions';
const primaryHeader = '{"type":"session_meta","thread_source":"user"}\n';
const subagentHeader = '{"type":"session_meta","thread_source":"subagent"}\n';

function createSelector(filesByPath) {
  let headerReads = 0;
  const cache = new Map();
  const select = files => selectCodexSessionFile({
    cache,
    cacheKey: 'Codex:42',
    files,
    sessionDir,
    statSync: file => {
      const entry = filesByPath.get(file);
      if (!entry) throw new Error('missing');
      return { dev: 1, ino: entry.ino, mtimeMs: entry.mtimeMs };
    },
    readHeader: file => {
      headerReads++;
      return filesByPath.get(file).header;
    },
  });
  return { cache, select, getHeaderReads: () => headerReads };
}

test('changes Codex rollout selection when a long-lived PID writes a newer candidate', () => {
  const older = path.join(sessionDir, 'old.jsonl');
  const current = path.join(sessionDir, 'current.jsonl');
  const files = new Map([
    [older, { ino: 10, mtimeMs: 100, header: primaryHeader }],
    [current, { ino: 11, mtimeMs: 90, header: primaryHeader }],
  ]);
  const { select, getHeaderReads } = createSelector(files);

  assert.equal(select([older, current]), older);
  files.get(current).mtimeMs = 200;
  assert.equal(select([older, current]), current);
  assert.equal(getHeaderReads(), 2, 'unchanged headers are not reread on each poll');
});

test('reads a header only for newly discovered candidates and excludes subagents', () => {
  const primary = path.join(sessionDir, 'primary.jsonl');
  const subagent = path.join(sessionDir, 'subagent.jsonl');
  const files = new Map([
    [primary, { ino: 10, mtimeMs: 100, header: primaryHeader }],
    [subagent, { ino: 11, mtimeMs: 200, header: subagentHeader }],
  ]);
  const { select, getHeaderReads } = createSelector(files);

  assert.equal(select([primary]), primary);
  assert.equal(select([primary]), primary);
  assert.equal(getHeaderReads(), 1);
  assert.equal(select([primary, subagent]), primary);
  assert.equal(getHeaderReads(), 2);
});

test('drops stale candidate metadata when no rollout remains for the PID', () => {
  const primary = path.join(sessionDir, 'primary.jsonl');
  const files = new Map([[primary, { ino: 10, mtimeMs: 100, header: primaryHeader }]]);
  const { cache, select } = createSelector(files);

  assert.equal(select([primary]), primary);
  assert.equal(select([]), null);
  assert.equal(cache.has('Codex:42'), false);
});
