const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { createHarness, root } = require('./helpers/firestore.cjs');

const openDay = { enabled: true, open: '00:00', close: '23:59' };
const config = (setting = openDay) => ({
  appVersion: '6.0.8', weekly: { 1: setting }, rarities: [], rewardItems: {},
});

function setup(data = config()) {
  const h = createHarness(data ? { 'system/config': data } : {});
  h.messages = [];
  Object.assign(h.context, {
    setRarities() {}, setRewardItems() {}, validateRewardConfig() {},
    statusUI: { showError: text => h.messages.push(text) },
  });
  h.load('shared/dateUtils.js', 'shared/readDeadline.js', 'checkin/modules/storage.js', 'checkin/modules/settings.js',
    'shared/versionControl.js', 'checkin/modules/configRefresh.js');
  h.refresher = h.context.createCheckinConfigRefresher({ db: {} });
  return h;
}

test('fresh server config replaces a same-day closed cache without writing to Firestore', async () => {
  const h = setup();
  h.context.saveTodaySettingCache({ enabled: false, cacheDate: '20261019' });
  h.context.getDoc = () => { throw new Error('must not use the cache-capable config read'); };
  await h.refresher.refresh();
  assert.equal(h.context.loadTodaySettingCache().enabled, true);
  assert.equal(await h.context.checkTodayAndTime(await h.refresher.getTodaySetting()), true);
  assert.equal(h.stats.reads, 1);
  assert.equal(h.stats.writes, 0);
});

test('wake-up refresh updates opening hours and reward config, not just the cached weekday', async () => {
  const h = setup();
  await h.refresher.refresh();
  h.put('system/config', { ...config({ ...openDay, open: '10:15' }), rewardItems: {
    star: { name: 'Star', icon: '*', rarity: 'common', type: 'shape' },
  } });
  await h.refresher.refresh();
  assert.equal((await h.refresher.getTodaySetting()).open, '10:15');
  assert.equal(h.context.loadSystemConfig().rewardItems[0].id, 'star');
  assert.equal(h.stats.reads, 2);
  assert.equal(h.stats.writes, 0);
});

test('a simultaneous wake-up and scan await one shared server read', async () => {
  const h = setup();
  const getServer = h.context.getDocFromServer;
  let release;
  h.context.getDocFromServer = async ref => {
    await new Promise(resolve => { release = resolve; });
    return getServer(ref);
  };
  const first = h.refresher.refresh();
  const second = h.refresher.refresh();
  const scan = h.refresher.getTodaySetting();
  assert.equal(first, second);
  assert.equal(h.context.loadTodaySettingCache(), null);
  release();
  await Promise.all([first, second]);
  assert.equal((await scan).enabled, true);
  assert.equal(h.stats.reads, 1);
});

test('normal consecutive scans reuse the refreshed setting without more server reads', async () => {
  const h = setup();
  await h.refresher.refresh();
  for (let i = 0; i < 20; i++) assert.equal((await h.refresher.getTodaySetting()).enabled, true);
  assert.equal(h.stats.reads, 1);
  assert.equal(h.stats.writes, 0);
});

test('a missing session cache is recovered automatically on the next scan', async () => {
  const h = setup();
  await h.refresher.refresh();
  h.context.clearTodaySettingCache();
  assert.equal((await h.refresher.getTodaySetting()).enabled, true);
  assert.equal(h.context.loadTodaySettingCache().enabled, true);
  assert.equal(h.stats.reads, 2);
});

test('network failure never falls back to a stale closed flag and a later scan retries', async () => {
  const h = setup(config({ enabled: false }));
  await h.refresher.refresh();
  const getServer = h.context.getDocFromServer;
  h.context.getDocFromServer = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
  await assert.rejects(h.refresher.refresh(), /offline/);
  assert.equal(h.context.loadTodaySettingCache(), null);
  await assert.rejects(h.refresher.getTodaySetting(), /offline/);
  assert.equal(h.messages.length, 0);
  assert.equal(h.logs.length, 0);
  h.context.getDocFromServer = getServer;
  h.put('system/config', config());
  assert.equal((await h.refresher.getTodaySetting()).enabled, true);
  assert.equal(h.stats.writes, 0);
});

test('incomplete config is not presented as a closed day or kept as a fake cache', async () => {
  for (const data of [null, config(null), config({}), config({ enabled: 'true' }), config({ enabled: true, open: 'bad', close: '20:00' })]) {
    const h = setup(data);
    await assert.rejects(h.refresher.refresh(), /SYSTEM_CONFIG_NOT_FOUND|TODAY_SETTING_INVALID/);
    assert.equal(h.context.loadTodaySettingCache(), null);
    assert.equal(h.messages.length, 0);
    assert.equal(h.stats.writes, 0);
  }
});

test('time validation reports actual closure only for an explicit false flag', async () => {
  const h = setup();
  assert.equal(await h.context.checkTodayAndTime({ enabled: false }), false);
  assert.match(h.messages.pop(), /วันนี้ไม่เปิด/);
  for (const setting of [null, {}, { enabled: 'false' }, { enabled: true, open: 'no', close: '20:00' }]) {
    assert.equal(await h.context.checkTodayAndTime(setting), false);
    assert.match(h.messages.pop(), /โหลดข้อมูลวันเรียน/);
  }
  assert.equal(h.context.isValidTodaySetting({ enabled: true, open: '9:00', close: '20:00' }), true);
});

test('the original opening-hours restriction remains in effect', async () => {
  const h = setup();
  h.context.isWithinTime = () => false;
  assert.equal(await h.context.checkTodayAndTime(openDay), false);
  assert.match(h.messages.pop(), /ช่วงเวลาเปิดทำการ/);
});

test('other pages keep the original config reader and offline fallback behaviour', async () => {
  const h = setup();
  h.context.getDocFromServer = () => { throw new Error('other pages must not require a server-only read'); };
  assert.equal((await h.context.checkVersionAndReload({})).ok, true);
  h.context.getDoc = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
  const fallback = await h.context.checkVersionAndReload({});
  assert.equal(fallback.ok, true);
  assert.equal(fallback.weekly, null);
  assert.equal(h.logs.length, 0);
});

test('reconnecting refreshes config after enabling the network without rebuilding the schedule', async () => {
  const h = setup();
  await h.refresher.refresh();
  h.put('system/config', config({ enabled: false }));
  const events = {};
  h.context.window.addEventListener = (name, callback) => { events[name] = callback; };
  h.context.document = { visibilityState: 'visible' };
  h.context.configRefresher = h.refresher;
  let enabled = false;
  h.context.enableNetwork = async () => { enabled = true; };
  h.context.ensureDailyScheduleBuilt = () => { throw new Error('must not rebuild on reconnect'); };
  vm.runInContext('let checkinStartupStarted = true;', h.context);
  const source = fs.readFileSync(path.join(root, 'checkin/js/checkin.js'), 'utf8');
  const start = source.indexOf('window.addEventListener("online", async () => {');
  const end = source.indexOf('window.addEventListener("offline", () => {', start);
  vm.runInContext(source.slice(start, end), h.context);
  await events.online();
  assert.equal(enabled, true);
  assert.equal((await h.refresher.getTodaySetting()).enabled, false);
  assert.equal(h.stats.reads, 2);
  assert.equal(h.stats.writes, 0);
});

test('a new calendar day refreshes the weekday instead of retaining yesterday', async () => {
  const h = setup({ ...config(), weekly: { 1: openDay, 2: { enabled: false } } });
  await h.refresher.refresh();
  h.context.window.TEST_DATE = new Date(2026, 9, 20, 10, 0).toISOString();
  const setting = await h.refresher.getTodaySetting();
  assert.equal(setting.cacheDate, '20261020');
  assert.equal(setting.enabled, false);
  assert.equal(h.stats.reads, 2);
});

test('version mismatch blocks scans without caching a weekday from the new version', async () => {
  const h = setup({ ...config(), appVersion: 'next-version' });
  await assert.rejects(h.refresher.refresh(), error => error.code === 'config/version-mismatch');
  assert.equal(h.context.loadTodaySettingCache(), null);
});

test('focus and visibility events from one activation share one refresh, including bfcache restore', async () => {
  const h = setup();
  await h.refresher.refresh();
  const events = {}, documentEvents = {};
  h.context.window.addEventListener = (name, callback) => { events[name] = callback; };
  h.context.document = {
    visibilityState: 'visible',
    addEventListener: (name, callback) => { documentEvents[name] = callback; },
  };
  h.context.configRefresher = h.refresher;
  h.context.reloadIfDateChanged = () => false;
  vm.runInContext('let checkinStartupStarted = true; let checkinPageActive = true;', h.context);
  const source = fs.readFileSync(path.join(root, 'checkin/js/checkin.js'), 'utf8');
  const start = source.indexOf('function refreshConfigOnActivation()');
  const end = source.indexOf('rewardConfirmBtn.addEventListener(', start);
  vm.runInContext(source.slice(start, end), h.context);
  events.focus();
  assert.equal(h.stats.reads, 1);
  events.blur();
  events.focus();
  documentEvents.visibilitychange();
  await h.refresher.getTodaySetting();
  assert.equal(h.stats.reads, 2);
  h.context.document.visibilityState = 'hidden';
  documentEvents.visibilitychange();
  h.context.document.visibilityState = 'visible';
  documentEvents.visibilitychange();
  events.focus();
  await h.refresher.getTodaySetting();
  assert.equal(h.stats.reads, 3);
  events.pageshow({ persisted: true });
  await h.refresher.getTodaySetting();
  assert.equal(h.stats.reads, 4);
  assert.equal(h.stats.writes, 0);
});
