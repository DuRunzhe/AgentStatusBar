#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_KEYS = [
  'duration',
  'model',
  'contextPercent',
  'contextUsed',
  'contextTotal',
];

const DEFAULT_DISPLAY_CONFIG = Object.freeze({
  ...Object.fromEntries(CONFIG_KEYS.map(key => [key, true])),
  notifications: false,
});

const DEFAULT_CONFIG_FILE = path.join(
  os.homedir(),
  '.config',
  'agent-statusbar',
  'config.json'
);

function normalizeDisplayConfig(value) {
  const config = { ...DEFAULT_DISPLAY_CONFIG };
  if (!value || typeof value !== 'object') return config;
  for (const key of CONFIG_KEYS) {
    if (typeof value[key] === 'boolean') config[key] = value[key];
  }
  if (typeof value.notifications === 'boolean') config.notifications = value.notifications;
  return config;
}

function readDisplayConfig(configFile = DEFAULT_CONFIG_FILE) {
  try {
    return normalizeDisplayConfig(JSON.parse(fs.readFileSync(configFile, 'utf8')));
  } catch {
    return { ...DEFAULT_DISPLAY_CONFIG };
  }
}

function writeDisplayConfig(config, configFile = DEFAULT_CONFIG_FILE) {
  const normalized = normalizeDisplayConfig(config);
  const directory = path.dirname(configFile);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${configFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, configFile);
  return normalized;
}

function toggleDisplayConfig(key, configFile = DEFAULT_CONFIG_FILE) {
  if (!CONFIG_KEYS.includes(key)) throw new Error(`Unknown display setting: ${key}`);
  const config = readDisplayConfig(configFile);
  config[key] = !config[key];
  return writeDisplayConfig(config, configFile);
}

function setNotificationsEnabled(enabled, configFile = DEFAULT_CONFIG_FILE) {
  const config = readDisplayConfig(configFile);
  config.notifications = enabled === true;
  return writeDisplayConfig(config, configFile);
}

if (require.main === module) {
  const [command, key] = process.argv.slice(2);
  try {
    if (command === 'toggle') toggleDisplayConfig(key);
    else process.exitCode = 1;
  } catch {
    process.exitCode = 1;
  }
}

module.exports = {
  CONFIG_KEYS,
  DEFAULT_CONFIG_FILE,
  DEFAULT_DISPLAY_CONFIG,
  normalizeDisplayConfig,
  readDisplayConfig,
  setNotificationsEnabled,
  toggleDisplayConfig,
  writeDisplayConfig,
};
