'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectLocale,
  getMessages,
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
