const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { createHarness, student, root } = require('./helpers/firestore.cjs');

const baseTime = Date.parse('2026-10-19T10:35:00Z');
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
async function flush() { for (let i = 0; i < 50; i++) await Promise.resolve(); }
const timestamp = millis => ({ toDate: () => new Date(millis) });
const stale = () => ({ serverTime: timestamp(baseTime - 3 * 86400000) });
const response = (date = new Date(baseTime).toUTCString(), age = null, ok = true) => ({
  ok, headers: { get: field => field === 'Date' ? date : field === 'Age' ? age : null },
});

function setup() {
  const h = createHarness({ 'students/s': student() });
  let now = baseTime, timerId = 0;
  const timers = new Map();
  h.context.AbortController = AbortController;
  h.context.Date = class extends Date { static now() { return now; } };
  h.context.setTimeout = (callback, ms) => { const id = ++timerId; timers.set(id, { callback, at: now + ms }); return id; };
  h.context.clearTimeout = id => timers.delete(id);
  h.advance = async ms => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    await flush();
  };
  h.requests = [];
  h.reply = () => response();
  h.context.fetch = async (url, options) => { h.requests.push({ url, options }); return h.reply(); };
  h.load('shared/dateUtils.js', 'checkin/modules/clock.js');
  h.verify = config => h.context.verifyCheckinClock(config);
  return h;
}

test('a fresh existing timestamp keeps the zero-request and zero-write fast path', async () => {
  const h = setup();
  for (const minutes of [-60, 0, 59, 60]) assert.equal(await h.verify({ serverTime: timestamp(baseTime - minutes * 60000) }), true);
  assert.equal(h.requests.length, 0);
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.writes, 0);
});

test('an old timestamp uses one read-only Hosting HEAD instead of updating Firestore', async () => {
  const h = setup();
  h.context.updateDoc = () => { throw new Error('Clock must not write'); };
  h.context.getDoc = () => { throw new Error('Clock must not read Firestore'); };
  assert.equal(await h.verify(stale()), true);
  assert.equal(h.requests.length, 1);
  const { url, options } = h.requests[0];
  assert.match(url, /^https:\/\/scan-qrcode-kumon\.web\.app\/manifest\/manifest-checkin\.json\?clock=/);
  assert.equal(options.method, 'HEAD');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.signal.aborted, false);
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.writes, 0);
});

test('missing, corrupt and future-stale timestamps require a valid remote reference', async () => {
  const h = setup();
  for (const config of [undefined, {}, { serverTime: {} }, { serverTime: { toDate() { throw new Error('bad timestamp'); } } }, { serverTime: timestamp(NaN) }, { serverTime: timestamp(baseTime + 86400000) }]) {
    assert.equal(await h.verify(config), true);
  }
  assert.equal(h.requests.length, 6);
  assert.equal(h.stats.writes, 0);
});

test('a wrong device date is rejected without changing the date or saving anything', async () => {
  const h = setup();
  h.reply = () => response(new Date(baseTime + 2 * 86400000).toUTCString());
  assert.equal(await h.verify(stale()), false);
  assert.equal(h.stats.writes, 0);
});

test('a missing or malformed Date header cannot silently pass clock validation', async () => {
  const h = setup();
  for (const date of [null, '', 'not a date']) {
    h.reply = () => response(date);
    await assert.rejects(h.verify(stale()), error => error.code === 'unavailable' && error.stage === 'clock');
  }
  assert.equal(h.stats.writes, 0);
});

test('valid cache Age is accounted for, while invalid or stale cache ages are rejected', async () => {
  const h = setup();
  h.reply = () => response(new Date(baseTime - 61 * 60000).toUTCString(), '60');
  assert.equal(await h.verify(stale()), true);
  h.reply = () => response(new Date(baseTime - 61 * 60000).toUTCString());
  assert.equal(await h.verify(stale()), false);
  for (const age of ['-1', '61', 'NaN', '1.5']) {
    h.reply = () => response(undefined, age);
    await assert.rejects(h.verify(stale()), error => error.code === 'unavailable');
  }
});

test('HTTP errors and offline failures stop immediately without a retry or Firestore fallback', async () => {
  const h = setup();
  h.reply = () => response(undefined, null, false);
  await assert.rejects(h.verify(stale()), /CLOCK_REFERENCE_UNAVAILABLE/);
  h.reply = () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(h.verify(stale()), error => error.code === 'unavailable');
  assert.equal(h.requests.length, 2);
  assert.equal(h.stats.writes, 0);
});

test('a stalled probe aborts at 2.5 seconds even when fetch ignores cancellation', async () => {
  const h = setup();
  const pending = deferred();
  h.reply = () => pending.promise;
  const check = h.verify(stale());
  let finished = false;
  const rejected = assert.rejects(check, /CLOCK_REFERENCE_UNAVAILABLE/).then(() => { finished = true; });
  await h.advance(2499);
  assert.equal(finished, false);
  await h.advance(1);
  await rejected;
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.requests.length, 1);
  pending.resolve(response());
  await flush();
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.writes, 0);
});

function loadStartup(h) {
  h.configReads = 0;
  h.builds = 0;
  h.leases = 0;
  h.releases = 0;
  h.context.configRefresher = { refresh: async () => { h.configReads++; return stale(); } };
  h.context.connection = { beginWrite: async () => { h.leases++; return () => { h.releases++; }; } };
  h.context.ensureDailyScheduleBuilt = async () => { h.builds++; return { status: 'ready' }; };
  const source = fs.readFileSync(path.join(root, 'checkin/js/checkin.js'), 'utf8');
  vm.runInContext('let checkinStartupReady = false; let checkinStartupTask = null;', h.context);
  vm.runInContext(source.slice(source.indexOf('async function verifyClientClock('), source.indexOf('window.press = function')), h.context);
  vm.runInContext(source.slice(source.indexOf('async function ensureCheckinStartup()'), source.indexOf('// หน้าโหลด checkversion')), h.context);
}

test('opening and a simultaneous scan share one clock probe and one startup task', async () => {
  const h = setup();
  const pending = deferred();
  h.reply = () => pending.promise;
  loadStartup(h);
  const first = h.context.ensureCheckinStartup();
  const second = h.context.ensureCheckinStartup();
  await flush();
  assert.equal(h.configReads, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.leases, 0, 'Clock reads must not lock Firestore reconnects');
  pending.resolve(response());
  await Promise.all([first, second]);
  assert.equal(h.builds, 1);
  assert.equal(h.leases, 1);
  assert.equal(h.releases, 1);
  for (let i = 0; i < 10; i++) await h.context.ensureCheckinStartup();
  assert.equal(h.configReads, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.stats.writes, 0);
});

test('a clock timeout cannot build or check in, and a later retry can recover', async () => {
  const h = setup();
  const pending = deferred();
  h.reply = () => pending.promise;
  loadStartup(h);
  const failed = assert.rejects(h.context.ensureCheckinStartup(), /CLOCK_REFERENCE_UNAVAILABLE/);
  await flush();
  await h.advance(2500);
  await failed;
  pending.resolve(response());
  await flush();
  assert.equal(h.builds, 0);
  assert.equal(h.leases, 0);
  assert.equal(h.stats.writes, 0);
  h.reply = () => response();
  await h.context.ensureCheckinStartup();
  assert.equal(h.builds, 1);
  assert.equal(h.requests.length, 2);
  assert.equal(h.stats.writes, 0);
});

test('an invalid remote clock comparison cannot be bypassed by another startup attempt', async () => {
  const h = setup();
  h.reply = () => response(new Date(baseTime + 2 * 86400000).toUTCString());
  loadStartup(h);
  for (let i = 0; i < 2; i++) await assert.rejects(h.context.ensureCheckinStartup(), error => error.code === 'config/clock-invalid');
  assert.equal(h.builds, 0);
  assert.equal(h.leases, 0);
  assert.equal(h.stats.writes, 0);
});

test('after a stale-clock startup a repeated check-in still creates only one attendance', async () => {
  const h = setup();
  loadStartup(h);
  await h.context.ensureCheckinStartup();
  h.load('shared/studentService.js', 'shared/scheduleService.js', 'shared/attendanceService.js');
  const request = { db: {}, today: '20261019', studentId: 's', studentData: student(), nowtime: new Date(baseTime), readOnlyExisting: true };
  assert.equal((await h.context.processAttendance(request)).status, 'created');
  const writes = h.stats.writes;
  assert.equal((await h.context.processAttendance(request)).status, 'active');
  assert.equal(h.stats.writes, writes);
  assert.equal(h.read('students/s').weeklyPlans[1].totalSessions, 2);
  assert.equal(h.requests.length, 1);
});

test('Hosting exposes only the read-only manifest clock headers needed by local previews', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  const rule = config.hosting.headers.find(rule => rule.source === '/manifest/manifest-checkin.json');
  assert.ok(rule);
  const headers = Object.fromEntries(rule.headers.map(header => [header.key, header.value]));
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
  assert.equal(headers['Access-Control-Expose-Headers'], 'Date, Age');
});
