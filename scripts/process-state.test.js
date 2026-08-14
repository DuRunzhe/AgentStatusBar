'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getProcessExecutableName,
  getMatchedAgentProcessName,
  getProcessCommandNames,
  isAgentProcessName,
  hasMatchingAgentAncestor,
  hasActiveDescendantProcesses,
  isCodexAppServerProcess,
  isIgnoredChildProcess,
  isPrimaryCodexSessionHeader,
  parseProcessSnapshot,
  parseElapsedTime,
} = require('./process-state');

test('extracts executable names from full ps command lines', () => {
  assert.equal(getProcessExecutableName('/opt/codex/bin/codex --remote unix://./socket'), 'codex');
  assert.equal(getProcessExecutableName('/bin/zsh -l'), 'zsh');
});

test('extracts agent names from node-launched CLI scripts', () => {
  assert.deepEqual(getProcessCommandNames('/opt/homebrew/bin/node /opt/homebrew/bin/dsh chat'), [
    'node',
    'dsh',
    'chat',
  ]);
  assert.equal(
    getMatchedAgentProcessName('/opt/homebrew/bin/node /opt/homebrew/bin/dsh chat', ['dsh']),
    'dsh'
  );
});

test('recognizes DeepSeek Harness process names as tracked agents', () => {
  assert.equal(isAgentProcessName('dsh'), true);
  assert.equal(isAgentProcessName('deepseek-harness'), true);
  assert.equal(isAgentProcessName('python'), false);
});

test('detects wrapped agent children that share the same agent name', () => {
  const processes = [
    { pid: 10, ppid: 1, command: 'npm exec @deepseek-ai/dsh web' },
    { pid: 11, ppid: 10, command: 'node /tmp/node_modules/.bin/dsh web' },
    { pid: 12, ppid: 11, command: '/bin/zsh' },
  ];

  assert.equal(hasMatchingAgentAncestor(processes[0], processes, ['dsh']), false);
  assert.equal(hasMatchingAgentAncestor(processes[1], processes, ['dsh']), true);
  assert.equal(hasMatchingAgentAncestor(processes[2], processes, ['dsh']), true);
});

test('identifies Codex app-server processes without excluding remote TUIs', () => {
  assert.equal(isCodexAppServerProcess('/opt/bin/codex app-server --listen unix://./socket'), true);
  assert.equal(isCodexAppServerProcess('/opt/bin/codex --remote unix://./socket'), false);
});

test('ignores the persistent Codex code mode host only for Codex', () => {
  const command = '/usr/local/lib/codex-code-mode-host';
  assert.equal(isIgnoredChildProcess('Codex', command), true);
  assert.equal(isIgnoredChildProcess('Claude', command), false);
  assert.equal(isIgnoredChildProcess('Codex', '/bin/zsh'), false);
  assert.equal(isIgnoredChildProcess('DeepSeek Harness', 'node /tmp/node_modules/.bin/dsh web'), true);
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
    '  42     1 01:02 ttys001 /usr/local/bin/claude',
    '  43    42 00:03 ttys001 /bin/bash',
    '  99     1 2-01:00:00 ?? /opt/bin/codex',
    '',
  ].join('\n')), [
    { pid: 42, ppid: 1, elapsed_sec: 62, tty: '/dev/ttys001', command: '/usr/local/bin/claude' },
    { pid: 43, ppid: 42, elapsed_sec: 3, tty: '/dev/ttys001', command: '/bin/bash' },
    { pid: 99, ppid: 1, elapsed_sec: 176400, tty: null, command: '/opt/bin/codex' },
  ]);
});

test('finds active nested task processes while ignoring the persistent host itself', () => {
  const processes = [
    { pid: 100, ppid: 1, command: '/bin/codex' },
    { pid: 101, ppid: 100, command: '/bin/codex-code-mode-host' },
    { pid: 102, ppid: 101, command: '/bin/bash' },
    { pid: 103, ppid: 102, command: '/opt/homebrew/bin/brew' },
  ];

  assert.equal(hasActiveDescendantProcesses(100, 'Codex', processes), true);
  assert.equal(hasActiveDescendantProcesses(100, 'Codex', processes.slice(0, 2)), false);
});

test('ignores wrapped agent child processes while still counting their task children', () => {
  const processes = [
    { pid: 200, ppid: 1, command: 'npm exec @deepseek-ai/dsh web' },
    { pid: 201, ppid: 200, command: 'node /tmp/node_modules/.bin/dsh web' },
    { pid: 202, ppid: 201, command: '/bin/bash' },
  ];

  assert.equal(hasActiveDescendantProcesses(200, 'DeepSeek Harness', processes.slice(0, 2)), false);
  assert.equal(hasActiveDescendantProcesses(200, 'DeepSeek Harness', processes), true);
});
