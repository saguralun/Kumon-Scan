const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness, student, root } = require('./helpers/firestore.cjs');
const { installCheckinQueue } = require('./helpers/checkinQueue.cjs');

const today = '20261019';
const attendanceId = `s_${today}`;
const slot = `dailySchedule/${today}/slots/17:30`;
const item = { id: 'bear', name: 'Bear', icon: 'B', rarity: 'common', type: 'animal' };

function setup(initial = {}) {
  const h = createHarness({ 'students/s': student(), ...initial }).load(
    'shared/dateUtils.js', 'shared/studentService.js', 'shared/scheduleService.js',
    'shared/attendanceService.js', 'checkin/reward/inventoryMigration.js',
    'checkin/reward/rewardService.js', 'checkin/reward/checkinRewardFlow.js',
  );
  h.rolls = 0;
  h.reveals = [];
  h.context.rollReward = () => { h.rolls++; return { ...item }; };
  h.context.revealRewardBig = async value => { h.reveals.push(value); };
  h.scan = (options = {}) => {
    h.studentData = h.read('students/s');
    return h.context.processAttendance({
      db: {}, today, studentId: 's', studentData: h.studentData,
      nowtime: new Date(2026, 9, 19, 17, 35), prepareReward: h.context.prepareCheckinReward,
      ...options,
    });
  };
  h.showReward = (result, options = {}) => h.context.processCheckinReward({
    db: {}, studentId: 's', studentData: h.studentData,
    attendanceId, extras: result.attendance.extras,
    savedReward: result.savedReward, stopRandomAnimation() {}, ...options,
  });
  return h;
}

test('normal check-in saves one student read and write by committing the reward with attendance', async () => {
  const baseline = setup();
  const oldResult = await baseline.scan({ prepareReward: null });
  await baseline.showReward(oldResult);
  const optimized = setup();
  const result = await optimized.scan();
  assert.equal(result.savedReward.reward.id, item.id);
  assert.equal(optimized.read(`attendance/${attendanceId}`).status, 'active');
  assert.equal(optimized.read('students/s').inventory.bear, 1);
  const beforeReveal = { ...optimized.stats };
  await optimized.showReward(result);
  assert.deepEqual(optimized.stats, beforeReveal);
  assert.equal(optimized.stats.reads, baseline.stats.reads - 1);
  assert.equal(optimized.stats.writes, baseline.stats.writes - 1);
  assert.deepEqual(optimized.read('students/s'), baseline.read('students/s'));
  assert.equal(optimized.rolls, 1);
  assert.equal(optimized.reveals.length, 1);
});

test('a failed combined commit grants neither attendance nor a reward', async () => {
  const h = setup();
  h.beforeCommit = () => { throw new Error('commit failed'); };
  await assert.rejects(h.scan(), /commit failed/);
  assert.equal(h.read(`attendance/${attendanceId}`), undefined);
  assert.equal(h.read('students/s').inventory, undefined);
  assert.equal(h.read('students/s').rewardReceipt, undefined);
  assert.equal(h.read('students/s').weeklyPlans[1].totalSessions, 1);
  assert.equal(h.stats.writes, 0);
});

test('simultaneous check-ins cannot double-award in the combined transaction', async () => {
  const h = setup();
  await Promise.all([h.scan(), h.scan()]);
  const saved = h.read('students/s');
  assert.equal(saved.inventory.bear, 1);
  assert.equal(saved.rewardReceipt.attendanceId, attendanceId);
  assert.equal(saved.weeklyPlans[1].totalSessions, 2);
  const before = { ...h.stats };
  assert.equal((await h.scan()).status, 'active');
  assert.equal(h.stats.writes, before.writes);
});

test('lost acknowledgement does not award twice when the student scans again', async () => {
  const h = setup();
  h.afterCommit = () => { h.afterCommit = null; throw new Error('ack lost'); };
  await assert.rejects(h.scan(), /ack lost/);
  const writes = h.stats.writes;
  assert.equal(h.read('students/s').inventory.bear, 1);
  assert.equal((await h.scan()).status, 'active');
  assert.equal(h.stats.writes, writes);
  assert.equal(h.read('students/s').inventory.bear, 1);
});

test('an invalid reward setup still records attendance and can recover without another check-in', async () => {
  const h = setup();
  h.context.rollReward = () => { throw new Error('NO_REWARD_ITEMS_AVAILABLE'); };
  const result = await h.scan();
  assert.equal(result.status, 'created');
  assert.equal(result.savedReward, null);
  assert.equal(h.read(`attendance/${attendanceId}`).status, 'active');
  assert.equal(h.read('students/s').rewardReceipt, undefined);
  h.context.rollReward = () => ({ ...item });
  const retry = await h.scan();
  assert.equal(retry.status, 'reward_pending');
  await h.showReward(retry);
  assert.equal(h.read('students/s').inventory.bear, 1);
  assert.equal(h.read('students/s').weeklyPlans[1].totalSessions, 2);
});

test('transaction retry recalculates inventory and pity from the latest student data', async () => {
  const h = setup();
  h.beforeCommit = () => {
    h.beforeCommit = null;
    const changed = h.read('students/s');
    changed.inventory = { bear: 6 };
    changed.rewardStats = { badLuckStreak: 7 };
    h.put('students/s', changed);
  };
  const result = await h.scan();
  assert.equal(h.stats.retries, 1);
  assert.equal(h.read('students/s').inventory.bear, 7);
  assert.equal(h.read('students/s').rewardStats.badLuckStreak, 8);
  assert.equal(result.savedReward.isNewItem, false);
});

test('WS and AT extras and the latest progress survive the combined commit', async () => {
  const extras = [{ type: 'WS', level: 'A', ws: '101' }, { type: 'AT', level: 'B' }];
  const h = setup({ [slot]: { subjects: { ME: { planned: { s: { nickname: 'S', extras } } } } } });
  const result = await h.scan();
  assert.deepEqual(Array.from(result.attendance.extras, e => ({ ...e })), extras);
  assert.deepEqual(h.read('students/s').lastProgress, { WS: { level: 'A', ws: '101' }, AT: 'B' });
  assert.deepEqual(h.read(slot).subjects.ME.checkedIn.s.extras, extras);
  assert.equal(h.read(slot).subjects.ME.planned.s, undefined);
});

test('schedule check-in still does not grant rewards even if a preparation callback is supplied', async () => {
  const h = setup();
  assert.equal((await h.scan({ rewardEligible: false, autoCheckoutPrevious: false })).status, 'created');
  assert.equal(h.rolls, 0);
  assert.equal(h.read('students/s').rewardReceipt, undefined);
  assert.equal(h.read('students/s').inventory, undefined);
});

test('showing a committed reward neither rolls again nor contacts Firestore', async () => {
  const h = setup();
  const result = await h.scan();
  h.context.rollReward = () => { throw new Error('must not reroll'); };
  h.context.updateStudentReward = () => { throw new Error('must not write reward separately'); };
  const shown = await h.showReward(result);
  assert.equal(shown.rewardResult.id, item.id);
  assert.equal(h.studentData.inventory.bear, 1);
  assert.equal(h.reveals.length, 1);
});

test('legacy inventory migration stays part of the one existing student write', async () => {
  const s = student(); s.inventory = { animal_0: { count: 2 }, bear: 3 };
  const h = setup({ 'students/s': s });
  await h.scan();
  assert.deepEqual(h.read('students/s').inventory, { bear: 6 });
  assert.equal(h.read('students/s').inventory.animal_0, undefined);
});

test('completed attendance remains untouched and is never given another reward', async () => {
  const h = setup({ [`attendance/${attendanceId}`]: { status: 'completed' } });
  assert.equal((await h.scan()).status, 'completed');
  assert.equal(h.rolls, 0);
  assert.equal(h.stats.writes, 0);
});

test('an existing receipt is respected if an attendance document was removed manually', async () => {
  const s = student(); s.inventory = { bear: 1 };
  s.rewardReceipt = { attendanceId, reward: item, isNewItem: true };
  const h = setup({ 'students/s': s });
  const result = await h.scan();
  assert.equal(result.savedReward.alreadyClaimed, true);
  assert.equal(h.read('students/s').inventory.bear, 1);
  assert.equal(h.rolls, 0);
});

test('previous-subject auto-checkout still happens before the combined check-in', async () => {
  const previous = {
    status: 'active', firstName: 'First', lastName: 'Last', studentId: 'other', subject: 'EFL',
    date: today, slotKey: '17:30', checkInTime: { toDate: () => new Date(2026, 9, 19, 16, 30) },
  };
  const h = setup({
    [`attendance/other_${today}`]: previous,
    [slot]: { subjects: { EFL: { checkedIn: { other: { nickname: 'Student', time: '16:30' } } } } },
  });
  const result = await h.scan();
  assert.equal(result.status, 'created');
  assert.equal(h.read(`attendance/other_${today}`).status, 'completed');
  assert.equal(h.read('students/s').inventory.bear, 1);
  assert.ok(h.read(slot).subjects.EFL.completed.other);
  assert.ok(h.read(slot).subjects.ME.checkedIn.s);
});

test('the actual Enter handler uses the saved reward and keeps the extra popup before reward reveal', async () => {
  const h = setup({ [slot]: { subjects: { ME: { planned: { s: {
    nickname: 'S', extras: [{ type: 'AT', level: 'B' }],
  } } } } } });
  h.load('shared/readDeadline.js', 'shared/textUtils.js', 'shared/checkinFlow.js', 'checkin/modules/storage.js');
  const order = [], errors = [];
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, classList: { add() {}, remove() {} } });
    return nodes.get(id);
  };
  Object.assign(h.context, {
    DEV_MODE: false, currentInput: 's', isProcessing: false,
    reloadIfDateChanged: () => false, validateInput: () => ({ valid: true }),
    configRefresher: { getTodaySetting: async () => ({ enabled: true }) },
    ensureCheckinStartup: async () => {}, checkTodayAndTime: async () => true,
    setUIProcessing: value => { h.context.isProcessing = value; }, resetInput() {},
    statusUI: { showError: text => errors.push(text), showSuccess: () => order.push('success') },
    $: node, qs: node, getExtraDisplay: () => ({ title: 'AT' }),
    startRandomAnimation() {}, stopRandomAnimation() {},
    reward: {
      prepareCheckinReward: h.context.prepareCheckinReward,
      processCheckinReward: h.context.processCheckinReward,
      showExtraPopup: async () => {
        assert.equal(h.read('students/s').rewardReceipt.attendanceId, attendanceId);
        order.push('extra');
      },
    },
    revealRewardBig: async () => order.push('reward'),
    updateStudentReward: () => { throw new Error('Enter must not save the reward a second time'); },
  });
  const source = fs.readFileSync(path.join(root, 'checkin/js/checkin.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function updateCollectionButton()'), source.indexOf('function onRewardConfirm()')), h.context);
  installCheckinQueue(h);
  const start = source.indexOf('window.submitID = async function ()');
  const end = source.indexOf('async function ensureCheckinStartup()', start);
  vm.runInContext(source.slice(start, end), h.context);
  await h.context.window.submitID();
  assert.deepEqual(errors, []);
  assert.deepEqual(order, ['extra', 'reward', 'success']);
  assert.equal(h.read('students/s').inventory.bear, 1);
  assert.equal(h.rolls, 1);
});
