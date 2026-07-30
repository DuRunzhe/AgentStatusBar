#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  DEFAULT_CONTEXT_DIR,
  parseClaudeStatusLinePayload,
} = require('./claude-context');

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR
  || path.join(process.env.HOME || '', '.claude');
const INTEGRATION_FILE = path.join(CONFIG_DIR, 'agent-statusbar-statusline.json');
const CONTEXT_DIR = process.env.AGENT_STATUSBAR_CLAUDE_CONTEXT_DIR || DEFAULT_CONTEXT_DIR;

function writeSnapshot(snapshot) {
  fs.mkdirSync(CONTEXT_DIR, { recursive: true, mode: 0o700 });
  const destination = path.join(CONTEXT_DIR, `${snapshot.session_id}.json`);
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, destination);
}

function readIntegration() {
  try {
    return JSON.parse(fs.readFileSync(INTEGRATION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function forwardOriginalStatusLine(input) {
  const integration = readIntegration();
  const original = integration?.previous_status_line;
  if (original?.type !== 'command' || typeof original.command !== 'string') return;
  if (original.command === integration.collector_command) return;

  const result = spawnSync('/bin/sh', ['-lc', original.command], {
    input,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const snapshot = parseClaudeStatusLinePayload(JSON.parse(input));
    if (snapshot) writeSnapshot(snapshot);
  } catch {
    // Context capture must never break Claude's status line.
  }
  forwardOriginalStatusLine(input);
});
