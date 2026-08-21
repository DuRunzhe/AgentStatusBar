'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  getCodexSessionMetadataInHeader,
  selectCodexSessionFile,
  selectCodexSessions,
} = require('./codex-session-selection');

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


test('extracts desktop session identity from a truncated Codex header', () => {
  const header = '{"type":"session_meta","payload":{"session_id":"01a02389-7898-7f60-a1b8-799d9017fe52","id":"01a02389-7898-7f60-a1b8-799d9017fe52","timestamp":"2026-08-21T08:56:47.031Z","cwd":"/tmp/project","originator":"codex_work_desktop","base_instructions":{"text":"truncated';
  const metadata = getCodexSessionMetadataInHeader(header);
  assert.deepEqual(metadata, {
    id: '01a02389-7898-7f60-a1b8-799d9017fe52',
    sessionId: '01a02389-7898-7f60-a1b8-799d9017fe52',
    cwd: '/tmp/project',
    originator: 'codex_work_desktop',
    model: null,
    timestamp: '2026-08-21T08:56:47.031Z',
  });
  assert.equal(metadata.originator, 'codex_work_desktop');
});

test('returns every primary rollout opened by a desktop app-server', () => {
  const first = path.join(sessionDir, 'first.jsonl');
  const second = path.join(sessionDir, 'second.jsonl');
  const subagent = path.join(sessionDir, 'guardian.jsonl');
  const files = new Map([
    [first, { ino: 10, mtimeMs: 100, header: '{"type":"session_meta","payload":{"id":"11111111-1111-1111-1111-111111111111","cwd":"/tmp/one","originator":"codex_work_desktop","thread_source":"user"}}' }],
    [second, { ino: 11, mtimeMs: 200, header: '{"type":"session_meta","payload":{"id":"22222222-2222-2222-2222-222222222222","cwd":"/tmp/two","originator":"codex_work_desktop","thread_source":"user"}}' }],
    [subagent, { ino: 12, mtimeMs: 300, header: subagentHeader }],
  ]);
  const selected = selectCodexSessions({
    cache: new Map(),
    cacheKey: 'ChatGPT:42',
    files: [first, second, subagent],
    sessionDir,
    statSync: file => ({ dev: 1, ino: files.get(file).ino, mtimeMs: files.get(file).mtimeMs }),
    readHeader: file => files.get(file).header,
  });

  assert.deepEqual(selected.map(item => item.file), [second, first]);
  assert.equal(selected[0].metadata.cwd, '/tmp/two');
});
