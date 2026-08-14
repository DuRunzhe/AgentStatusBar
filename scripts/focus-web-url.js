#!/usr/bin/env node
'use strict';

const { execFileSync, spawnSync } = require('child_process');

function normalizeLocalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:') return null;
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) return null;
    return `http://127.0.0.1:${url.port || '80'}/`;
  } catch {
    return null;
  }
}

function buildBrowserFocusScript(url) {
  return `
(() => {
function normalizeUrl(rawUrl) {
  let value = String(rawUrl || '').trim();
  if (value.startsWith('http://localhost:')) {
    value = 'http://127.0.0.1:' + value.slice('http://localhost:'.length);
  }
  value = value.split('?')[0].split('#')[0];
  if (!value.endsWith('/')) value += '/';
  return value;
}

const targetUrl = normalizeUrl(${JSON.stringify(url)});

function getApplication(name) {
  try {
    return Application(name);
  } catch {
    return null;
  }
}

for (const browserName of ['Google Chrome', 'Microsoft Edge', 'Brave Browser']) {
  const browser = getApplication(browserName);
  if (!browser) continue;
  if (!browser.running()) continue;
  const windows = browser.windows();
  for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
    const tabs = windows[windowIndex].tabs();
    for (let tabIndex = 0; tabIndex < tabs.length; tabIndex += 1) {
      if (normalizeUrl(tabs[tabIndex].url()) === targetUrl) {
        windows[windowIndex].activeTabIndex = tabIndex + 1;
        windows[windowIndex].index = 1;
        browser.activate();
        return browserName;
      }
    }
  }
}

const safari = getApplication('Safari');
if (safari && safari.running()) {
  const windows = safari.windows();
  for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
    const tabs = windows[windowIndex].tabs();
    for (let tabIndex = 0; tabIndex < tabs.length; tabIndex += 1) {
      if (normalizeUrl(tabs[tabIndex].url()) === targetUrl) {
        windows[windowIndex].currentTab = tabs[tabIndex];
        windows[windowIndex].index = 1;
        safari.activate();
        return 'Safari';
      }
    }
  }
}

return '';
})();
`;
}

function focusExistingBrowserTab(url) {
  const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', buildBrowserFocusScript(url)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  });
  return {
    focused: result.status === 0 && Boolean(result.stdout.trim()),
    automationDenied: result.stderr.includes('-1743'),
  };
}

function isAppRunning(appName) {
  const result = spawnSync('/usr/bin/osascript', [
    '-e',
    `application "${appName.replaceAll('"', '\\"')}" is running`,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 1000,
  });
  return result.status === 0 && result.stdout.trim() === 'true';
}

function activateFirstRunningBrowser(appNames = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Safari']) {
  const appName = appNames.find(isAppRunning);
  if (!appName) return false;
  try {
    execFileSync('/usr/bin/open', ['-a', appName], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function focusWebUrl(value, { reuseTabs = false } = {}) {
  const url = normalizeLocalUrl(value);
  if (!url) return false;
  if (reuseTabs) {
    const tabFocus = focusExistingBrowserTab(url);
    if (tabFocus.focused) return true;
    if (tabFocus.automationDenied && activateFirstRunningBrowser()) return true;
  } else if (activateFirstRunningBrowser()) {
    return true;
  }
  try {
    execFileSync('/usr/bin/open', [url], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

if (require.main === module) {
  if (!focusWebUrl(process.argv[2], { reuseTabs: process.argv[3] === 'reuse-tabs' })) {
    process.exitCode = 1;
  }
}

module.exports = {
  activateFirstRunningBrowser,
  buildBrowserFocusScript,
  focusWebUrl,
  isAppRunning,
  normalizeLocalUrl,
};
