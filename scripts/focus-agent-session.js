#!/usr/bin/env node
'use strict';

const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function parseTtyFromLsof(output) {
  const line = output.split('\n').find(value => /^n\/dev\/tty/.test(value));
  return line ? line.slice(1) : null;
}

function getTtyForPid(pid) {
  try {
    const output = execFileSync('/usr/sbin/lsof', [
      '-a', '-p', String(pid), '-d', '0,1,2', '-Fn',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    return parseTtyFromLsof(output);
  } catch {
    return null;
  }
}

function getProcess(pid) {
  try {
    const output = execFileSync('/bin/ps', [
      '-o', 'ppid=', '-o', 'command=', '-p', String(pid),
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    const match = output.match(/^(\d+)\s+(.+)$/);
    return match ? { ppid: Number(match[1]), command: match[2] } : null;
  } catch {
    return null;
  }
}

function getAncestorCommands(pid, limit = 16) {
  const commands = [];
  const seen = new Set();
  let currentPid = pid;

  while (Number.isInteger(currentPid) && currentPid > 1 && commands.length < limit) {
    if (seen.has(currentPid)) break;
    seen.add(currentPid);
    const process = getProcess(currentPid);
    if (!process) break;
    commands.push(process.command);
    currentPid = process.ppid;
  }
  return commands;
}

function detectTerminalApp(commands) {
  const ancestry = commands.join('\n');
  const candidates = [
    [/\/iTerm2?\.app\/|iTermServer/i, 'iTerm'],
    [/\/Terminal\.app\//i, 'Terminal'],
    [/\/Warp\.app\/|Warp Helper/i, 'Warp'],
    [/\/Visual Studio Code\.app\/|Code Helper/i, 'Visual Studio Code'],
    [/\/Cursor\.app\/|Cursor Helper/i, 'Cursor'],
    [/\/Windsurf\.app\/|Windsurf Helper/i, 'Windsurf'],
    [/\/kitty\.app\//i, 'kitty'],
    [/\/Alacritty\.app\//i, 'Alacritty'],
  ];
  return candidates.find(([pattern]) => pattern.test(ancestry))?.[1] || null;
}

function focusExactTerminalSession(tty) {
  const script = path.join(__dirname, 'focus-agent-session.applescript');
  const result = spawnSync('/usr/bin/osascript', [script, tty], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  });
  return result.status === 0 && Boolean(result.stdout.trim());
}

function focusAgentSession(pid) {
  const tty = getTtyForPid(pid);
  if (!tty) return false;
  if (focusExactTerminalSession(tty)) return true;

  const app = detectTerminalApp(getAncestorCommands(pid));
  if (!app) return false;
  try {
    execFileSync('/usr/bin/open', ['-a', app], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

if (require.main === module) {
  const pid = Number(process.argv[2]);
  if (!Number.isInteger(pid) || pid <= 0 || !focusAgentSession(pid)) {
    process.exitCode = 1;
  }
}

module.exports = {
  detectTerminalApp,
  focusAgentSession,
  parseTtyFromLsof,
};
