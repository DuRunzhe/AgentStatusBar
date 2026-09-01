#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const path = require('path');

const SUPPORTED_LOCALES = ['system', 'en', 'zh-Hans', 'zh-Hant'];

const CONFIG_KEYS = [
  'stoppedAgents',
  'duration',
  'model',
  'contextPercent',
  'contextUsed',
  'contextTotal',
];

const DEFAULT_DISPLAY_CONFIG = Object.freeze({
  ...Object.fromEntries(CONFIG_KEYS.map(key => [key, true])),
  browserTabReuse: false,
  notifications: false,
  notifyWaitingConfirmation: true,
  notifyWaitingReply: true,
  showWaitingNotificationsInAutoConfirmMode: true,
  locale: 'system',
});

const DEFAULT_CONFIG_FILE = process.env.AGENT_STATUSBAR_CONFIG_FILE || path.join(
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
  if (typeof value.notifyWaitingConfirmation === 'boolean') config.notifyWaitingConfirmation = value.notifyWaitingConfirmation;
  if (typeof value.notifyWaitingReply === 'boolean') config.notifyWaitingReply = value.notifyWaitingReply;
  if (typeof value.showWaitingNotificationsInAutoConfirmMode === 'boolean') {
    config.showWaitingNotificationsInAutoConfirmMode = value.showWaitingNotificationsInAutoConfirmMode;
  }
  if (typeof value.browserTabReuse === 'boolean') config.browserTabReuse = value.browserTabReuse;
  if (SUPPORTED_LOCALES.includes(value.locale)) config.locale = value.locale;
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

function setDisplayConfig(key, enabled, configFile = DEFAULT_CONFIG_FILE) {
  if (!CONFIG_KEYS.includes(key)) throw new Error(`Unknown display setting: ${key}`);
  const config = readDisplayConfig(configFile);
  config[key] = enabled === true;
  return writeDisplayConfig(config, configFile);
}

function toggleDisplayConfig(key, configFile = DEFAULT_CONFIG_FILE) {
  if (!CONFIG_KEYS.includes(key)) throw new Error(`Unknown display setting: ${key}`);
  const config = readDisplayConfig(configFile);
  return setDisplayConfig(key, !config[key], configFile);
}

function setNotificationsEnabled(enabled, configFile = DEFAULT_CONFIG_FILE) {
  const config = readDisplayConfig(configFile);
  config.notifications = enabled === true;
  return writeDisplayConfig(config, configFile);
}

function setNotificationPreference(key, enabled, configFile = DEFAULT_CONFIG_FILE) {
  if (!['notifyWaitingConfirmation', 'notifyWaitingReply', 'showWaitingNotificationsInAutoConfirmMode'].includes(key)) {
    throw new Error(`Unknown notification preference: ${key}`);
  }
  const config = readDisplayConfig(configFile);
  config[key] = enabled === true;
  return writeDisplayConfig(config, configFile);
}

function setAutoConfirmWaitingNotificationsEnabled(enabled, configFile = DEFAULT_CONFIG_FILE) {
  return setNotificationPreference('showWaitingNotificationsInAutoConfirmMode', enabled, configFile);
}

function setBrowserTabReuseEnabled(enabled, configFile = DEFAULT_CONFIG_FILE) {
  const config = readDisplayConfig(configFile);
  config.browserTabReuse = enabled === true;
  return writeDisplayConfig(config, configFile);
}

function setLocale(locale, configFile = DEFAULT_CONFIG_FILE) {
  if (!SUPPORTED_LOCALES.includes(locale)) throw new Error(`Unknown locale: ${locale}`);
  const config = readDisplayConfig(configFile);
  config.locale = locale;
  return writeDisplayConfig(config, configFile);
}

function restartMonitor(run = execFileSync) {
  run('/bin/bash', [path.join(__dirname, 'restart-agent-monitor.sh')], {
    stdio: 'ignore',
  });
}

if (require.main === module) {
  const [command, key, value] = process.argv.slice(2);
  try {
    if (command === 'toggle') toggleDisplayConfig(key);
    else if (command === 'set' && (value === 'true' || value === 'false')) {
      setDisplayConfig(key, value === 'true');
    } else if (command === 'set-locale') {
      setLocale(key);
      restartMonitor();
    } else if (command === 'get-locale') {
      process.stdout.write(`${readDisplayConfig().locale}\n`);
    } else process.exitCode = 1;
  } catch {
    process.exitCode = 1;
  }
}

module.exports = {
  CONFIG_KEYS,
  DEFAULT_CONFIG_FILE,
  SUPPORTED_LOCALES,
  DEFAULT_DISPLAY_CONFIG,
  normalizeDisplayConfig,
  readDisplayConfig,
  setAutoConfirmWaitingNotificationsEnabled,
  setBrowserTabReuseEnabled,
  setDisplayConfig,
  setNotificationPreference,
  setNotificationsEnabled,
  setLocale,
  restartMonitor,
  toggleDisplayConfig,
  writeDisplayConfig,
};
