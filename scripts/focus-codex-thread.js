#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeCodexThreadId(value) {
  const threadId = String(value || '').trim();
  return THREAD_ID_PATTERN.test(threadId) ? threadId.toLowerCase() : null;
}

function buildCodexThreadUrl(value) {
  const threadId = normalizeCodexThreadId(value);
  return threadId ? `codex://threads/${threadId}` : null;
}

function focusCodexThread(value, { openUrl = null } = {}) {
  const url = buildCodexThreadUrl(value);
  if (!url) return false;
  const opener = openUrl || (target => {
    execFileSync('/usr/bin/open', [target], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  });
  try {
    return opener(url) !== false;
  } catch {
    return false;
  }
}

if (require.main === module) {
  if (!focusCodexThread(process.argv[2])) process.exitCode = 1;
}

module.exports = {
  buildCodexThreadUrl,
  focusCodexThread,
  normalizeCodexThreadId,
};
