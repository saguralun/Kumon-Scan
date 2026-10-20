const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHarness, student } = require('./helpers/firestore.cjs');
const { installCheckinQueue } = require('./helpers/checkinQueue.cjs');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function flush() { for (let i = 0; i < 200; i++) await Promise.resolve(); }
function setup(initial = {}) {
  const h = createHarness(initial);
  let now = 1000, id = 0;
  const timers = new Map();
  h.context.Date = class extends Date { static now() { return now; } };
  h.context.setTimeout = (callback, ms) => { const key = ++id; timers.set(key, { callback, at: now + ms }); return key; };
  h.context.clearTimeout = key => timers.delete(key);
  h.advance = async ms => {
    now += ms;
    for (const [key, value] of [...timers]) if (value.at <= now) { timers.delete(key); value.callback(); }
    await flush();
  };
  h.load('shared/pendingStore.js', 'shared/outbox.js');
  h.make = options => h.context.createOutbox({ kind: 'test', onChange() {}, ...options });
  return h;
}
const payload = (id = 's_today', group = id) => ({ id, group, requestedAt: '2026-10-19T10:35:00.000Z' });

test('an accepted job is durable before execution and restores with its original identity and time', async () => {
  const h = setup();
  const first = h.make({ execute: () => { throw new Error('not started'); } });
  const accepted = first.enqueue(payload());
  assert.equal(first.list().length, 1);
  first.dispose();
  let calls = 0;
  const restored = h.make({ execute: async job => { calls++; return { requestId: job.requestId, at: job.requestedAt }; } });
  restored.resume();
  const result = await restored.wait(accepted.job.id);
  assert.equal(result.requestId, accepted.job.requestId);
  assert.equal(result.at, accepted.job.requestedAt);
  assert.equal(calls, 1);
  assert.equal(restored.get(accepted.job.id).status, 'done');
  restored.dispose();
});

test('duplicate taps reuse one durable job and one promise', async () => {
  const h = setup(), pending = deferred();
  let calls = 0;
  const queue = h.make({ execute: () => { calls++; return pending.promise; } });
  const one = queue.enqueue(payload()), two = queue.enqueue(payload());
  assert.equal(two.existing, true);
  assert.equal(one.promise, two.promise);
  assert.equal(one.job.requestId, two.job.requestId);
  queue.resume();
  await flush();
  assert.equal(calls, 1);
  pending.resolve('saved');
  await one.promise;
  queue.dispose();
});

test('storage failure refuses the job before any server-side operation', () => {
  const h = setup(); let calls = 0;
  const queue = h.make({ execute: () => { calls++; } });
  h.context.localStorage.setItem = () => { throw new Error('storage full'); };
  assert.throws(() => queue.enqueue(payload()), error => error.isOutboxStorageError);
  assert.equal(calls, 0);
  queue.dispose();
});

test('offline jobs remain pending and only resume when connected', async () => {
  const h = setup(); let online = false, calls = 0;
  const queue = h.make({ isOnline: () => online, execute: async () => { calls++; return 'ok'; } });
  const accepted = queue.enqueue(payload()); queue.resume();
  await h.advance(60000);
  assert.equal(calls, 0);
  online = true; queue.resume();
  assert.equal(await accepted.promise, 'ok');
  assert.equal(calls, 1);
  queue.dispose();
});

test('transient errors back off without losing the job or its original request time', async () => {
  const h = setup(); let calls = 0;
  const queue = h.make({ execute: async job => {
    if (++calls === 1) throw Object.assign(new Error('offline'), { code: 'unavailable' });
    return job.requestedAt;
  } });
  const accepted = queue.enqueue(payload()); queue.resume();
  await flush();
  assert.equal(queue.get(accepted.job.id).status, 'pending');
  assert.equal(calls, 1);
  await h.advance(2999); assert.equal(calls, 1);
  await h.advance(1);
  assert.equal(await accepted.promise, accepted.job.requestedAt);
  assert.equal(calls, 2);
  queue.dispose();
});

test('jobs for one person preserve order while another person can continue', async () => {
  const h = setup(), held = deferred(), starts = [];
  const queue = h.make({ execute: job => { starts.push(job.id); return job.id === 'a1' ? held.promise : Promise.resolve(job.id); } });
  const a = queue.enqueue(payload('a1', 'A'));
  const a2 = queue.enqueue(payload('a2', 'A'));
  const b = queue.enqueue(payload('b1', 'B'));
  queue.resume(); await flush();
  assert.deepEqual(starts, ['a1', 'b1']);
  held.resolve('a1');
  await Promise.all([a.promise, a2.promise, b.promise]);
  assert.deepEqual(starts, ['a1', 'b1', 'a2']);
  queue.dispose();
});

test('a person awaiting retry cannot be overtaken by their next subject', async () => {
  const h = setup(), starts = []; let first = true;
  const queue = h.make({ execute: async job => {
    starts.push(job.id);
    if (job.id === 'a1' && first) { first = false; throw Object.assign(new Error('network'), { code: 'unavailable' }); }
    return job.id;
  } });
  const a = queue.enqueue(payload('a1', 'A')), b = queue.enqueue(payload('a2', 'A'));
  queue.resume(); await flush();
  assert.deepEqual(starts, ['a1']);
  await h.advance(3000);
  await Promise.all([a.promise, b.promise]);
  assert.deepEqual(starts, ['a1', 'a1', 'a2']);
  queue.dispose();
});

test('permanent failures and quota errors wait for manual retry', async () => {
  const h = setup(); let fail = true;
  const queue = h.make({ execute: async () => {
    if (fail) throw Object.assign(new Error('quota'), { code: 'resource-exhausted' });
    return 'ok';
  } });
  const accepted = queue.enqueue(payload()); queue.resume();
  await assert.rejects(accepted.promise, /quota/);
  assert.equal(queue.get(accepted.job.id).status, 'failed');
  await h.advance(60000);
  assert.equal(queue.get(accepted.job.id).attempts, 1);
  fail = false; queue.retry(accepted.job.id);
  assert.equal(await queue.wait(accepted.job.id), 'ok');
  queue.dispose();
});

test('confirmation is persisted before the foreground is released', async () => {
  const h = setup(); const queue = h.make({ execute: async () => ({ success: true }) });
  const accepted = queue.enqueue(payload()); queue.resume();
  await accepted.promise;
  assert.equal(queue.get(accepted.job.id).status, 'done');
  queue.acknowledge(accepted.job.id);
  assert.equal(queue.list().length, 0);
  queue.dispose();
});

test('a failed job does not permanently block the next subject for that person', async () => {
  const h = setup(), starts = [];
  const queue = h.make({ execute: async job => {
    starts.push(job.id);
    if (job.id === 'a1') throw new Error('invalid data');
    return job.id;
  } });
  const one = queue.enqueue(payload('a1', 'A'));
  const two = queue.enqueue(payload('a2', 'A'));
  queue.resume();
  await assert.rejects(one.promise, /invalid data/);
  assert.equal(await two.promise, 'a2');
  assert.deepEqual(starts, ['a1', 'a2']);
  queue.dispose();
});

test('a failed local receipt checkpoint pauses replay until explicitly resumed', async () => {
  const h = setup(); let calls = 0;
  const originalSet = h.context.localStorage.setItem;
  const queue = h.make({ execute: async () => {
    calls++;
    h.context.localStorage.setItem = () => { throw new Error('storage full'); };
    return 'saved';
  } });
  const accepted = queue.enqueue(payload());
  queue.resume(); await flush();
  await h.advance(60000);
  assert.equal(calls, 1);
  assert.equal(queue.get(accepted.job.id).status, 'pending');
  h.context.localStorage.setItem = originalSet;
  queue.dispose();
  const restored = h.make({ execute: async () => 'already saved' });
  restored.resume();
  assert.equal(await restored.wait(accepted.job.id), 'already saved');
  restored.dispose();
});

test('a busy cross-tab lock does not spin or contact the server', async () => {
  const h = setup(); let locks = 0, calls = 0;
  const queue = h.make({ withLock: async () => { locks++; }, execute: () => { calls++; } });
  queue.enqueue(payload()); queue.resume(); await flush();
  assert.equal(locks, 1); assert.equal(calls, 0);
  await h.advance(1000);
  assert.equal(locks, 2); assert.equal(calls, 0);
  queue.dispose();
});

test('another tab changing storage does not bypass a pending retry delay', async () => {
  const h = setup(); let onStorage;
  h.context.window.addEventListener = (type, callback) => { if (type === 'storage') onStorage = callback; };
  const queue = h.make({ execute: async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); } });
  const job = queue.enqueue(payload()).job; queue.resume(); await flush();
  const before = queue.get(job.id);
  onStorage({ key: 'kumon-outbox-v1:test:s_today' }); await flush();
  assert.equal(queue.get(job.id).retryAt, before.retryAt);
  assert.equal(queue.get(job.id).attempts, 1);
  queue.dispose();
});

function checkins(initial = {}) {
  const h = createHarness({ 'students/s': student(), ...initial }).load(
    'shared/dateUtils.js', 'shared/readDeadline.js', 'shared/studentService.js',
    'shared/scheduleService.js', 'shared/attendanceService.js',
  );
  h.context.ensureCheckinStartup = async () => {};
  const queue = installCheckinQueue(h);
  h.submit = () => queue.submit({ studentId: 's', studentData: h.read('students/s'), today: '20261019', requestedAt: new Date(2026, 9, 19, 17, 35) });
  h.queue = queue;
  return h;
}

test('queued attendance keeps the original check-in time and stores its own reward receipt', async () => {
  const h = checkins(); const job = h.submit(); h.queue.resume();
  await job.promise;
  const saved = h.read('attendance/s_20261019');
  assert.equal(saved.checkInTime.toDate().getTime(), new Date(2026, 9, 19, 17, 35).getTime());
  assert.equal(saved.requestId, job.job.requestId);
  assert.equal(saved.rewardState, 'granted');
  assert.equal(saved.rewardReceipt.reward.id, 'test');
  h.queue.dispose();
});

test('lost acknowledgement restores a queued attendance without granting a reward again', async () => {
  const h = checkins();
  h.afterCommit = () => { h.afterCommit = null; throw new Error('ack lost'); };
  const accepted = h.submit(); h.queue.resume();
  await assert.rejects(accepted.promise, /ack lost/);
  const writes = h.stats.writes;
  assert.equal(h.read('students/s').inventory.test, 1);
  h.queue.retry(accepted.job.id);
  const recovered = await h.queue.wait(accepted.job.id);
  assert.equal(recovered.attendanceResult.restored, true);
  assert.equal(h.read('students/s').inventory.test, 1);
  assert.equal(h.stats.writes, writes);
  h.queue.dispose();
});

test('an old pending job uses its attendance receipt after a newer-day reward changed the student receipt', async () => {
  const h = checkins(); const accepted = h.submit(); h.queue.resume(); await accepted.promise;
  const old = h.queue.get(accepted.job.id);
  h.queue.dispose();
  const s = h.read('students/s');
  s.inventory.test = 2; s.rewardReceipt = { attendanceId: 's_20261020', reward: { id: 'test' } };
  s.lastAttendanceDate = '20261020'; h.put('students/s', s);
  h.context.createPendingStore('checkin').put({ ...old, status: 'pending', result: null });
  const restored = h.context.createCheckinQueue({ db: {}, connection: h.context.connection,
    ensureReady: async () => {}, onChange() {}, storage: h.context.localStorage,
  });
  const writes = h.stats.writes; restored.resume(); await restored.wait(old.id);
  assert.equal(h.read('students/s').inventory.test, 2);
  assert.equal(h.read('students/s').lastAttendanceDate, '20261020');
  assert.equal(h.stats.writes, writes);
  restored.dispose();
});

test('reward configuration recovery marks the attendance receipt in the same transaction as the award', async () => {
  const h = checkins();
  h.context.rollReward = () => { throw new Error('NO_REWARD_ITEMS_AVAILABLE'); };
  const accepted = h.submit(); h.queue.resume();
  await assert.rejects(accepted.promise, /NO_REWARD_ITEMS/);
  assert.equal(h.read('attendance/s_20261019').rewardState, 'pending');
  h.context.rollReward = () => ({ id: 'test', name: 'Test', icon: '*', type: 'shape', rarity: 'common' });
  h.queue.retry(accepted.job.id); await h.queue.wait(accepted.job.id);
  assert.equal(h.read('attendance/s_20261019').rewardState, 'granted');
  assert.equal(h.read('students/s').inventory.test, 1);
  h.queue.dispose();
});

test('recovering a missing old check-in never checks out a newer active subject', async () => {
  const h = checkins({ 'attendance/other_20261019': { date: '20261019', status: 'active', firstName: 'First', lastName: 'Last',
    checkInTime: { toDate: () => new Date(2026, 9, 19, 18, 0) } } });
  const accepted = h.submit(); h.queue.resume();
  await assert.rejects(accepted.promise, /CHECKIN_ORDER_REQUIRES_REVIEW/);
  assert.equal(h.read('attendance/s_20261019'), undefined);
  assert.equal(h.read('attendance/other_20261019').status, 'active');
  h.queue.dispose();
});
