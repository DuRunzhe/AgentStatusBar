'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isIgnoredChildProcess,
  isPrimaryCodexSessionHeader,
  parseProcessSnapshot,
  parseElapsedTime,
} = require('./process-state');

test('ignores the persistent Codex code mode host only for Codex', () => {
  const command = '/usr/local/lib/codex-code-mode-host';
  assert.equal(isIgnoredChildProcess('Codex', command), true);
  assert.equal(isIgnoredChildProcess('Claude', command), false);
  assert.equal(isIgnoredChildProcess('Codex', '/bin/zsh'), false);
});

test('selects the primary Codex rollout and rejects subagent rollouts', () => {
  assert.equal(isPrimaryCodexSessionHeader(
    '{"type":"session_meta","payload":{"source":"cli","thread_source":"user"}}'
  ), true);
  assert.equal(isPrimaryCodexSessionHeader(
    '{"type":"session_meta","payload":{"source":{"subagent":{}},"thread_source":"subagent"}}'
  ), false);
});

test('parses ps elapsed time formats without treating minutes as hours', () => {
  assert.equal(parseElapsedTime('09:49'), 589);
  assert.equal(parseElapsedTime('10:02:03'), 36123);
  assert.equal(parseElapsedTime('2-20:59:29'), 248369);
});

test('parses one process snapshot for agent and child lookup', () => {
  assert.deepEqual(parseProcessSnapshot([
    '  42     1 01:02 /usr/local/bin/claude',
    '  43    42 00:03 /bin/bash',
    '  99     1 2-01:00:00 /opt/bin/codex',
    '',
  ].join('\n')), [
    { pid: 42, ppid: 1, elapsed_sec: 62, command: '/usr/local/bin/claude' },
    { pid: 43, ppid: 42, elapsed_sec: 3, command: '/bin/bash' },
    { pid: 99, ppid: 1, elapsed_sec: 176400, command: '/opt/bin/codex' },
  ]);
});
