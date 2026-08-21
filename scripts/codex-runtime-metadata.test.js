'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readLatestCodexTurnContext } = require('./codex-runtime-metadata');

function writeRollout(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-statusbar-codex-metadata-'));
  const file = path.join(root, 'rollout.jsonl');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return { root, file };
}

test('finds Codex automatic-confirmation metadata beyond the normal tail window', t => {
  const latestContext = JSON.stringify({
    type: 'turn_context',
    payload: {
      approval_policy: 'never',
      approvals_reviewer: 'auto_review',
      model: 'gpt-5.6-sol',
    },
  });
  const filler = JSON.stringify({ type: 'event_msg', payload: { text: 'x'.repeat(4096) } });
  const { root, file } = writeRollout([
    JSON.stringify({ type: 'turn_context', payload: { approval_policy: 'on-request' } }),
    latestContext,
    ...Array.from({ length: 600 }, () => filler),
  ]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(readLatestCodexTurnContext(file, { chunkSize: 1024 }), {
    approval_policy: 'never',
    approvals_reviewer: 'auto_review',
    model: 'gpt-5.6-sol',
  });
});

test('returns the newest complete turn context across chunk boundaries', t => {
  const { root, file } = writeRollout([
    JSON.stringify({ type: 'turn_context', payload: { approval_policy: 'never' } }),
    'not-json',
    JSON.stringify({
      type: 'turn_context',
      payload: { approval_policy: 'on-request', approvals_reviewer: 'user' },
    }),
    JSON.stringify({ type: 'event_msg', payload: { text: 'done' } }),
  ]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(readLatestCodexTurnContext(file, { chunkSize: 17 }), {
    approval_policy: 'on-request',
    approvals_reviewer: 'user',
  });
});

test('preserves multibyte turn-context text split across chunks', t => {
  const { root, file } = writeRollout([
    JSON.stringify({
      type: 'turn_context',
      payload: {
        approval_policy: 'never',
        approvals_reviewer: 'auto_review',
        user_instructions: '自动确认'.repeat(40),
      },
    }),
    JSON.stringify({ type: 'event_msg', payload: { text: 'done' } }),
  ]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const metadata = readLatestCodexTurnContext(file, { chunkSize: 19 });
  assert.equal(metadata.approval_policy, 'never');
  assert.equal(metadata.approvals_reviewer, 'auto_review');
  assert.equal(metadata.user_instructions, '自动确认'.repeat(40));
});
