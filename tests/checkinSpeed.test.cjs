const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness, student, root } = require('./helpers/firestore.cjs');
const { installCheckinQueue } = require('./helpers/checkinQueue.cjs');

const today = '20261019';
const attendance = `attendance/s_${today}`;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

function setup(initial = { 'students/s': student() }) {
  const h = createHarness(initial);
  let now = 0, nextId = 0;
  const timers = new Map();
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
  h.load('shared/dateUtils.js', 'shared/readDeadline.js', 'shared/studentService.js',
    'shared/scheduleService.js', 'shared/attendanceService.js');
  h.checkin = options => h.context.processAttendance({
    db: {}, today, studentId: 's', studentData: h.read('students/s'),
    nowtime: new Date(2026, 9, 19, 17, 35), ...options,
  });
  return h;
}

test('all pre-save reads share one ten-second budget rather than ten seconds per step', async () => {
  const h = setup();
  const deadline = h.context.createReadDeadline();
  const first = deferred();
  const firstRead = deadline.run(() => first.promise, 'config');
  await h.advance(4000);
  first.resolve('config');
  assert.equal(await firstRead, 'config');
  const second = deferred();
  const secondRead = deadline.run(() => second.promise, 'student');
  const timedOut = assert.rejects(secondRead, error => error.isCheckinReadTimeout && error.stage === 'student');
  await h.advance(6000);
  await timedOut;
  let started = false;
  assert.throws(() => deadline.run(() => { started = true; }, 'next-read'), /CHECKIN_READ_TIMEOUT/);
  assert.equal(started, false);
  second.resolve('late student');
  await flush();
});

test('a late attendance read cannot continue into a save after the deadline', async () => {
  const h = setup();
  const pending = deferred();
  const getDoc = h.context.getDoc;
  h.context.getDoc = ref => ref === attendance ? pending.promise : getDoc(ref);
  let writeStarts = 0;
  const scan = h.checkin({ readDeadline: h.context.createReadDeadline(), onWriteStart: () => writeStarts++ });
  const rejected = assert.rejects(scan, /CHECKIN_READ_TIMEOUT: attendance-status/);
  await h.advance(10000);
  await rejected;
  pending.resolve({ exists: () => false });
  await flush();
  assert.equal(writeStarts, 0);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.stats.queries, 0);
  assert.equal(h.read(attendance), undefined);
});

test('a late previous-subject query cannot checkout or create attendance after timeout', async () => {
  const h = setup();
  const pending = deferred();
  h.context.getDocs = () => pending.promise;
  let writeStarts = 0;
  const scan = h.checkin({ readDeadline: h.context.createReadDeadline(), onWriteStart: () => writeStarts++ });
  const rejected = assert.rejects(scan, /CHECKIN_READ_TIMEOUT: previous-attendance/);
  await flush();
  await h.advance(10000);
  await rejected;
  pending.resolve({ empty: true, docs: [], size: 0 });
  await flush();
  assert.equal(writeStarts, 0);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.read(attendance), undefined);
});

test('expiry at the read boundary cannot start the first transaction', async () => {
  const h = setup();
  const readDeadline = h.context.createReadDeadline();
  await h.advance(10000);
  await assert.rejects(h.checkin({ readDeadline }), /CHECKIN_READ_TIMEOUT/);
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.writes, 0);
});

test('a transaction that already started is not abandoned by the read timeout', async () => {
  const h = setup();
  const commit = deferred();
  h.beforeCommit = writes => writes.some(w => w.ref === attendance) ? commit.promise : undefined;
  let writeStarts = 0, finished = false;
  const scan = h.checkin({ readDeadline: h.context.createReadDeadline(), onWriteStart: () => writeStarts++ });
  scan.then(() => { finished = true; });
  await flush();
  assert.equal(writeStarts, 1);
  await h.advance(30000);
  assert.equal(finished, false);
  assert.equal(h.read(attendance), undefined);
  commit.resolve();
  assert.equal((await scan).status, 'created');
  assert.equal(h.read(attendance).status, 'active');
  assert.equal(h.read('students/s').weeklyPlans[1].totalSessions, 2);
});

test('loading errors return without waiting for an unavailable logging connection', async () => {
  const h = setup();
  h.context.getDoc = async () => { throw new Error('read failed'); };
  h.context.logError = () => new Promise(() => {});
  assert.equal((await h.context.getActiveStudent({}, 's')).status, 'error');
  assert.equal((await h.checkin()).status, 'error');
  assert.equal(h.stats.writes, 0);
});

test('transaction failures propagate without awaiting the logging write', async () => {
  const h = setup();
  h.beforeCommit = () => { throw new Error('save failed'); };
  h.context.logError = () => new Promise(() => {});
  await assert.rejects(h.checkin(), /save failed/);
  assert.equal(h.stats.writes, 0);
});

function loadStartup(h) {
  const source = fs.readFileSync(path.join(root, 'checkin/js/checkin.js'), 'utf8');
  const start = source.indexOf('async function ensureCheckinStartup()');
  const end = source.indexOf('// หน้าโหลด checkversion', start);
  vm.runInContext('let checkinStartupReady = false; let checkinStartupTask = null;', h.context);
  vm.runInContext(source.slice(start, end), h.context);
}

test('slow initialization continues once after UI timeout and cannot skip clock or schedule checks', async () => {
  const h = setup();
  const config = deferred(), clock = deferred();
  let configReads = 0, clockChecks = 0, builds = 0;
  h.context.configRefresher = { refresh: () => { configReads++; return config.promise; } };
  h.context.verifyClientClock = () => { clockChecks++; return clock.promise; };
  h.context.ensureDailyScheduleBuilt = async () => { builds++; return { status: 'ready' }; };
  loadStartup(h);
  const first = h.context.createReadDeadline().run(() => h.context.ensureCheckinStartup(), 'startup');
  const timedOut = assert.rejects(first, /CHECKIN_READ_TIMEOUT/);
  await h.advance(10000);
  await timedOut;
  const second = h.context.ensureCheckinStartup();
  assert.equal(configReads, 1);
  assert.equal(clockChecks, 0);
  config.resolve({ ok: true });
  await flush();
  assert.equal(clockChecks, 1);
  assert.equal(builds, 0);
  clock.resolve(true);
  await second;
  assert.equal(builds, 1);
  await h.context.ensureCheckinStartup();
  assert.equal(configReads, 1);
  assert.equal(builds, 1);
});

test('an invalid device clock cannot be bypassed by retrying after initialization', async () => {
  const h = setup();
  h.context.configRefresher = { refresh: async () => ({ ok: true }) };
  h.context.verifyClientClock = async () => false;
  h.context.ensureDailyScheduleBuilt = () => { throw new Error('must not build before clock verification'); };
  loadStartup(h);
  for (let i = 0; i < 2; i++) {
    await assert.rejects(h.context.ensureCheckinStartup(), error => error.code === 'config/clock-invalid');
  }
  assert.equal(h.stats.writes, 0);
});

function loadSubmit(h) {
  h.messages = [];
  Object.assign(h.context, {
    DEV_MODE: false, currentInput: 's', isProcessing: false,
    reloadIfDateChanged: () => false, validateInput: () => ({ valid: true }),
    configRefresher: { getTodaySetting: async () => ({ enabled: true }) },
    ensureCheckinStartup: async () => {}, checkTodayAndTime: async () => true,
    reward: { prepareCheckinReward: null },
    setUIProcessing: value => { h.context.isProcessing = value; }, resetInput() {},
    statusUI: { showError: text => h.messages.push(text), showStatus: text => h.messages.push(text) },
  });
  h.load('shared/checkinFlow.js');
  installCheckinQueue(h);
  const source = fs.readFileSync(path.join(root, 'checkin/js/checkin.js'), 'utf8');
  const start = source.indexOf('window.submitID = async function ()');
  const end = source.indexOf('async function ensureCheckinStartup()', start);
  vm.runInContext(source.slice(start, end), h.context);
}

test('the submit button unlocks on a read timeout and late student data never starts attendance', async () => {
  const h = setup();
  const pending = deferred();
  h.context.getDoc = () => pending.promise;
  loadSubmit(h);
  const scan = h.context.window.submitID();
  await flush();
  assert.equal(h.context.isProcessing, true);
  await h.advance(10000);
  await scan;
  assert.equal(h.context.isProcessing, false);
  assert.match(h.messages.at(-1), /ยังไม่ได้เริ่มบันทึกเข้าเรียน/);
  pending.resolve({ exists: () => true, data: () => student() });
  await flush();
  assert.equal(h.stats.writes, 0);
  assert.equal(h.stats.queries, 0);
});

test('an SDK write timeout is never described as if no save had started', async () => {
  const h = setup();
  loadSubmit(h);
  let attempted = false;
  h.beforeCommit = () => { attempted = true; throw Object.assign(new Error('write deadline'), { code: 'deadline-exceeded' }); };
  const scan = h.context.window.submitID();
  await flush();
  await flush();
  await h.advance(7000);
  await scan;
  assert.equal(attempted, true);
  assert.equal(h.context.isProcessing, false);
  assert.equal(h.messages.at(-1).includes('ยังไม่ได้เริ่มบันทึกเข้าเรียน'), false);
  assert.equal(h.stats.writes, 0);
  h.context.checkinJobs.dispose();
});

test('a late connection write lease is released after the scan timed out without starting a save', async () => {
  const h = setup();
  loadSubmit(h);
  const lease = deferred();
  let releases = 0, requested = 0;
  h.context.connection.beginWrite = () => { requested++; return lease.promise; };
  const scan = h.context.window.submitID();
  await flush();
  await flush();
  for (let i = 0; i < 10 && !requested; i++) await flush();
  assert.equal(requested, 1);
  await h.advance(7000);
  await scan;
  assert.equal(h.context.isProcessing, false);
  assert.equal(h.stats.writes, 0);
  await h.advance(3000);
  lease.resolve(() => { releases++; });
  await flush();
  assert.equal(releases, 1);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.read(attendance), undefined);
  h.context.checkinJobs.dispose();
});
