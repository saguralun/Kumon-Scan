const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHarness, student } = require('./helpers/firestore.cjs');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const unavailable = () => Object.assign(new Error('connection failed'), { code: 'unavailable' });
async function flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }

function setup(initial = {}) {
  const h = createHarness(initial);
  let now = 0, nextId = 0;
  const timers = new Map();
  h.online = true;
  h.events = [];
  h.context.Date = class extends Date { static now() { return now; } };
  h.context.setTimeout = (callback, ms) => {
    const id = ++nextId;
    timers.set(id, { callback, at: now + ms });
    return id;
  };
  h.context.clearTimeout = id => timers.delete(id);
  h.advance = async ms => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
    await flush();
  };
  h.context.disableNetwork = async () => {
    h.events.push({ type: 'disable', at: now });
    await h.onDisable?.();
  };
  h.context.enableNetwork = async () => {
    h.events.push({ type: 'enable', at: now });
    await h.onEnable?.();
  };
  h.load('shared/readDeadline.js', 'checkin/modules/connection.js');
  h.connection = h.context.createCheckinConnection({ db: {}, isOnline: () => h.online });
  return h;
}

test('healthy reads do not reset the connection or create extra Firestore operations', async () => {
  const h = setup();
  let reads = 0;
  for (let i = 0; i < 20; i++) assert.equal(await h.connection.runRead(() => ++reads), i + 1);
  await h.advance(30000);
  assert.equal(reads, 20);
  assert.deepEqual(h.events, []);
  assert.equal(h.stats.writes, 0);
});

test('a stalled read starts one reconnect at four seconds and retries only that read', async () => {
  const h = setup();
  const first = deferred();
  let reads = 0;
  const read = h.connection.runRead(() => ++reads === 1 ? first.promise : 'fresh');
  await h.advance(3999);
  assert.deepEqual(h.events, []);
  await h.advance(1);
  assert.equal(await read, 'fresh');
  assert.equal(reads, 2);
  assert.deepEqual(h.events, [{ type: 'disable', at: 4000 }, { type: 'enable', at: 4000 }]);
  first.resolve('old');
  await flush();
});

test('a known transient error reconnects immediately without waiting for the stall timer', async () => {
  const h = setup();
  let reads = 0;
  assert.equal(await h.connection.runRead(() => {
    if (++reads === 1) throw unavailable();
    return 'fresh';
  }), 'fresh');
  assert.equal(reads, 2);
  assert.deepEqual(h.events, [{ type: 'disable', at: 0 }, { type: 'enable', at: 0 }]);
});

test('student and attendance error results trigger the same bounded recovery', async () => {
  const h = setup();
  let reads = 0;
  const result = await h.connection.runRead(() => ++reads === 1
    ? { status: 'error', error: unavailable() } : { status: 'active' });
  assert.equal(result.status, 'active');
  assert.equal(reads, 2);
  assert.equal(h.events.length, 2);
});

test('quota and permission errors never cause a reconnect loop', async () => {
  const h = setup();
  for (const code of ['resource-exhausted', 'permission-denied', 'unauthenticated', 'aborted']) {
    await assert.rejects(h.connection.runRead(() => { throw Object.assign(new Error(code), { code }); }), error => error.code === code);
  }
  assert.deepEqual(h.events, []);
});

test('an offline device is not forced into repeated connection attempts', async () => {
  const h = setup();
  h.online = false;
  await assert.rejects(h.connection.runRead(() => { throw unavailable(); }), /connection failed/);
  assert.deepEqual(h.events, []);
});

test('a failed retry is returned rather than recursively reconnecting', async () => {
  const h = setup();
  let reads = 0;
  await assert.rejects(h.connection.runRead(() => { reads++; throw unavailable(); }), /connection failed/);
  assert.equal(reads, 2);
  assert.equal(h.events.length, 2);
});

test('the cooldown prevents repeated resets for fifteen seconds', async () => {
  const h = setup();
  const read = () => { throw unavailable(); };
  await assert.rejects(h.connection.runRead(read));
  await h.advance(14999);
  await assert.rejects(h.connection.runRead(read));
  assert.equal(h.events.length, 2);
  await h.advance(1);
  await assert.rejects(h.connection.runRead(read));
  assert.equal(h.events.length, 4);
});

test('concurrent stalled reads share a single reconnect', async () => {
  const h = setup();
  const oldA = deferred(), oldB = deferred();
  let a = 0, b = 0;
  const first = h.connection.runRead(() => ++a === 1 ? oldA.promise : 'A');
  const second = h.connection.runRead(() => ++b === 1 ? oldB.promise : 'B');
  await h.advance(4000);
  assert.deepEqual(await Promise.all([first, second]), ['A', 'B']);
  assert.equal(h.events.length, 2);
  assert.equal(a, 2);
  assert.equal(b, 2);
});

test('an active write prevents a background read from resetting Firestore', async () => {
  const h = setup();
  const release = await h.connection.beginWrite();
  const old = deferred();
  const read = h.connection.runRead(() => old.promise);
  await h.advance(4000);
  assert.deepEqual(h.events, []);
  old.resolve('finished');
  assert.equal(await read, 'finished');
  release();
  release();
  let attempts = 0;
  assert.equal(await h.connection.runRead(() => ++attempts === 1
    ? Promise.reject(unavailable()) : 'fresh'), 'fresh');
  assert.equal(h.events.length, 2);
});

test('a new write waits until an in-progress reconnect finishes', async () => {
  const h = setup();
  const disabled = deferred();
  h.onDisable = () => disabled.promise;
  let reads = 0;
  const read = h.connection.runRead(() => ++reads === 1 ? Promise.reject(unavailable()) : 'fresh');
  await flush();
  let started = false;
  const write = h.connection.beginWrite().then(release => { started = true; return release; });
  await flush();
  assert.equal(started, false);
  disabled.resolve();
  assert.equal(await read, 'fresh');
  const release = await write;
  assert.equal(started, true);
  release();
});

test('a cache-only result caused by disabling the SDK is discarded', async () => {
  const h = setup();
  const old = deferred();
  h.onDisable = () => old.resolve({ status: 'not_found', fromCache: true });
  let reads = 0;
  const read = h.connection.runRead(() => ++reads === 1 ? old.promise : { status: 'active', fromCache: false });
  await h.advance(4000);
  const result = await read;
  assert.equal(result.status, 'active');
  assert.equal(result.fromCache, false);
});

test('network enable is still attempted if disabling the SDK fails', async () => {
  const h = setup();
  h.onDisable = () => { throw new Error('disable failed'); };
  await assert.rejects(h.connection.runRead(() => { throw unavailable(); }), /disable failed/);
  assert.deepEqual(h.events.map(e => e.type), ['disable', 'enable']);
});

test('an expired scan does not launch an extra reconnect or read', async () => {
  const h = setup();
  const deadline = h.context.createReadDeadline(2000);
  const old = deferred();
  let reads = 0;
  const read = deadline.run(() => h.connection.runRead(() => {
    reads++;
    return old.promise;
  }, { canRetry: () => deadline.isActive() }), 'student');
  const timedOut = assert.rejects(read, /CHECKIN_READ_TIMEOUT/);
  await flush();
  await h.advance(4000);
  await timedOut;
  assert.deepEqual(h.events, []);
  assert.equal(reads, 1);
  old.resolve('late');
});

test('check-in recovers its status read before saving exactly one attendance', async () => {
  const today = '20261019';
  const h = setup({ 'students/s': student() }).load(
    'shared/dateUtils.js', 'shared/studentService.js', 'shared/scheduleService.js', 'shared/attendanceService.js',
  );
  const getDoc = h.context.getDoc;
  const old = deferred();
  let statusReads = 0;
  h.context.getDoc = ref => ref === `attendance/s_${today}` && ++statusReads === 1 ? old.promise : getDoc(ref);
  h.onDisable = () => old.resolve({ exists: () => false });
  let release;
  const scan = h.context.processAttendance({
    db: {}, today, studentId: 's', studentData: student(),
    nowtime: new Date(2026, 9, 19, 17, 35), readConnection: h.connection,
    readDeadline: h.context.createReadDeadline(),
    onWriteStart: async () => { release = await h.connection.beginWrite(); },
  });
  await flush();
  await h.advance(4000);
  assert.equal((await scan).status, 'created');
  release();
  assert.equal(h.events.length, 2);
  assert.equal(h.read(`attendance/s_${today}`).status, 'active');
  assert.equal(h.read('students/s').weeklyPlans[1].totalSessions, 2);
});

test('overlapping write leases all need to finish before a reset is allowed', async () => {
  const h = setup();
  const first = await h.connection.beginWrite();
  const second = await h.connection.beginWrite();
  first();
  await assert.rejects(h.connection.runRead(() => { throw unavailable(); }));
  assert.deepEqual(h.events, []);
  second();
  await assert.rejects(h.connection.runRead(() => { throw unavailable(); }));
  assert.equal(h.events.length, 2);
});

test('config refresh shares the recovery and replaces a stale closed-day cache', async () => {
  const weekly = { 1: { enabled: true, open: '00:00', close: '23:59' } };
  const h = setup({ 'system/config': { appVersion: '6.0.6', weekly, rarities: [], rewardItems: {} } });
  Object.assign(h.context, {
    setRarities() {}, setRewardItems() {}, validateRewardConfig() {},
  });
  h.load('shared/dateUtils.js', 'checkin/modules/storage.js', 'checkin/modules/settings.js',
    'shared/versionControl.js', 'checkin/modules/configRefresh.js');
  h.context.saveTodaySettingCache({ cacheDate: '20261019', enabled: false });
  const getServer = h.context.getDocFromServer, old = deferred();
  let requests = 0;
  h.context.getDocFromServer = ref => ++requests === 1 ? old.promise : getServer(ref);
  h.onDisable = () => old.reject(unavailable());
  const refresher = h.context.createCheckinConfigRefresher({
    db: {}, readConfig: read => h.connection.runRead(read),
  });
  const first = refresher.refresh(), second = refresher.refresh();
  assert.equal(first, second);
  await h.advance(4000);
  await first;
  assert.equal(requests, 2);
  assert.equal(h.events.length, 2);
  assert.equal(h.context.loadTodaySettingCache().enabled, true);
  assert.equal(h.stats.writes, 0);
});

test('a stalled background read does not restart an in-flight attendance transaction', async () => {
  const today = '20261019';
  const h = setup({ 'students/s': student() }).load(
    'shared/dateUtils.js', 'shared/studentService.js', 'shared/scheduleService.js', 'shared/attendanceService.js',
  );
  const commit = deferred(), background = deferred();
  h.beforeCommit = () => commit.promise;
  let release;
  const scan = h.context.processAttendance({
    db: {}, today, studentId: 's', studentData: student(),
    nowtime: new Date(2026, 9, 19, 17, 35), readConnection: h.connection,
    readDeadline: h.context.createReadDeadline(),
    onWriteStart: async () => { release = await h.connection.beginWrite(); },
  });
  await flush();
  assert.equal(typeof release, 'function');
  const otherRead = h.connection.runRead(() => background.promise);
  await h.advance(4000);
  assert.deepEqual(h.events, []);
  commit.resolve();
  assert.equal((await scan).status, 'created');
  release();
  background.resolve('fresh');
  assert.equal(await otherRead, 'fresh');
  assert.equal(h.read(`attendance/s_${today}`).status, 'active');
  assert.equal(h.read('students/s').weeklyPlans[1].totalSessions, 2);
  assert.deepEqual(h.events, []);
});
