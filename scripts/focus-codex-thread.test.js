'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCodexThreadUrl,
  focusCodexThread,
  normalizeCodexThreadId,
} = require('./focus-codex-thread');

const THREAD_ID = '01a02389-7898-7f60-a1b8-799d9017fe52';

test('builds the ChatGPT Codex desktop deep link for a thread', () => {
  assert.equal(normalizeCodexThreadId(THREAD_ID.toUpperCase()), THREAD_ID);
  assert.equal(buildCodexThreadUrl(THREAD_ID), `codex://threads/${THREAD_ID}`);
  assert.equal(buildCodexThreadUrl('not-a-thread'), null);
});

test('opens only validated Codex desktop thread links', () => {
  let opened = null;
  assert.equal(focusCodexThread(THREAD_ID, {
    openUrl: url => { opened = url; return true; },
  }), true);
  assert.equal(opened, `codex://threads/${THREAD_ID}`);

  opened = null;
  assert.equal(focusCodexThread('codex://threads/anything', {
    openUrl: url => { opened = url; return true; },
  }), false);
  assert.equal(opened, null);
});
