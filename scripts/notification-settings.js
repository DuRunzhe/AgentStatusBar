#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { readDisplayConfig, setNotificationsEnabled } = require('./display-config');
const { detectLocale } = require('./i18n');
const { findTerminalNotifier } = require('./notification-delivery');

const COPY = {
  en: {
    installTitle: 'Notification dependency',
    installMessage: 'Clickable notifications require terminal-notifier. Install it with Homebrew now?',
    install: 'Install',
    cancel: 'Cancel',
    installing: 'Installing terminal-notifier…',
    installFailed: 'terminal-notifier could not be installed. Check Homebrew and try again.',
    settingsFailed: 'macOS Notification settings could not be opened. Open System Settings → Notifications manually and try again.',
    setupTitle: 'Enable notifications',
    setupMessage: 'A test notification will be sent, then macOS Notification settings will open. Enable notifications and banners for terminal-notifier.',
    openSettings: 'Open Settings',
    verifyTitle: 'Verify notifications',
    verifyMessage: 'After enabling terminal-notifier in System Settings, did you see the AgentStatusBar test notification?',
    enabled: 'I saw it',
    notYet: 'Not yet',
    testSubtitle: 'Permission test',
    testMessage: 'If you can see this notification, return and confirm that notifications are enabled.',
    successMessage: 'Notifications are enabled. Future alerts can be clicked to open the matching Agent session.',
    ok: 'OK',
  },
  'zh-Hans': {
    installTitle: '通知依赖',
    installMessage: '通知点击跳转需要 terminal-notifier。是否现在通过 Homebrew 安装？',
    install: '安装',
    cancel: '取消',
    installing: '正在安装 terminal-notifier…',
    installFailed: 'terminal-notifier 安装失败，请检查 Homebrew 后重试。',
    settingsFailed: '无法打开 macOS 通知设置，请手动进入“系统设置 → 通知”后重试。',
    setupTitle: '开启通知',
    setupMessage: '接下来会发送一条测试通知并打开 macOS 通知设置。请为 terminal-notifier 开启“允许通知”和横幅。',
    openSettings: '打开设置',
    verifyTitle: '验证通知',
    verifyMessage: '在系统设置中开启 terminal-notifier 后，你是否看到了 AgentStatusBar 测试通知？',
    enabled: '已看到',
    notYet: '还没有',
    testSubtitle: '通知权限测试',
    testMessage: '如果你看到了这条通知，请返回并确认通知已经开启。',
    successMessage: '通知已开启，后续提醒可点击跳转到对应 Agent 会话。',
    ok: '确定',
  },
  'zh-Hant': {
    installTitle: '通知相依套件',
    installMessage: '通知點擊跳轉需要 terminal-notifier。是否現在透過 Homebrew 安裝？',
    install: '安裝',
    cancel: '取消',
    installing: '正在安裝 terminal-notifier…',
    installFailed: 'terminal-notifier 安裝失敗，請檢查 Homebrew 後重試。',
    settingsFailed: '無法開啟 macOS 通知設定，請手動進入「系統設定 → 通知」後重試。',
    setupTitle: '開啟通知',
    setupMessage: '接下來會傳送一則測試通知並開啟 macOS 通知設定。請為 terminal-notifier 開啟「允許通知」和橫幅。',
    openSettings: '開啟設定',
    verifyTitle: '驗證通知',
    verifyMessage: '在系統設定中開啟 terminal-notifier 後，你是否看到了 AgentStatusBar 測試通知？',
    enabled: '已看到',
    notYet: '還沒有',
    testSubtitle: '通知權限測試',
    testMessage: '如果你看到了這則通知，請返回並確認通知已經開啟。',
    successMessage: '通知已開啟，後續提醒可點擊跳轉到對應 Agent 會話。',
    ok: '確定',
  },
};

function escapeAppleScript(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function showDialog(message, title, buttons, defaultButton, cancelButton, run = execFileSync) {
  const buttonList = buttons.map(button => `"${escapeAppleScript(button)}"`).join(', ');
  const cancelClause = cancelButton ? ` cancel button "${escapeAppleScript(cancelButton)}"` : '';
  const script = `display dialog "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}" buttons {${buttonList}} default button "${escapeAppleScript(defaultButton)}"${cancelClause}`;
  try {
    const output = run('/usr/bin/osascript', ['-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 300_000,
    });
    return output.match(/button returned:([^,\n]+)/)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function showNotice(message, title, button, run = execFileSync) {
  return showDialog(message, title, [button], button, null, run);
}

function findBrew(exists = fs.existsSync) {
  return ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(exists) || null;
}

function openSystemNotificationSettings(run = execFileSync) {
  run('/usr/bin/open', ['x-apple.systempreferences:com.apple.Notifications-Settings.extension'], {
    stdio: 'ignore',
    timeout: 5000,
  });
}

function configureNotifications({
  configFile,
  locale = detectLocale(),
  exists = fs.existsSync,
  run = execFileSync,
} = {}) {
  const copy = COPY[locale] || COPY.en;
  const current = readDisplayConfig(configFile);
  if (current.notifications === true) {
    setNotificationsEnabled(false, configFile);
    return { enabled: false, reason: 'disabled' };
  }

  let notifierPath = findTerminalNotifier(process.env, exists);
  if (!notifierPath) {
    const choice = showDialog(
      copy.installMessage,
      copy.installTitle,
      [copy.cancel, copy.install],
      copy.install,
      copy.cancel,
      run
    );
    if (choice !== copy.install) return { enabled: false, reason: 'install-declined' };

    const brewPath = findBrew(exists);
    if (!brewPath) {
      showNotice(copy.installFailed, copy.installTitle, copy.ok, run);
      return { enabled: false, reason: 'brew-missing' };
    }
    try {
      run('/usr/bin/osascript', [
        '-e',
        `display notification "${escapeAppleScript(copy.installing)}" with title "AgentStatusBar"`,
      ], { stdio: 'ignore', timeout: 3000 });
    } catch { /* progress notification is optional */ }
    try {
      run(brewPath, ['install', 'terminal-notifier'], {
        encoding: 'utf8',
        stdio: 'ignore',
        timeout: 600_000,
      });
    } catch {
      showNotice(copy.installFailed, copy.installTitle, copy.ok, run);
      return { enabled: false, reason: 'install-failed' };
    }
    notifierPath = findTerminalNotifier(process.env, exists);
    if (!notifierPath) return { enabled: false, reason: 'install-not-found' };
  }

  const setupChoice = showDialog(
    copy.setupMessage,
    copy.setupTitle,
    [copy.cancel, copy.openSettings],
    copy.openSettings,
    copy.cancel,
    run
  );
  if (setupChoice !== copy.openSettings) return { enabled: false, reason: 'setup-cancelled' };

  try {
    run(notifierPath, [
      '-title', 'AgentStatusBar',
      '-subtitle', copy.testSubtitle,
      '-message', copy.testMessage,
      '-sound', 'default',
      '-group', 'agent-statusbar-permission-test',
    ], { stdio: 'ignore', timeout: 5000 });
  } catch { /* a denied notification may fail before Settings is opened */ }

  try {
    openSystemNotificationSettings(run);
  } catch {
    showNotice(copy.settingsFailed, copy.setupTitle, copy.ok, run);
    return { enabled: false, reason: 'setup-failed' };
  }

  const verified = showDialog(
    copy.verifyMessage,
    copy.verifyTitle,
    [copy.notYet, copy.enabled],
    copy.enabled,
    copy.notYet,
    run
  );
  if (verified !== copy.enabled) return { enabled: false, reason: 'not-verified' };

  setNotificationsEnabled(true, configFile);
  showNotice(copy.successMessage, copy.setupTitle, copy.ok, run);
  return { enabled: true, reason: 'verified' };
}

if (require.main === module) {
  const command = process.argv[2];
  if (command === 'toggle') {
    process.stdout.write(`${JSON.stringify(configureNotifications())}\n`);
  } else if (command === 'open-settings') {
    openSystemNotificationSettings();
  } else {
    process.exitCode = 1;
  }
}

module.exports = {
  COPY,
  configureNotifications,
  escapeAppleScript,
  findBrew,
  openSystemNotificationSettings,
  showDialog,
};
