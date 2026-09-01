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
  isChatGPTCodexAppServerProcess,
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

test('recognizes DeepSeek Harness and Pi process names as tracked agents', () => {
  assert.equal(isAgentProcessName('dsh'), true);
  assert.equal(isAgentProcessName('deepseek-harness'), true);
  assert.equal(isAgentProcessName('pi'), true);
  assert.equal(isAgentProcessName('python'), false);
});

test('detects Pi launched through a Node wrapper', () => {
  assert.equal(
    getMatchedAgentProcessName('/opt/homebrew/bin/node /opt/homebrew/bin/pi', ['pi']),
    'pi'
  );
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

test('ignores persistent Codex hosts only for Codex', () => {
  const codeModeHost = '/usr/local/lib/codex-code-mode-host';
  const nodeReplHost = '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl';
  assert.equal(isIgnoredChildProcess('Codex', codeModeHost), true);
  assert.equal(isIgnoredChildProcess('Codex', nodeReplHost), true);
  assert.equal(isIgnoredChildProcess('Claude', codeModeHost), false);
  assert.equal(isIgnoredChildProcess('Claude', nodeReplHost), false);
  assert.equal(isIgnoredChildProcess('Codex', '/usr/local/bin/node_repl'), false);
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

test('treats the persistent Codex Node REPL as idle but counts commands below it', () => {
  const processes = [
    { pid: 200, ppid: 1, command: '/bin/codex' },
    {
      pid: 201,
      ppid: 200,
      command: '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl',
    },
    { pid: 202, ppid: 201, command: '/bin/zsh -lc npm test' },
  ];

  assert.equal(hasActiveDescendantProcesses(200, 'Codex', processes.slice(0, 2)), false);
  assert.equal(hasActiveDescendantProcesses(200, 'Codex', processes), true);
});

test('treats persistent Codex Node REPL workers as idle but counts their tasks', () => {
  const tmpDir = '/var/folders/xx/example/T/.tmpAbC123';
  const processes = [
    { pid: 300, ppid: 1, command: '/bin/codex' },
    {
      pid: 301,
      ppid: 300,
      command: '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl',
    },
    {
      pid: 302,
      ppid: 301,
      command: `/Applications/ChatGPT.app/Contents/Resources/codex sandbox -- `
        + `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node ${tmpDir}/kernel.js`,
    },
    {
      pid: 303,
      ppid: 302,
      command: `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node `
        + `--experimental-vm-modules ${tmpDir}/kernel.js --session-id session-1`,
    },
    {
      pid: 304,
      ppid: 301,
      command: `/Applications/ChatGPT.app/Contents/Resources/codex sandbox -- `
        + `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node ${tmpDir}/trusted-worker.js`,
    },
    {
      pid: 305,
      ppid: 304,
      command: `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node `
        + `--experimental-vm-modules ${tmpDir}/trusted-worker.js /repo`,
    },
    { pid: 306, ppid: 303, command: '/bin/zsh -lc npm test' },
  ];

  assert.equal(hasActiveDescendantProcesses(300, 'Codex', processes.slice(0, 6)), false);
  assert.equal(hasActiveDescendantProcesses(300, 'Codex', processes), true);
  assert.equal(isIgnoredChildProcess('Claude', processes[3].command), false);
  assert.equal(isIgnoredChildProcess('Codex', '/usr/local/bin/node /tmp/kernel.js'), false);
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


test('recognizes only the ChatGPT desktop Codex app-server', () => {
  assert.equal(isChatGPTCodexAppServerProcess(
    '/Applications/ChatGPT.app/Contents/Resources/codex -c features.code_mode_host=true app-server'
  ), true);
  assert.equal(isChatGPTCodexAppServerProcess(
    '/Applications/Codex.app/Contents/Resources/codex app-server'
  ), true);
  assert.equal(isChatGPTCodexAppServerProcess('/opt/bin/codex app-server'), false);
  assert.equal(isChatGPTCodexAppServerProcess('/opt/bin/codex'), false);
});
