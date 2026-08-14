#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const { readDisplayConfig, setBrowserTabReuseEnabled } = require('./display-config');
const { detectLocale } = require('./i18n');
const { showDialog } = require('./notification-settings');

const COPY = {
  en: {
    setupTitle: 'Reuse browser tabs',
    setupMessage: 'AgentStatusBar can reuse existing DeepSeek Harness browser tabs by reading browser tab URLs through macOS Automation. Chrome, Edge, Brave, or Safari must allow this access.',
    continue: 'Continue',
    cancel: 'Cancel',
    verifyTitle: 'Verify Automation permission',
    verifyMessage: 'If macOS asked for Automation permission, allow access to your browser. Did you grant the permission?',
    enabled: 'Granted',
    notYet: 'Not yet',
    successMessage: 'Browser tab reuse is enabled.',
    automationSettings: 'macOS Automation settings could not be opened automatically. Open System Settings → Privacy & Security → Automation manually.',
    ok: 'OK',
  },
  'zh-Hans': {
    setupTitle: '复用浏览器标签页',
    setupMessage: 'AgentStatusBar 可以通过 macOS 自动化读取浏览器标签 URL，从而复用已有的 DeepSeek Harness 页面。Chrome、Edge、Brave 或 Safari 需要允许该访问。',
    continue: '继续',
    cancel: '取消',
    verifyTitle: '验证自动化权限',
    verifyMessage: '如果 macOS 弹出了自动化权限请求，请允许访问浏览器。你是否已经授权？',
    enabled: '已授权',
    notYet: '还没有',
    successMessage: '浏览器标签页复用已开启。',
    automationSettings: '无法自动打开 macOS 自动化设置。请手动进入“系统设置 → 隐私与安全性 → 自动化”。',
    ok: '确定',
  },
  'zh-Hant': {
    setupTitle: '重用瀏覽器分頁',
    setupMessage: 'AgentStatusBar 可以透過 macOS 自動化讀取瀏覽器分頁 URL，從而重用既有的 DeepSeek Harness 頁面。Chrome、Edge、Brave 或 Safari 需要允許此存取。',
    continue: '繼續',
    cancel: '取消',
    verifyTitle: '驗證自動化權限',
    verifyMessage: '如果 macOS 彈出了自動化權限請求，請允許存取瀏覽器。你是否已經授權？',
    enabled: '已授權',
    notYet: '還沒有',
    successMessage: '瀏覽器分頁重用已開啟。',
    automationSettings: '無法自動開啟 macOS 自動化設定。請手動進入「系統設定 → 隱私權與安全性 → 自動化」。',
    ok: '確定',
  },
};

function buildAutomationProbeScript() {
  return 'tell application "Google Chrome" to if it is running then get URL of tabs of windows';
}

function probeBrowserAutomation(run = execFileSync) {
  try {
    run('/usr/bin/osascript', ['-e', buildAutomationProbeScript()], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    return { ok: true, reason: 'authorized' };
  } catch (error) {
    const stderr = String(error?.stderr || '');
    return { ok: false, reason: stderr.includes('-1743') ? 'denied' : 'failed' };
  }
}

function openAutomationSettings(run = execFileSync) {
  run('/usr/bin/open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'], {
    stdio: 'ignore',
    timeout: 5000,
  });
}

function showNotice(message, title, button, run = execFileSync) {
  return showDialog(message, title, [button], button, null, run);
}

function configureBrowserTabReuse({
  configFile,
  locale = detectLocale(),
  run = execFileSync,
} = {}) {
  const copy = COPY[locale] || COPY.en;
  const current = readDisplayConfig(configFile);
  if (current.browserTabReuse === true) {
    setBrowserTabReuseEnabled(false, configFile);
    return { enabled: false, reason: 'disabled' };
  }

  const setupChoice = showDialog(
    copy.setupMessage,
    copy.setupTitle,
    [copy.cancel, copy.continue],
    copy.continue,
    copy.cancel,
    run
  );
  if (setupChoice !== copy.continue) return { enabled: false, reason: 'setup-cancelled' };

  const probe = probeBrowserAutomation(run);
  if (!probe.ok) {
    try {
      openAutomationSettings(run);
    } catch {
      showNotice(copy.automationSettings, copy.setupTitle, copy.ok, run);
    }
    const verified = showDialog(
      copy.verifyMessage,
      copy.verifyTitle,
      [copy.notYet, copy.enabled],
      copy.enabled,
      copy.notYet,
      run
    );
    if (verified !== copy.enabled) return { enabled: false, reason: probe.reason };
  }

  setBrowserTabReuseEnabled(true, configFile);
  showNotice(copy.successMessage, copy.setupTitle, copy.ok, run);
  return { enabled: true, reason: probe.ok ? 'verified' : 'user-verified' };
}

if (require.main === module) {
  const command = process.argv[2];
  if (command === 'toggle') {
    process.stdout.write(`${JSON.stringify(configureBrowserTabReuse())}\n`);
  } else if (command === 'open-settings') {
    openAutomationSettings();
  } else {
    process.exitCode = 1;
  }
}

module.exports = {
  COPY,
  buildAutomationProbeScript,
  configureBrowserTabReuse,
  openAutomationSettings,
  probeBrowserAutomation,
  showNotice,
};
