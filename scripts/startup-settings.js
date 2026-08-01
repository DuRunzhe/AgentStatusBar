#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { detectLocale } = require('./i18n');
const { escapeAppleScript, showDialog } = require('./notification-settings');

const LABEL = 'com.agentstatusbar.monitor';
const LEGACY_LABEL = 'openclaw.agent-monitor';
const APP_NAME = 'AgentStatusBar';

const COPY = {
  en: {
    title: 'Start at login',
    enableMessage: `${APP_NAME} will install a user LaunchAgent and start the monitor automatically when you sign in. System Settings will then open; make sure SwiftBar is also enabled under “Open at Login”.`,
    disableMessage: `Disable automatic startup for the ${APP_NAME} background service?`,
    enable: 'Enable',
    disable: 'Disable',
    cancel: 'Cancel',
    success: 'Automatic startup is enabled. In System Settings, make sure SwiftBar is enabled under “Open at Login” so the menu bar icon also appears after sign-in.',
    disabled: 'Automatic startup has been disabled.',
    failed: `The startup setting could not be changed. Check the ${APP_NAME} installation and try again.`,
    ok: 'OK',
  },
  'zh-Hans': {
    title: '开机自启',
    enableMessage: `${APP_NAME} 将安装用户级启动服务，在你登录 Mac 后自动运行监控。随后会打开系统“登录项”设置，请确认 SwiftBar 也已在“登录时打开”中启用。`,
    disableMessage: `确定关闭 ${APP_NAME} 后台服务的开机自启吗？`,
    enable: '开启',
    disable: '关闭',
    cancel: '取消',
    success: '开机自启已开启。请在系统设置中确认 SwiftBar 已在“登录时打开”中启用，以便登录后自动显示菜单栏图标。',
    disabled: '开机自启已关闭。',
    failed: `无法修改开机自启设置，请检查 ${APP_NAME} 安装后重试。`,
    ok: '确定',
  },
  'zh-Hant': {
    title: '登入時自動啟動',
    enableMessage: `${APP_NAME} 將安裝使用者層級啟動服務，在你登入 Mac 後自動執行監控。接著會開啟系統「登入項目」設定，請確認 SwiftBar 也已在「登入時開啟」中啟用。`,
    disableMessage: `確定關閉 ${APP_NAME} 背景服務的自動啟動嗎？`,
    enable: '開啟',
    disable: '關閉',
    cancel: '取消',
    success: '自動啟動已開啟。請在系統設定中確認 SwiftBar 已在「登入時開啟」中啟用，讓選單列圖示也會在登入後顯示。',
    disabled: '自動啟動已關閉。',
    failed: `無法修改自動啟動設定，請檢查 ${APP_NAME} 安裝後再試一次。`,
    ok: '確定',
  },
};

function launchAgentPath(home = os.homedir()) {
  return path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function serviceTarget(uid = process.getuid()) {
  return `gui/${uid}/${LABEL}`;
}

function legacyLaunchAgentPath(home = os.homedir()) {
  return path.join(home, 'Library', 'LaunchAgents', `${LEGACY_LABEL}.plist`);
}

function legacyServiceTarget(uid = process.getuid()) {
  return `gui/${uid}/${LEGACY_LABEL}`;
}

function plistContent(nodePath, daemonPath) {
  const xml = value => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(nodePath)}</string><string>${xml(daemonPath)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>/tmp/agent-monitor.stdout.log</string>
  <key>StandardErrorPath</key><string>/tmp/agent-monitor.stderr.log</string>
</dict>
</plist>
`;
}

function isStartupEnabled({ home = os.homedir(), exists = fs.existsSync } = {}) {
  return exists(launchAgentPath(home));
}

function openLoginItems(run = execFileSync) {
  run('/usr/bin/open', ['x-apple.systempreferences:com.apple.LoginItems-Settings.extension'], {
    stdio: 'ignore',
    timeout: 5000,
  });
}

function installStartup({
  home = os.homedir(),
  nodePath = process.execPath,
  daemonPath = path.join(__dirname, 'agent-monitor.js'),
  uid = process.getuid(),
  run = execFileSync,
} = {}) {
  const plist = launchAgentPath(home);
  fs.mkdirSync(path.dirname(plist), { recursive: true, mode: 0o700 });
  const temporary = `${plist}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, plistContent(nodePath, daemonPath), { mode: 0o600 });
  fs.renameSync(temporary, plist);
  try { run('/bin/launchctl', ['bootout', serviceTarget(uid)], { stdio: 'ignore', timeout: 5000 }); } catch {}
  try { run('/bin/launchctl', ['bootout', legacyServiceTarget(uid)], { stdio: 'ignore', timeout: 5000 }); } catch {}
  const legacyPlist = legacyLaunchAgentPath(home);
  if (fs.existsSync(legacyPlist)) fs.unlinkSync(legacyPlist);
  run('/bin/launchctl', ['bootstrap', `gui/${uid}`, plist], { stdio: 'ignore', timeout: 10000 });
  run('/bin/launchctl', ['enable', serviceTarget(uid)], { stdio: 'ignore', timeout: 5000 });
  return plist;
}

function uninstallStartup({ home = os.homedir(), uid = process.getuid(), run = execFileSync } = {}) {
  try { run('/bin/launchctl', ['bootout', serviceTarget(uid)], { stdio: 'ignore', timeout: 5000 }); } catch {}
  try { run('/bin/launchctl', ['bootout', legacyServiceTarget(uid)], { stdio: 'ignore', timeout: 5000 }); } catch {}
  const plist = launchAgentPath(home);
  if (fs.existsSync(plist)) fs.unlinkSync(plist);
  const legacyPlist = legacyLaunchAgentPath(home);
  if (fs.existsSync(legacyPlist)) fs.unlinkSync(legacyPlist);
}

function showNotice(message, copy, run) {
  showDialog(message, copy.title, [copy.ok], copy.ok, null, run);
}

function toggleStartup({ locale = detectLocale(), home = os.homedir(), run = execFileSync } = {}) {
  const copy = COPY[locale] || COPY.en;
  const enabled = isStartupEnabled({ home });
  const action = enabled ? copy.disable : copy.enable;
  const choice = showDialog(
    enabled ? copy.disableMessage : copy.enableMessage,
    copy.title,
    [copy.cancel, action],
    action,
    copy.cancel,
    run
  );
  if (choice !== action) return { enabled, reason: 'cancelled' };
  try {
    if (enabled) {
      uninstallStartup({ home, run });
      showNotice(copy.disabled, copy, run);
      return { enabled: false, reason: 'disabled' };
    }
    installStartup({ home, run });
    try { openLoginItems(run); } catch {}
    showNotice(copy.success, copy, run);
    return { enabled: true, reason: 'enabled' };
  } catch {
    showNotice(copy.failed, copy, run);
    return { enabled, reason: 'failed' };
  }
}

if (require.main === module) {
  const command = process.argv[2];
  if (command === 'status') process.stdout.write(isStartupEnabled() ? 'true\n' : 'false\n');
  else if (command === 'toggle') process.stdout.write(`${JSON.stringify(toggleStartup())}\n`);
  else if (command === 'open-settings') openLoginItems();
  else process.exitCode = 1;
}

module.exports = {
  APP_NAME,
  COPY,
  LABEL,
  LEGACY_LABEL,
  installStartup,
  isStartupEnabled,
  launchAgentPath,
  legacyLaunchAgentPath,
  legacyServiceTarget,
  openLoginItems,
  plistContent,
  serviceTarget,
  toggleStartup,
  uninstallStartup,
};
