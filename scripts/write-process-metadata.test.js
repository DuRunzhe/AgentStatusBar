'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, 'write-process-metadata.sh');

test('probes new PIDs together and reuses valid metadata until periodic refresh', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'process-metadata-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const sessionDir = path.join(root, '.codex', 'sessions');
  const session = path.join(sessionDir, 'rollout.jsonl');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(session, '{}\n');

  const snapshot = path.join(root, 'snapshot');
  const output = path.join(root, 'metadata');
  const state = path.join(root, 'state');
  const retry = path.join(root, 'retry');
  const log = path.join(root, 'lsof.log');
  const fakeLsof = path.join(root, 'lsof.sh');
  fs.writeFileSync(snapshot, [
    '42 1 00:01 ttys001 /opt/bin/codex',
    '43 1 00:01 ttys002 /opt/bin/opencode',
  ].join('\n'));
  fs.writeFileSync(fakeLsof, `#!/bin/bash
printf '%s\\n' "$*" >> "${log}"
printf '%s\\n' 'p42' 'fcwd' 'n${project}' 'f10' 'n${session}'
printf '%s\\n' 'p43' 'fcwd' 'n${project}'
`);
  fs.chmodSync(fakeLsof, 0o755);

  const roots = path.join(root, 'roots');
  fs.writeFileSync(roots, '42\tcodex\n43\topencode\n');
  const run = now => spawnSync('/bin/bash', [script, snapshot, output, state, retry, roots], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_STATUSBAR_LSOF_CMD: fakeLsof,
      AGENT_STATUSBAR_NOW: String(now),
      AGENT_STATUSBAR_METADATA_REFRESH_SEC: '30',
    },
  });

  let result = run(1000);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(log, 'utf8').trim(), '-Fn -p 42,43');
  assert.match(fs.readFileSync(output, 'utf8'), new RegExp(`42\\tcwd\\t${project}`));
  assert.match(fs.readFileSync(state, 'utf8'), /^roots\t\d+$/m);
  assert.equal(fs.existsSync(retry), false);

  result = run(1002);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1);

  result = run(1030);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 2);
});

test('requests a fast retry while a new Codex PID has no rollout file yet', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'process-metadata-retry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  const snapshot = path.join(root, 'snapshot');
  const output = path.join(root, 'metadata');
  const state = path.join(root, 'state');
  const retry = path.join(root, 'retry');
  const fakeLsof = path.join(root, 'lsof.sh');
  fs.writeFileSync(snapshot, '42 1 00:01 ttys001 /opt/bin/codex\n');
  fs.writeFileSync(fakeLsof, `#!/bin/bash
printf '%s\\n' 'p42' 'fcwd' 'n${project}'
`);
  fs.chmodSync(fakeLsof, 0o755);

  const result = spawnSync('/bin/bash', [script, snapshot, output, state, retry], {
    encoding: 'utf8',
    env: { ...process.env, AGENT_STATUSBAR_LSOF_CMD: fakeLsof, AGENT_STATUSBAR_NOW: '1000' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(retry), true);
});
