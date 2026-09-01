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

function getProcessCommandNames(command, maxTokens = 4) {
  return String(command || '')
    .trim()
    .split(/\s+/)
    .slice(0, maxTokens)
    .map(token => path.basename(token))
    .filter(Boolean);
}

function isCodexAppServerProcess(command) {
  if (getProcessExecutableName(command) !== 'codex') return false;
  return /(?:^|\s)app-server(?:\s|$)/.test(String(command || ''));
}

function isChatGPTCodexAppServerProcess(command) {
  const value = String(command || '');
  return isCodexAppServerProcess(value)
    && /\/(?:ChatGPT|Codex)\.app\/Contents\/Resources\/codex(?:\s|$)/i.test(value);
}

function getAgentProcessNames(agentDef) {
  if (Array.isArray(agentDef?.processNames)) return agentDef.processNames;
  if (agentDef?.process) return [agentDef.process];
  return [];
}

function isAgentProcessName(name) {
  return ['claude', 'codex', 'opencode', 'dsh', 'deepseek-harness', 'pi'].includes(name);
}

function getMatchedAgentProcessName(command, allowedNames = null) {
  const allowed = allowedNames ? new Set(allowedNames) : null;
  return getProcessCommandNames(command).find(name =>
    isAgentProcessName(name) && (!allowed || allowed.has(name))
  ) || null;
}

function hasMatchingAgentAncestor(processInfo, processes, allowedNames) {
  const byPid = new Map(processes.map(item => [item.pid, item]));
  const allowed = new Set(allowedNames || []);
  let current = byPid.get(processInfo.ppid);
  const visited = new Set();

  while (current && !visited.has(current.pid)) {
    if (getMatchedAgentProcessName(current.command, allowed)) return true;
    visited.add(current.pid);
    current = byPid.get(current.ppid);
  }
  return false;
}

function getAgentNamesForDisplayName(agentName) {
  if (agentName === 'Claude') return ['claude'];
  if (agentName === 'Codex') return ['codex'];
  if (agentName === 'OpenCode') return ['opencode'];
  if (agentName === 'DeepSeek Harness') return ['dsh', 'deepseek-harness'];
  if (agentName === 'Pi') return ['pi'];
  return [];
}

function isCodexPersistentHostProcess(command) {
  const value = String(command || '').trim();
  const executable = value.split(/\s+/, 1)[0];
  const name = path.basename(executable);
  if (name === 'codex-code-mode-host') return true;

  const cuaNodePath = /\/(?:ChatGPT|Codex)\.app\/Contents\/Resources\/cua_node\/bin\//i;
  if (name === 'node_repl' && cuaNodePath.test(executable)) return true;

  // The Node REPL lazily starts a sandboxed kernel and trusted worker, then
  // keeps both Node processes alive after the turn completes. They are idle
  // infrastructure just like node_repl; real shell/tool processes spawned
  // beneath them must still count as active descendants.
  return name === 'node'
    && cuaNodePath.test(executable)
    && /\/T\/\.tmp[^/\s]+\/(?:kernel|trusted-worker)\.js(?:\s|$)/i.test(value);
}

function isIgnoredChildProcess(agentName, command) {
  if (agentName === 'Codex' && isCodexPersistentHostProcess(command)) return true;
  return Boolean(getMatchedAgentProcessName(command, getAgentNamesForDisplayName(agentName)));
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
  getAgentProcessNames,
  getAgentNamesForDisplayName,
  getMatchedAgentProcessName,
  getProcessCommandNames,
  getProcessExecutableName,
  hasMatchingAgentAncestor,
  hasActiveDescendantProcesses,
  isAgentProcessName,
  isChatGPTCodexAppServerProcess,
  isCodexAppServerProcess,
  isIgnoredChildProcess,
  isPrimaryCodexSessionHeader,
  parseProcessSnapshot,
  parseElapsedTime,
};
