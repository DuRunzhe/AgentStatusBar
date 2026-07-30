#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function shellQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function installClaudeStatusLine({
  configDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude'),
  collectorPath = path.join(__dirname, 'claude-statusline.js'),
} = {}) {
  const settingsPath = path.join(configDir, 'settings.json');
  const integrationPath = path.join(configDir, 'agent-statusbar-statusline.json');
  const settings = readJson(settingsPath, {});
  const existingIntegration = readJson(integrationPath, null);
  const collectorCommand = `/usr/bin/env node ${shellQuote(collectorPath)}`;
  const currentStatusLine = settings.statusLine || null;

  let previousStatusLine = null;
  if (existingIntegration && currentStatusLine?.command === existingIntegration.collector_command) {
    previousStatusLine = existingIntegration.previous_status_line || null;
  } else if (currentStatusLine?.command !== collectorCommand) {
    if (currentStatusLine && currentStatusLine.type !== 'command') {
      throw new Error(`Unsupported existing Claude statusLine type: ${currentStatusLine.type}`);
    }
    previousStatusLine = currentStatusLine;
  }

  writeJsonAtomic(integrationPath, {
    version: 1,
    collector_command: collectorCommand,
    previous_status_line: previousStatusLine,
  });

  settings.statusLine = {
    ...(currentStatusLine || {}),
    type: 'command',
    command: collectorCommand,
  };
  writeJsonAtomic(settingsPath, settings);
  return { settingsPath, integrationPath, collectorCommand };
}

if (require.main === module) {
  const { settingsPath } = installClaudeStatusLine();
  console.log(`Claude context collector configured in ${settingsPath}`);
}

module.exports = { installClaudeStatusLine };
