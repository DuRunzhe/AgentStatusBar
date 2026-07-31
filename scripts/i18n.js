'use strict';

const { execFileSync } = require('child_process');

const DEFAULT_LOCALE = 'en';

const MESSAGES = {
  en: {
    status: {
      working: 'Working',
      ready: 'Ready',
      waiting: 'Needs confirmation',
      waitingReply: 'Waiting for reply',
      stopped: 'Stopped',
      unknown: 'Unknown',
    },
    noActivity: 'No activity',
    countWorking: count => `${count} working`,
    countReady: count => `${count} ready`,
    countWaiting: count => `${count} awaiting confirmation`,
    countWaitingReply: count => `${count} awaiting reply`,
    lastActivity: value => `Last activity ${value} ago`,
    notificationMessages: [
      target => `${target} is waiting for confirmation`,
      target => `${target} is still waiting for confirmation (1 minute)`,
      target => `${target} has waited 3 minutes for confirmation. Please respond soon.`,
    ],
    notificationSubtitles: [
      agent => `${agent} needs confirmation`,
      agent => `${agent} is still waiting`,
      agent => `${agent} final reminder`,
    ],
    replyNotificationMessages: [
      target => `${target} is waiting for your reply`,
      target => `${target} is still waiting for your reply (1 minute)`,
      target => `${target} has waited 3 minutes for your reply. Please respond soon.`,
    ],
    replyNotificationSubtitles: [
      agent => `${agent} needs your reply`,
      agent => `${agent} is still waiting for your reply`,
      agent => `${agent} final reply reminder`,
    ],
    menu: {
      daemonNotRunning: 'Monitor daemon is not running',
      startDaemon: 'Start monitor daemon',
      lastUpdated: 'Last updated',
      refreshNow: 'Refresh now',
      restartDaemon: 'Restart monitor daemon',
      settings: 'Settings',
      notifications: 'Notifications',
      enableNotifications: 'Click to enable notifications',
      disableNotifications: 'Click to disable notifications',
      openNotificationSettings: 'Open System Notification Settings',
      notificationSettingsApp: 'App shown in Notifications: terminal-notifier',
      displayConfig: 'Display options',
      showDuration: 'Duration',
      showModel: 'Model',
      showContextPercent: 'Context usage percentage',
      showContextUsed: 'Context used',
      showContextTotal: 'Total context',
      contextUsed: 'Used',
      contextTotal: 'Total',
    },
  },
  'zh-Hans': {
    status: {
      working: '进行中',
      ready: '就绪',
      waiting: '等待确认',
      waitingReply: '等待回复',
      stopped: '已停止',
      unknown: '未知',
    },
    noActivity: '无活动',
    countWorking: count => `${count}个进行中`,
    countReady: count => `${count}个就绪`,
    countWaiting: count => `${count}个等待确认`,
    countWaitingReply: count => `${count}个等待回复`,
    lastActivity: value => `最后活动 ${value} 前`,
    notificationMessages: [
      target => `${target} 已进入 🟡 等待确认`,
      target => `${target} 仍在等待确认（已等待 1 分钟）`,
      target => `${target} 已等待确认 3 分钟，请尽快处理`,
    ],
    notificationSubtitles: [
      agent => `${agent} 等待确认`,
      agent => `${agent} 仍在等待`,
      agent => `${agent} 最后提醒`,
    ],
    replyNotificationMessages: [
      target => `${target} 正在等待你的回复`,
      target => `${target} 仍在等待你的回复（已等待 1 分钟）`,
      target => `${target} 已等待回复 3 分钟，请尽快处理`,
    ],
    replyNotificationSubtitles: [
      agent => `${agent} 等待回复`,
      agent => `${agent} 仍在等待回复`,
      agent => `${agent} 最后提醒`,
    ],
    menu: {
      daemonNotRunning: '监控守护进程未启动',
      startDaemon: '启动守护进程',
      lastUpdated: '上次刷新',
      refreshNow: '立即刷新',
      restartDaemon: '重启守护进程',
      settings: '设置',
      notifications: '通知',
      enableNotifications: '点击开启通知',
      disableNotifications: '点击关闭通知',
      openNotificationSettings: '打开系统通知设置',
      notificationSettingsApp: '通知中的应用名称：terminal-notifier',
      displayConfig: '显示配置',
      showDuration: '时长',
      showModel: '模型',
      showContextPercent: '上下文使用占比',
      showContextUsed: '已使用上下文',
      showContextTotal: '总上下文',
      contextUsed: '已用',
      contextTotal: '总量',
    },
  },
  'zh-Hant': {
    status: {
      working: '進行中',
      ready: '就緒',
      waiting: '等待確認',
      waitingReply: '等待回覆',
      stopped: '已停止',
      unknown: '未知',
    },
    noActivity: '無活動',
    countWorking: count => `${count} 個進行中`,
    countReady: count => `${count} 個就緒`,
    countWaiting: count => `${count} 個等待`,
    countWaitingReply: count => `${count} 個等待回覆`,
    lastActivity: value => `最後活動 ${value} 前`,
    notificationMessages: [
      target => `${target} 已進入 🟡 等待確認`,
      target => `${target} 仍在等待確認（已等待 1 分鐘）`,
      target => `${target} 已等待確認 3 分鐘，請儘快處理`,
    ],
    notificationSubtitles: [
      agent => `${agent} 等待確認`,
      agent => `${agent} 仍在等待`,
      agent => `${agent} 最後提醒`,
    ],
    replyNotificationMessages: [
      target => `${target} 正在等待你的回覆`,
      target => `${target} 仍在等待你的回覆（已等待 1 分鐘）`,
      target => `${target} 已等待回覆 3 分鐘，請儘快處理`,
    ],
    replyNotificationSubtitles: [
      agent => `${agent} 等待回覆`,
      agent => `${agent} 仍在等待回覆`,
      agent => `${agent} 最後提醒`,
    ],
    menu: {
      daemonNotRunning: '監控常駐程式未啟動',
      startDaemon: '啟動監控常駐程式',
      lastUpdated: '上次更新',
      refreshNow: '立即重新整理',
      restartDaemon: '重新啟動監控常駐程式',
      settings: '設定',
      notifications: '通知',
      enableNotifications: '點擊開啟通知',
      disableNotifications: '點擊關閉通知',
      openNotificationSettings: '開啟系統通知設定',
      notificationSettingsApp: '通知中的應用程式名稱：terminal-notifier',
      displayConfig: '顯示設定',
      showDuration: '時長',
      showModel: '模型',
      showContextPercent: '上下文使用比例',
      showContextUsed: '已使用上下文',
      showContextTotal: '總上下文',
      contextUsed: '已用',
      contextTotal: '總量',
    },
  },
};

function parseAppleLanguages(output) {
  if (!output) return [];
  return output
    .split('\n')
    .map(line => line.trim().replace(/^[,(]+|[),]+$/g, '').replace(/^"|"$/g, ''))
    .filter(line => line && line !== '(' && line !== ')');
}

function localeForLanguage(language) {
  const tag = String(language || '').replace(/_/g, '-').toLowerCase();
  if (tag === 'zh-hant' || tag.startsWith('zh-hant-') || /zh-(tw|hk|mo)(-|$)/.test(tag)) {
    return 'zh-Hant';
  }
  if (tag === 'zh' || tag === 'zh-hans' || tag.startsWith('zh-hans-') || /zh-(cn|sg)(-|$)/.test(tag)) {
    return 'zh-Hans';
  }
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  return null;
}

function localeForRegion(appleLocale) {
  const locale = String(appleLocale || '').split('@')[0];
  const match = locale.match(/(?:_|-)([A-Za-z]{2})(?:_|-|$)/);
  const region = match?.[1].toUpperCase();
  if (['TW', 'HK', 'MO'].includes(region)) return 'zh-Hant';
  if (['CN', 'SG'].includes(region)) return 'zh-Hans';
  return null;
}

function selectLocale(languages, appleLocale) {
  for (const language of languages || []) {
    const locale = localeForLanguage(language);
    if (locale) return locale;
  }
  return localeForRegion(appleLocale) || DEFAULT_LOCALE;
}

function readGlobalPreference(key) {
  try {
    return execFileSync('/usr/bin/defaults', ['read', '-g', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
  } catch {
    return '';
  }
}

function detectLocale(readPreference = readGlobalPreference) {
  const languages = parseAppleLanguages(readPreference('AppleLanguages'));
  const fallbackLanguage = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG;
  if (languages.length === 0 && fallbackLanguage) languages.push(fallbackLanguage);
  return selectLocale(languages, readPreference('AppleLocale'));
}

function getMessages(locale) {
  return MESSAGES[locale] || MESSAGES[DEFAULT_LOCALE];
}

function getUiStrings(locale) {
  const messages = getMessages(locale);
  return {
    ...messages.menu,
    statusStopped: messages.status.stopped,
    statusUnknown: messages.status.unknown,
  };
}

if (require.main === module) {
  const key = process.argv[2];
  const value = getUiStrings(detectLocale())[key];
  if (typeof value === 'string') process.stdout.write(value);
  else process.exitCode = 1;
}

module.exports = {
  DEFAULT_LOCALE,
  detectLocale,
  getMessages,
  getUiStrings,
  localeForLanguage,
  localeForRegion,
  parseAppleLanguages,
  selectLocale,
};
