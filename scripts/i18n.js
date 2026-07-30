'use strict';

const { execFileSync } = require('child_process');

const DEFAULT_LOCALE = 'en';

const MESSAGES = {
  en: {
    status: {
      working: 'Working',
      ready: 'Ready',
      waiting: 'Needs confirmation',
      stopped: 'Stopped',
      unknown: 'Unknown',
    },
    noActivity: 'No activity',
    countWorking: count => `${count} working`,
    countReady: count => `${count} ready`,
    countWaiting: count => `${count} waiting`,
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
    menu: {
      daemonNotRunning: 'Monitor daemon is not running',
      startDaemon: 'Start monitor daemon',
      lastUpdated: 'Last updated',
      refreshNow: 'Refresh now',
      restartDaemon: 'Restart monitor daemon',
    },
  },
  'zh-Hans': {
    status: {
      working: '进行中',
      ready: '就绪',
      waiting: '等待确认',
      stopped: '已停止',
      unknown: '未知',
    },
    noActivity: '无活动',
    countWorking: count => `${count}个进行`,
    countReady: count => `${count}个就绪`,
    countWaiting: count => `${count}个等待`,
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
    menu: {
      daemonNotRunning: '监控守护进程未启动',
      startDaemon: '启动守护进程',
      lastUpdated: '上次刷新',
      refreshNow: '立即刷新',
      restartDaemon: '重启守护进程',
    },
  },
  'zh-Hant': {
    status: {
      working: '進行中',
      ready: '就緒',
      waiting: '等待確認',
      stopped: '已停止',
      unknown: '未知',
    },
    noActivity: '無活動',
    countWorking: count => `${count} 個進行中`,
    countReady: count => `${count} 個就緒`,
    countWaiting: count => `${count} 個等待`,
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
    menu: {
      daemonNotRunning: '監控常駐程式未啟動',
      startDaemon: '啟動監控常駐程式',
      lastUpdated: '上次更新',
      refreshNow: '立即重新整理',
      restartDaemon: '重新啟動監控常駐程式',
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
