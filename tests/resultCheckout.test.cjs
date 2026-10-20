const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');

const root = path.join(__dirname, '..');
const resultSource = fs.readFileSync(path.join(root, 'result.html'), 'utf8');
const serviceSource = fs.readFileSync(path.join(root, 'shared/attendanceService.js'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = end ? source.indexOf(end, from) : source.length;
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function createUI(checkoutAttendance, stored = new Map()) {
  const timers = [];
  const notices = [];
  const onlineListeners = new Set();
  const student = { id: 'student_today', studentId: 'student', date: 'today', slotKey: '16:00',
    nickname: 'Student', subject: 'ME', checkInTime: { toDate: () => new Date('2026-10-20T08:00:00Z') } };
  const context = vm.createContext({
    db: {}, window: {
      addEventListener: (type, callback) => onlineListeners.add(callback),
      removeEventListener: (type, callback) => onlineListeners.delete(callback),
    }, console, Date, Set, Map, crypto: { randomUUID },
    checkoutStore: { get: id => stored.get(id), put: job => stored.set(job.id, job),
      remove: id => stored.delete(id), list: () => [...stored.values()] },
    Timestamp: { fromDate: date => ({ toDate: () => new Date(date) }) },
    activeDataAll: [student], currentTab: 'active',
    checkoutAttendance,
    isRetryableCheckoutError: error => error.code === 'unavailable',
    debugLog() {}, renderAll() {},
    addRecentCheckout: entry => notices.push(entry),
    logError: () => new Promise(() => {}),
    loadCompleted: async () => {},
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
    clearTimeout() {},
  });
  vm.runInContext(
    section(resultSource, 'const checkoutState =', 'const activityState =') +
    section(resultSource, 'function addPendingCheckout(', 'function addRecentCheckin(') +
    section(resultSource, 'window.checkout = async function', 'function rebuildCheckinQueue()') +
    '\nglobalThis.state = checkoutState;',
    context
  );
  return { context, timers, notices, student, stored, onlineListeners, state: context.state };
}

test('reloading restores a pending checkout with its original timestamp and attendance snapshot', async () => {
  const first = createUI(() => new Promise(() => {}));
  void first.context.window.checkout(first.student.id);
  const saved = first.stored.get(first.student.id);
  assert.equal(saved.status, 'pending');
  const requests = [];
  const restored = createUI(async request => { requests.push(request); }, first.stored);
  restored.context.restorePendingCheckouts();
  assert.equal(restored.state.pending.has(first.student.id), true);
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].nowtime.toISOString(), saved.requestedAt);
  assert.equal(requests[0].attendanceData.checkInTime.toDate().toISOString(), saved.attendanceData.checkInTime);
  assert.equal(restored.stored.size, 0);
  assert.equal(restored.notices.length, 1);
});

test('failed restored checkouts stay hidden and only retry when requested', async () => {
  const first = createUI(async () => { throw new Error('invalid'); });
  await first.context.window.checkout(first.student.id);
  assert.equal(first.stored.get(first.student.id).status, 'failed');
  let calls = 0;
  const restored = createUI(async () => { calls++; }, first.stored);
  restored.context.restorePendingCheckouts();
  await flush();
  assert.equal(calls, 0);
  assert.equal(restored.state.pending.has(first.student.id), true);
  await restored.context.window.retryCheckout(first.student.id);
  assert.equal(calls, 1);
  assert.equal(restored.stored.size, 0);
});

test('checkout storage failure leaves the student visible and sends nothing', async () => {
  let calls = 0, message;
  const ui = createUI(async () => { calls++; });
  ui.context.checkoutStore.put = () => { throw new Error('storage full'); };
  ui.context.alert = text => { message = text; };
  await ui.context.window.checkout(ui.student.id);
  assert.equal(calls, 0);
  assert.equal(ui.state.pending.size, 0);
  assert.equal(ui.state.queue.size, 0);
  assert.ok(message);
});

test('slow checkout stays hidden, ignores double taps, and never reappears on a stale snapshot', async () => {
  let finish;
  let calls = 0;
  const ui = createUI(() => {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  });
  const task = ui.context.window.checkout(ui.student.id);
  assert.equal(ui.state.pending.has(ui.student.id), true);
  assert.equal(ui.state.queue.size, 1);
  await ui.context.window.checkout(ui.student.id);
  assert.equal(calls, 1);
  finish();
  await task;
  assert.equal(ui.context.activeDataAll.length, 0);
  assert.equal(ui.state.pending.has(ui.student.id), true);
  assert.equal(ui.state.queue.size, 0);
  assert.equal(ui.timers.length, 0);
  ui.context.reconcileConfirmedCheckouts({
    metadata: { fromCache: false, hasPendingWrites: false },
    docs: [{ id: ui.student.id }],
  });
  assert.equal(ui.state.pending.has(ui.student.id), true);
  ui.context.reconcileConfirmedCheckouts({
    metadata: { fromCache: true, hasPendingWrites: false }, docs: [],
  });
  assert.equal(ui.state.pending.has(ui.student.id), true);
  ui.context.reconcileConfirmedCheckouts({
    metadata: { fromCache: false, hasPendingWrites: false }, docs: [],
  });
  assert.equal(ui.state.pending.has(ui.student.id), false);
  assert.equal(ui.notices.length, 1);
});

test('temporary failures keep the row hidden and retry with the original click time', async () => {
  const requests = [];
  const ui = createUI(async request => {
    requests.push(request);
    if (requests.length <= 5) throw Object.assign(new Error('offline'), { code: 'unavailable' });
  });
  const task = ui.context.window.checkout(ui.student.id);
  await flush();
  for (const delay of [3000, 6000, 12000, 24000, 30000]) {
    assert.equal(ui.state.pending.has(ui.student.id), true);
    assert.equal(ui.state.loading.has(ui.student.id), true);
    assert.equal(ui.notices.length, 0);
    const timer = ui.timers.shift();
    assert.equal(timer.delay, delay);
    timer.callback();
    await flush();
  }
  await task;
  assert.equal(requests.length, 6);
  assert.ok(requests.every(request => request.nowtime === requests[0].nowtime));
  assert.equal(ui.state.queue.size, 0);
  assert.equal(ui.notices.length, 1);
});

test('data errors remain in the queue and can be retried without waiting for logging', async () => {
  let fail = true;
  const ui = createUI(async () => { if (fail) throw new Error('CHECKIN_DATA_INVALID'); });
  await ui.context.window.checkout(ui.student.id);
  assert.equal(ui.state.pending.has(ui.student.id), true);
  assert.equal(ui.state.queue.get(ui.student.id).failed, true);
  assert.equal(ui.state.loading.has(ui.student.id), false);
  assert.equal(ui.timers.length, 0);
  fail = false;
  await ui.context.window.retryCheckout(ui.student.id);
  assert.equal(ui.state.queue.size, 0);
  assert.equal(ui.notices.length, 1);
});

test('coming back online retries immediately instead of waiting for the backoff timer', async () => {
  let calls = 0;
  const ui = createUI(async () => {
    if (++calls === 1) throw Object.assign(new Error('offline'), { code: 'unavailable' });
  });
  const task = ui.context.window.checkout(ui.student.id);
  await flush();
  assert.equal(ui.onlineListeners.size, 1);
  for (const callback of ui.onlineListeners) callback();
  await task;
  assert.equal(calls, 2);
  assert.equal(ui.onlineListeners.size, 0);
  assert.equal(ui.notices.length, 1);
});

function createService(status = 'active', error = null) {
  const data = { status, studentId: 'test', subject: 'ME', slotKey: '16:00' };
  const writes = [];
  const moves = [];
  let reads = 0;
  const context = vm.createContext({
    console,
    Timestamp: { fromDate: date => ({ toDate: () => new Date(date) }) },
    doc: (...parts) => parts.slice(1).join('/'),
    serverTimestamp: () => 'server-time',
    logError: () => new Promise(() => {}),
    moveToCompletedScheduleInTransaction: async request => moves.push(request.attData),
    runTransaction: async (db, action) => {
      if (error) throw error;
      await action({
        get: async () => { reads++; return { exists: () => true, data: () => ({ ...data }) }; },
        update: (ref, payload) => { writes.push(payload); Object.assign(data, payload); },
      });
    },
  });
  vm.runInContext(section(serviceSource, 'function buildAttendanceCompletionPayload(').replace(/^export /gm, ''), context);
  return { context, data, writes, moves, reads: () => reads };
}

test('a repeated completed checkout performs no extra writes and preserves its times', async () => {
  const service = createService();
  const request = {
    db: {}, attendanceData: {
      id: 'test_today', date: 'today', slotKey: 'stale-slot',
      checkInTime: { toDate: () => new Date('2026-10-20T08:00:00Z') },
    },
    nowtime: new Date('2026-10-20T08:45:00Z'),
  };
  await service.context.checkoutAttendance(request);
  await service.context.checkoutAttendance(request);
  assert.equal(service.reads(), 2);
  assert.equal(service.writes.length, 1);
  assert.equal(service.writes[0].totalMinutes, 45);
  assert.equal(service.moves.length, 1);
  assert.equal(service.moves[0].slotKey, '16:00');
});

test('temporary transaction errors propagate without writing logs on every retry', async () => {
  const error = Object.assign(new Error('offline'), { code: 'unavailable' });
  const service = createService('active', error);
  await assert.rejects(service.context.completeAttendanceAndSchedule({ db: {}, attendanceId: 'test' }), /offline/);
  assert.equal(service.writes.length, 0);
  assert.equal(service.context.isRetryableCheckoutError(error), true);
  assert.equal(service.context.isRetryableCheckoutError({ code: 'firestore/aborted' }), true);
  assert.equal(service.context.isRetryableCheckoutError({ code: 'permission-denied' }), false);
});

test('invalid attendance remains an error without waiting for error logs', async () => {
  const service = createService('cancelled');
  await assert.rejects(service.context.completeAttendanceAndSchedule({ db: {}, attendanceId: 'test' }), /ATTENDANCE_NOT_ACTIVE/);
  assert.equal(service.writes.length, 0);
  assert.equal(service.moves.length, 0);
});

test('the result module and attendance service parse', () => {
  const stripImports = source => source.replace(/^import\s+[\s\S]*?from\s+"[^"]+";/gm, '');
  const moduleScript = resultSource.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  new vm.Script(stripImports(moduleScript));
  new vm.Script(stripImports(serviceSource).replace(/^export /gm, ''));
});
