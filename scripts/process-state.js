'use strict';

const path = require('path');

function parseProcessSnapshot(output) {
  return String(output || '')
    .split('\n')
    .map(line => line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/))
    .filter(Boolean)
    .map(match => ({
      pid: Number.parseInt(match[1], 10),
      ppid: Number.parseInt(match[2], 10),
      elapsed_sec: parseElapsedTime(match[3]),
      tty: match[4] === '??' ? null : `/dev/${match[4]}`,
      command: match[5],
    }));
}

function getProcessExecutableName(command) {
  const executable = String(command || '').trim().split(/\s+/, 1)[0];
  return path.basename(executable);
}

function isCodexAppServerProcess(command) {
  if (getProcessExecutableName(command) !== 'codex') return false;
  return /(?:^|\s)app-server(?:\s|$)/.test(String(command || ''));
}

function isIgnoredChildProcess(agentName, command) {
  return agentName === 'Codex'
    && getProcessExecutableName(command) === 'codex-code-mode-host';
}

function hasActiveDescendantProcesses(pid, agentName, processes) {
  const byPid = new Map(processes.map(processInfo => [processInfo.pid, processInfo]));

  return processes.some(processInfo => {
    if (processInfo.pid === pid || isIgnoredChildProcess(agentName, processInfo.command)) {
      return false;
    }

    let current = processInfo;
    const visited = new Set();
    while (current && !visited.has(current.pid)) {
      if (current.ppid === pid) return true;
      visited.add(current.pid);
      current = byPid.get(current.ppid);
    }
    return false;
  });
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
  getProcessExecutableName,
  hasActiveDescendantProcesses,
  isCodexAppServerProcess,
  isIgnoredChildProcess,
  isPrimaryCodexSessionHeader,
  parseProcessSnapshot,
  parseElapsedTime,
};
