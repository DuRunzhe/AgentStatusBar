#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { acquireProcessLock } = require('./process-lock');

const RECORD_SEPARATOR = '\x1e';
const FIELD_SEPARATOR = '\x1f';
const STATUS_SEPARATOR = '\x1d';
const LOCK_FILE = '/tmp/agent-statusbar-terminal-probe.pid';
const APPROVAL_PROMPT_PATTERNS = Object.freeze({
  footer: [
    /Press enter to confirm or esc to cancel\s*$/i,
  ],
  question: [
    /Would you like to\b/i,
    /Do you want to\b/i,
  ],
  affirmativeChoice: [
    /(?:^|\n)\s*[›>]?\s*\d+\.\s+Yes\b/im,
  ],
  negativeChoice: [
    /(?:^|\n)\s*[›>]?\s*\d+\.\s+No\b/im,
  ],
});

function matchesAny(patterns, value) {
  return patterns.some(pattern => pattern.test(value));
}

function detectCodexTerminalState(contents) {
  const visible = String(contents || '').trimEnd();
  if (!matchesAny(APPROVAL_PROMPT_PATTERNS.footer, visible)) return null;

  // Limit matching to the prompt at the bottom of the visible terminal. Old
  // approval text elsewhere in the scrollback must not affect current state.
  const prompt = visible.slice(-2000);
  const hasChoices = matchesAny(APPROVAL_PROMPT_PATTERNS.affirmativeChoice, prompt)
    && matchesAny(APPROVAL_PROMPT_PATTERNS.negativeChoice, prompt);
  const hasQuestion = matchesAny(APPROVAL_PROMPT_PATTERNS.question, prompt);
  return hasChoices && hasQuestion ? 'approval' : null;
}

function parseTerminalTabs(output, targetTtys = null) {
  const [terminalStatus, records = ''] = String(output || '').split(STATUS_SEPARATOR, 2);
  const states = [];
  const targets = targetTtys ? new Set(targetTtys) : null;
  for (const record of records.split(RECORD_SEPARATOR)) {
    const separator = record.indexOf(FIELD_SEPARATOR);
    if (separator < 0) continue;
    const tty = record.slice(0, separator).trim();
    if (targets && !targets.has(tty)) continue;
    const state = detectCodexTerminalState(record.slice(separator + 1));
    if (tty && state) states.push({ tty, state });
  }
  return {
    terminalRunning: terminalStatus.trim() === 'running',
    states,
  };
}

function probeTerminalTabs(targetTtys, run = spawnSync) {
  const startedAtMs = Date.now();
  const script = path.join(__dirname, 'read-terminal-tabs.applescript');
  const result = run('/usr/bin/osascript', [script, ...targetTtys], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 1500,
  });
  const durationMs = Date.now() - startedAtMs;
  if (result.status !== 0) {
    return {
      version: 1,
      updatedAtMs: Date.now(),
      ok: false,
      durationMs,
      targetTtys,
      terminalRunning: null,
      states: {},
      error: result.error?.message
        || String(result.stderr || '').trim()
        || `osascript exited with status ${result.status}`,
    };
  }

  const parsed = parseTerminalTabs(result.stdout, targetTtys);
  return {
    version: 1,
    updatedAtMs: Date.now(),
    ok: true,
    durationMs,
    targetTtys,
    terminalRunning: parsed.terminalRunning,
    states: Object.fromEntries(parsed.states.map(({ tty, state }) => [tty, state])),
    error: null,
  };
}

function writeSnapshotAtomic(filePath, snapshot) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(snapshot));
  fs.renameSync(tempPath, filePath);
}

function readFreshTerminalSnapshot(filePath, now = Date.now(), maxAgeMs = 5000) {
  try {
    const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (snapshot?.ok !== true || !Number.isFinite(snapshot.updatedAtMs)) return null;
    if (now - snapshot.updatedAtMs < 0 || now - snapshot.updatedAtMs > maxAgeMs) return null;
    return snapshot;
  } catch {
    return null;
  }
}

function hasFreshTerminalApproval(snapshot, targetTtys, lastSessionActivityMs = 0) {
  if (!snapshot || !Number.isFinite(snapshot.updatedAtMs)) return false;

  // A probe is asynchronous. If the rollout changed after the terminal was
  // sampled, the visible approval prompt may already have been replaced by
  // active Codex output on the same TTY. Do not let that stale snapshot turn a
  // newly-running tool call back into "waiting" until the next probe arrives.
  if (Number.isFinite(lastSessionActivityMs)
    && lastSessionActivityMs > snapshot.updatedAtMs) {
    return false;
  }

  return targetTtys.some(tty => snapshot.states?.[tty] === 'approval');
}

function parseCliArgs(argv) {
  const outputIndex = argv.indexOf('--output');
  if (outputIndex < 0 || !argv[outputIndex + 1]) return null;
  const requestIndex = argv.indexOf('--request');
  let requestUpdatedAtMs = null;
  let targetTtys = argv.slice(outputIndex + 2);
  if (requestIndex >= 0 && argv[requestIndex + 1]) {
    try {
      const request = JSON.parse(fs.readFileSync(argv[requestIndex + 1], 'utf8'));
      requestUpdatedAtMs = request.updatedAtMs;
      targetTtys = request.targetTtys;
    } catch {
      targetTtys = [];
    }
  }
  return {
    outputPath: argv[outputIndex + 1],
    requestUpdatedAtMs,
    targetTtys: [...new Set((Array.isArray(targetTtys) ? targetTtys : [])
      .filter(value => /^\/dev\/tty/.test(value)))],
  };
}

if (require.main === module) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write('usage: terminal-prompt-state.js --output FILE [--request FILE | /dev/tty...]\n');
    process.exit(2);
  }
  const releaseLock = acquireProcessLock(LOCK_FILE);
  if (releaseLock) {
    try {
      const snapshot = args.targetTtys.length > 0
        ? probeTerminalTabs(args.targetTtys)
        : {
            version: 1,
            updatedAtMs: Date.now(),
            ok: true,
            durationMs: 0,
            targetTtys: [],
            terminalRunning: null,
            states: {},
            error: null,
          };
      snapshot.requestUpdatedAtMs = args.requestUpdatedAtMs;
      writeSnapshotAtomic(args.outputPath, snapshot);
    } finally {
      releaseLock();
    }
  }
}

module.exports = {
  APPROVAL_PROMPT_PATTERNS,
  detectCodexTerminalState,
  hasFreshTerminalApproval,
  parseTerminalTabs,
  probeTerminalTabs,
  readFreshTerminalSnapshot,
  writeSnapshotAtomic,
};
