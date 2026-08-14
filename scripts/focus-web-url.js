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
  const escapedUrl = url.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `
on normalizeUrl(rawUrl)
  if rawUrl starts with "http://localhost:" then
    set rawUrl to "http://127.0.0.1:" & text 18 thru -1 of rawUrl
  end if
  if rawUrl contains "?" then set rawUrl to text 1 thru ((offset of "?" in rawUrl) - 1) of rawUrl
  if rawUrl contains "#" then set rawUrl to text 1 thru ((offset of "#" in rawUrl) - 1) of rawUrl
  if rawUrl does not end with "/" then set rawUrl to rawUrl & "/"
  return rawUrl
end normalizeUrl

set targetUrl to "${escapedUrl}"
set targetUrl to normalizeUrl(targetUrl)

set chromiumApps to {"Google Chrome", "Microsoft Edge", "Brave Browser"}
repeat with browserName in chromiumApps
  if application browserName is running then
    tell application browserName
      repeat with theWindow in windows
        repeat with theTab in tabs of theWindow
          if my normalizeUrl(URL of theTab as text) is targetUrl then
            set active tab index of theWindow to (index of theTab)
            set index of theWindow to 1
            activate
            return browserName
          end if
        end repeat
      end repeat
    end tell
  end if
end repeat

if application "Safari" is running then
  tell application "Safari"
    repeat with theWindow in windows
      repeat with theTab in tabs of theWindow
        if my normalizeUrl(URL of theTab as text) is targetUrl then
          set current tab of theWindow to theTab
          set index of theWindow to 1
          activate
          return "Safari"
        end if
      end repeat
    end repeat
  end tell
end if

return ""
`;
}

function focusExistingBrowserTab(url) {
  const result = spawnSync('/usr/bin/osascript', ['-e', buildBrowserFocusScript(url)], {
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

function focusWebUrl(value) {
  const url = normalizeLocalUrl(value);
  if (!url) return false;
  const tabFocus = focusExistingBrowserTab(url);
  if (tabFocus.focused) return true;
  if (tabFocus.automationDenied && activateFirstRunningBrowser()) return true;
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
  if (!focusWebUrl(process.argv[2])) {
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
