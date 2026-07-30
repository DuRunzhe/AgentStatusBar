'use strict';

const path = require('path');

function isIgnoredChildProcess(agentName, command) {
  return agentName === 'Codex' && path.basename(command.trim()) === 'codex-code-mode-host';
}

function isPrimaryCodexSessionHeader(header) {
  if (!header.includes('"type":"session_meta"')) return false;
  if (header.includes('"thread_source":"subagent"')) return false;
  return header.includes('"thread_source":"user"') || header.includes('"source":"cli"');
}

function parseElapsedTime(value) {
  const [dayPart, clockPart] = value.trim().includes('-')
    ? value.trim().split('-', 2)
    : ['0', value.trim()];
  const days = Number(dayPart);
  const clock = clockPart.split(':').map(Number);

  if (clock.some(Number.isNaN) || Number.isNaN(days)) return 0;
  if (clock.length === 2) {
    const [minutes, seconds] = clock;
    return days * 86400 + minutes * 60 + seconds;
  }
  if (clock.length === 3) {
    const [hours, minutes, seconds] = clock;
    return days * 86400 + hours * 3600 + minutes * 60 + seconds;
  }
  return 0;
}

module.exports = {
  isIgnoredChildProcess,
  isPrimaryCodexSessionHeader,
  parseElapsedTime,
};
