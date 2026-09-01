'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectLocale,
  getMessages,
  getUiStrings,
  parseAppleLanguages,
  selectLocale,
} = require('./i18n');

test('parses macOS AppleLanguages output in preference order', () => {
  assert.deepEqual(parseAppleLanguages('(\n    "zh-Hans-CN",\n    "en-US"\n)'), [
    'zh-Hans-CN',
    'en-US',
  ]);
});

test('language takes priority over device region', () => {
  assert.equal(selectLocale(['en-US'], 'zh_CN'), 'en');
  assert.equal(selectLocale(['zh-Hant-HK'], 'en_US'), 'zh-Hant');
});

test('uses the first supported preferred language', () => {
  assert.equal(selectLocale(['fr-FR', 'zh-Hans-CN', 'en-US'], 'en_US'), 'zh-Hans');
});

test('falls back to region and then English', () => {
  assert.equal(selectLocale(['fr-FR'], 'zh_TW'), 'zh-Hant');
  assert.equal(selectLocale(['fr-FR'], 'de_DE'), 'en');
  assert.equal(selectLocale([], ''), 'en');
});

test('detects locale through injectable macOS preferences', () => {
  const preferences = {
    AppleLanguages: '(\n    "zh-Hans-CN"\n)',
    AppleLocale: 'en_US',
  };
  assert.equal(detectLocale(key => preferences[key]), 'zh-Hans');
});

test('provides English as the catalog fallback', () => {
  const messages = getMessages('unsupported');
  assert.equal(messages.status.ready, 'Ready');
  assert.equal(messages.status.waitingReply, 'Waiting for reply');
  assert.equal(messages.menu.refreshNow, 'Refresh now');
});

test('localizes the waiting for reply status', () => {
  assert.equal(getMessages('zh-Hans').status.waitingReply, '等待回复');
  assert.equal(getMessages('zh-Hant').status.waitingReply, '等待回覆');
});

test('localizes every start-at-login menu action', () => {
  const expected = {
    en: ['Start at login', 'Click to enable start at login', 'Click to disable start at login', 'Open Login Items Settings'],
    'zh-Hans': ['开机自启', '点击开启开机自启', '点击关闭开机自启', '打开系统登录项设置'],
    'zh-Hant': ['登入時自動啟動', '點擊開啟自動啟動', '點擊關閉自動啟動', '開啟系統登入項目設定'],
  };
  for (const [locale, labels] of Object.entries(expected)) {
    const menu = getMessages(locale).menu;
    assert.deepEqual([
      menu.startup,
      menu.enableStartup,
      menu.disableStartup,
      menu.openLoginItems,
    ], labels);
  }
});

test('localizes every browser tab reuse menu action', () => {
  const expected = {
    en: [
      'Browser tabs',
      'Click to enable browser tab reuse',
      'Click to disable browser tab reuse',
      'Open Automation Settings',
      'Requires browser Automation permission',
    ],
    'zh-Hans': [
      '浏览器标签页',
      '点击开启浏览器标签页复用',
      '点击关闭浏览器标签页复用',
      '打开系统自动化设置',
      '需要浏览器自动化权限',
    ],
    'zh-Hant': [
      '瀏覽器分頁',
      '點擊開啟瀏覽器分頁重用',
      '點擊關閉瀏覽器分頁重用',
      '開啟系統自動化設定',
      '需要瀏覽器自動化權限',
    ],
  };
  for (const [locale, labels] of Object.entries(expected)) {
    const menu = getMessages(locale).menu;
    assert.deepEqual([
      menu.browserTabs,
      menu.enableBrowserTabReuse,
      menu.disableBrowserTabReuse,
      menu.openAutomationSettings,
      menu.browserTabReusePermission,
    ], labels);
  }
});


test('localizes the language setting menu item', () => {
  assert.deepEqual([
    getUiStrings('en').language,
    getUiStrings('zh-Hans').language,
    getUiStrings('zh-Hant').language,
  ], ['Language', '语言', '語言']);
  assert.equal(getUiStrings('zh-Hans').languageSystem, '跟随系统');
  assert.equal(getUiStrings('zh-Hant').languageTraditionalChinese, '繁體中文');
});

test('localizes every notification option menu item', () => {
  const expected = {
    en: [
      'Notification options',
      'Awaiting confirmation',
      'Waiting for reply',
      'Notify in auto-confirmation mode',
    ],
    'zh-Hans': [
      '通知选项',
      '等待确认',
      '等待回复',
      '自动确认模式仍通知',
    ],
    'zh-Hant': [
      '通知選項',
      '等待確認',
      '等待回覆',
      '自動確認模式仍通知',
    ],
  };
  for (const [locale, labels] of Object.entries(expected)) {
    const menu = getMessages(locale).menu;
    assert.deepEqual([
      menu.notificationOptions,
      menu.notifyWaitingConfirmation,
      menu.notifyWaitingReply,
      menu.notifyAutoConfirmWaiting,
    ], labels);
  }
});
