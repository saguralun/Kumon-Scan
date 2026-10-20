const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHarness, student } = require('./helpers/firestore.cjs');

const today = '20261019';
const slot = `dailySchedule/${today}/slots/17:30`;
const day = `dailySchedule/${today}`;
function core(initial) {
  return createHarness(initial).load('shared/dateUtils.js', 'shared/studentService.js',
    'shared/scheduleService.js', 'shared/attendanceService.js');
}
function builder(initial) {
  return core(initial).load('checkin/modules/storage.js', 'checkin/modules/dailyBuild.js');
}
function checkin(h, options = {}) {
  return h.context.processAttendance({ db: {}, today, studentId: 's',
    studentData: h.read('students/s'), nowtime: new Date(2026, 9, 19, 17, 35), ...options });
}

test('schedule check-in preserves existing completed attendance without writes', async () => {
  const existing = { status: 'completed', checkOutTime: 'original', totalMinutes: 45 };
  const h = core({ 'students/s': student(), [`attendance/s_${today}`]: existing });
  const result = await checkin(h, { rewardEligible: false, plannedSlot: '17:30', autoCheckoutPrevious: false });
  assert.equal(result.status, 'completed');
  assert.deepEqual(h.read(`attendance/s_${today}`), existing);
  assert.equal(h.stats.writes, 0);
});

test('attendance, weekly plan and schedule fail or commit together', async () => {
  const h = core({ 'students/s': student() });
  h.beforeCommit = writes => { if (writes.some(w => w.ref === slot)) throw new Error('network failed'); };
  await assert.rejects(checkin(h), /network failed/);
  assert.equal(h.read(`attendance/s_${today}`), undefined);
  assert.equal(h.read(slot), undefined);
  assert.equal(h.read('students/s').weeklyPlans[1].totalSessions, 1);
  h.beforeCommit = null;
  assert.equal((await checkin(h)).status, 'created');
  assert.equal(h.read('students/s').weeklyPlans[1].totalSessions, 2);
  assert.ok(h.read(slot).subjects.ME.checkedIn.s);
  await checkin(h, { rewardEligible: false });
  assert.equal(h.read('students/s').weeklyPlans[1].totalSessions, 2);
});

test('WS racing checkout follows the student to completed instead of recreating checkedIn', async () => {
  const h = core({ [slot]: { subjects: { ME: { checkedIn: { s: { nickname: 'S', time: '17:35', extras: [] } } } } } });
  h.beforeCommit = () => {
    h.beforeCommit = null;
    h.put(slot, { subjects: { ME: { checkedIn: {}, completed: { s: { nickname: 'S', time: '17:35', extras: [] } } } } });
  };
  await h.context.updateScheduleExtras({ db: {}, today, studentId: 's', subject: 'ME', slotKey: '17:30', extra: { type: 'WS', level: 'A', ws: '1' } });
  assert.equal(h.read(slot).subjects.ME.checkedIn.s, undefined);
  assert.equal(h.read(slot).subjects.ME.completed.s.extras.length, 1);
  assert.equal(h.stats.retries, 1);
});

test('two simultaneous extra updates both survive and undo removes the latest matching type', async () => {
  const h = core({ [slot]: { subjects: { ME: { planned: { s: { nickname: 'S', extras: [] } } } } } });
  const base = { db: {}, today, studentId: 's', subject: 'ME', slotKey: '17:30' };
  await Promise.all([
    h.context.updateScheduleExtras({ ...base, extra: { type: 'WS', level: 'A', ws: '1' } }),
    h.context.updateScheduleExtras({ ...base, extra: { type: 'AT', level: 'B' } }),
  ]);
  assert.equal(h.read(slot).subjects.ME.planned.s.extras.length, 2);
  await h.context.updateScheduleExtras({ ...base, removeType: 'WS' });
  assert.deepEqual(h.read(slot).subjects.ME.planned.s.extras, [{ type: 'AT', level: 'B' }]);
});

test('a failed build chunk never penalizes a student without saving their plan', async () => {
  const h = builder({ 'students/s': student() });
  h.beforeCommit = writes => { if (writes.some(w => w.ref === slot)) throw new Error('save failed'); };
  assert.equal((await h.context.ensureDailyScheduleBuilt({})).status, 'failed');
  assert.equal(h.read('students/s').weeklyPlans[1].planStrength, 5);
  assert.equal(h.read(slot), undefined);
  h.beforeCommit = null;
  assert.equal((await h.context.ensureDailyScheduleBuilt({})).built, true);
  assert.equal(h.read('students/s').weeklyPlans[1].planStrength, 4);
});

test('a partial 101-student build resumes even when the first 100 strengths reached zero', async () => {
  const initial = {};
  for (let i = 0; i < 101; i++) initial[`students/s${String(i).padStart(3, '0')}`] = student(1);
  const h = builder(initial);
  h.beforeCommit = writes => {
    if (writes.some(w => w.ref === 'students/s100')) throw new Error('interrupted');
  };
  assert.equal((await h.context.ensureDailyScheduleBuilt({})).built, false);
  assert.equal(h.read(day).status, 'building');
  assert.equal(h.read('system/config'), undefined);
  assert.equal(h.read('students/s000').weeklyPlans[1].planStrength, 0);
  assert.equal(h.read('students/s100').weeklyPlans[1].planStrength, 1);
  h.beforeCommit = null;
  assert.equal((await h.context.ensureDailyScheduleBuilt({})).built, true);
  assert.equal(Object.keys(h.read(slot).subjects.ME.planned).length, 101);
  assert.equal(h.read('students/s000').weeklyPlans[1].missStreak, 1);
  assert.equal(h.read('students/s100').weeklyPlans[1].missStreak, 1);
});

test('simultaneous builders never overwrite or double-penalize', async () => {
  const h = builder({ 'students/s': student() });
  await Promise.all([h.context.ensureDailyScheduleBuilt({}), h.context.ensureDailyScheduleBuilt({})]);
  assert.equal(h.read('students/s').weeklyPlans[1].planStrength, 4);
  assert.equal(h.read('students/s').weeklyPlans[1].missStreak, 1);
  assert.equal(Object.keys(h.read(slot).subjects.ME.planned).length, 1);
  assert.equal(h.read(day).status, 'complete');
});

test('legacy schedules preserve active children, extras and cancellations without falsely marking complete', async () => {
  const existing = { subjects: { ME: { checkedIn: { s: { nickname: 'S', time: '17:35', extras: [{ type: 'AT', level: 'B' }] } } } } };
  const h = builder({ 'students/s': student(), 'students/new': student(), [slot]: existing });
  assert.equal((await h.context.ensureDailyScheduleBuilt({})).status, 'existing');
  assert.deepEqual(h.read(slot).subjects.ME.checkedIn, existing.subjects.ME.checkedIn);
  assert.equal(h.read(slot).subjects.ME.planned, undefined);
  assert.equal(h.read('system/config'), undefined);
  assert.equal(h.read(day).status, 'existing');
  assert.equal(h.read('students/s').weeklyPlans[1].planStrength, 5);
  const before = { ...h.stats };
  await h.context.ensureDailyScheduleBuilt({});
  assert.equal(h.stats.reads, before.reads + 1);
  assert.equal(h.stats.writes, before.writes);
});

test('invalid slots remain partial and can be repaired without pretending the build completed', async () => {
  const invalid = student(); invalid.weeklyPlans[1].timeSlot = '';
  const h = builder({ 'students/s': invalid });
  assert.equal((await h.context.ensureDailyScheduleBuilt({})).status, 'partial');
  assert.equal(h.read('system/config'), undefined);
  invalid.weeklyPlans[1].timeSlot = '17:30'; h.put('students/s', invalid);
  assert.equal((await h.context.ensureDailyScheduleBuilt({})).built, true);
  assert.ok(h.read(slot).subjects.ME.planned.s);
});

test('a check-in racing a build stays checkedIn and is never added back to planned', async () => {
  const h = builder({ 'students/s': student() });
  await Promise.all([h.context.ensureDailyScheduleBuilt({}), checkin(h)]);
  assert.ok(h.read(slot).subjects.ME.checkedIn.s);
  assert.equal(h.read(slot).subjects.ME.planned?.s, undefined);
  assert.equal(h.read('students/s').weeklyPlans[1].totalSessions, 2);
});

test('reward failure resumes the existing attendance and a repeated award does not write twice', async () => {
  const h = core({ 'students/s': student() }).load('checkin/reward/inventoryMigration.js', 'checkin/reward/rewardService.js');
  const created = await checkin(h);
  const reward = { id: 'bear', rarity: 'common', name: 'Bear', icon: 'B', type: 'animal' };
  const request = { db: {}, studentId: 's', studentData: h.read('students/s'), rewardId: 'bear', rewardRarity: 'common', attendanceId: created.attendance.attendanceId, reward };
  h.beforeCommit = writes => { if (writes.some(w => w.value.rewardReceipt)) throw new Error('reward failed'); };
  await assert.rejects(h.context.updateStudentReward(request), /reward failed/);
  assert.equal((await checkin(h)).status, 'reward_pending');
  assert.equal(h.read('students/s').weeklyPlans[1].totalSessions, 2);
  h.beforeCommit = null;
  await h.context.updateStudentReward(request);
  const writes = h.stats.writes;
  const duplicate = await h.context.updateStudentReward({ ...request, rewardId: 'cat' });
  assert.equal(duplicate.reward.id, 'bear');
  assert.equal(h.read('students/s').inventory.bear, 1);
  assert.equal(h.stats.writes, writes);
  assert.equal((await checkin(h)).status, 'active');
});

test('legacy inventory is migrated in the same reward write', async () => {
  const s = student(); s.inventory = { animal_0: { count: 2 }, bear: 3 };
  const h = core({ 'students/s': s }).load('checkin/reward/inventoryMigration.js', 'checkin/reward/rewardService.js');
  const request = { db: {}, studentId: 's', rewardId: 'cat', rewardRarity: 'common' };
  await h.context.updateStudentReward(request);
  await h.context.updateStudentReward(request);
  assert.equal(h.read('students/s').inventory.bear, 5);
  assert.equal(h.read('students/s').inventory.animal_0, undefined);
  assert.equal(h.read('students/s').inventory.cat, 2);
});

test('simultaneous reward claims with different rolls grant only the first reward', async () => {
  const h = core({ 'students/s': student() }).load('checkin/reward/inventoryMigration.js', 'checkin/reward/rewardService.js');
  const request = { db: {}, studentId: 's', attendanceId: 's_' + today, rewardRarity: 'common' };
  const results = await Promise.all([
    h.context.updateStudentReward({ ...request, rewardId: 'bear' }),
    h.context.updateStudentReward({ ...request, rewardId: 'cat' }),
  ]);
  assert.equal(results[0].reward.id, results[1].reward.id);
  assert.equal(Object.values(h.read('students/s').inventory).reduce((a, b) => a + b, 0), 1);
  assert.equal(h.stats.writes, 1);
});

test('lost reward acknowledgement can be retried without increasing inventory or writes', async () => {
  const h = core({ 'students/s': student() }).load('checkin/reward/inventoryMigration.js', 'checkin/reward/rewardService.js');
  const request = { db: {}, studentId: 's', attendanceId: 's_' + today, rewardId: 'bear', rewardRarity: 'common' };
  h.afterCommit = () => { h.afterCommit = null; throw new Error('acknowledgement lost'); };
  await assert.rejects(h.context.updateStudentReward(request), /acknowledgement lost/);
  const writes = h.stats.writes;
  assert.equal((await h.context.updateStudentReward(request)).alreadyClaimed, true);
  assert.equal(h.read('students/s').inventory.bear, 1);
  assert.equal(h.stats.writes, writes);
});

test('failed finalization resumes without restoring a deliberately cancelled plan', async () => {
  const h = builder({ 'students/s': student() });
  h.beforeCommit = writes => { if (writes.some(w => w.ref === day && w.value.status === 'complete')) throw new Error('finish failed'); };
  assert.equal((await h.context.ensureDailyScheduleBuilt({})).built, false);
  assert.equal(h.read('students/s').weeklyPlans[1].planStrength, 4);
  const cancelled = h.read(slot); delete cancelled.subjects.ME.planned.s; h.put(slot, cancelled);
  h.beforeCommit = null;
  assert.equal((await h.context.ensureDailyScheduleBuilt({})).built, true);
  assert.equal(h.read(slot).subjects.ME.planned.s, undefined);
  assert.equal(h.read('students/s').weeklyPlans[1].planStrength, 4);
});

test('normal reward claims use one existing student read and write, with no separate receipt write', async () => {
  const h = core({ 'students/s': student() }).load('checkin/reward/inventoryMigration.js', 'checkin/reward/rewardService.js');
  await h.context.updateStudentReward({ db: {}, studentId: 's', attendanceId: 's_' + today, rewardId: 'bear', rewardRarity: 'common' });
  assert.equal(h.stats.reads, 1);
  assert.equal(h.stats.writes, 1);
});

test('a finished daily build uses no extra server reads or writes on the same session', async () => {
  const h = builder({ 'students/s': student() });
  await h.context.ensureDailyScheduleBuilt({});
  const before = { ...h.stats };
  await h.context.ensureDailyScheduleBuilt({});
  assert.deepEqual(h.stats, before);
});

test('schedule check-in keeps its original behaviour without querying or auto-checking out another subject', async () => {
  const other = { status: 'active', firstName: 'First', lastName: 'Last' };
  const h = core({ 'students/s': student(), [`attendance/other_${today}`]: other });
  assert.equal((await checkin(h, { rewardEligible: false, autoCheckoutPrevious: false })).status, 'created');
  assert.equal(h.read(`attendance/other_${today}`).status, 'active');
  assert.equal(h.stats.queries, 0);
  assert.equal(h.read(`attendance/s_${today}`).rewardEligible, false);
});

test('scanner check-in still completes the previous subject automatically', async () => {
  const other = { status: 'active', firstName: 'First', lastName: 'Last', studentId: 'other', subject: 'EFL', date: today, slotKey: '17:30', checkInTime: { toDate: () => new Date(2026, 9, 19, 16, 30) } };
  const h = core({ 'students/s': student(), [`attendance/other_${today}`]: other,
    [slot]: { subjects: { EFL: { checkedIn: { other: { nickname: 'Student', time: '16:30' } } } } },
  });
  assert.equal((await checkin(h)).status, 'created');
  assert.equal(h.read(`attendance/other_${today}`).status, 'completed');
  assert.equal(h.read(`attendance/other_${today}`).autoCheckout, true);
  assert.ok(h.read(slot).subjects.EFL.completed.other);
  assert.ok(h.read(slot).subjects.ME.checkedIn.s);
});
