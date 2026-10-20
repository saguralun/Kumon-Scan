const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { createHarness, student, root } = require('./helpers/firestore.cjs');
const { installCheckinQueue } = require('./helpers/checkinQueue.cjs');
const source = fs.readFileSync(path.join(root, 'checkin/js/checkin.js'), 'utf8');
const today = '20261019', id = 's_' + today;

function setup({ status = 'active', attendance = {}, queueStatus, inventory = { test: 2 } } = {}) {
  const h = createHarness({
    'students/s': { ...student(), inventory },
    ['attendance/' + id]: { studentId: 's', subject: 'ME', date: today, status,
      checkInTime: { toDate: () => new Date(2026, 9, 19, 17, 35) }, totalMinutes: 45,
      slotKey: '17:30', rewardEligible: true, rewardState: 'granted', ...attendance },
  }).load('shared/dateUtils.js', 'shared/readDeadline.js', 'shared/textUtils.js',
    'shared/studentService.js', 'shared/scheduleService.js', 'shared/attendanceService.js',
    'shared/checkinFlow.js', 'checkin/modules/storage.js');
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { style: {}, classList: { add() {}, remove() {} } });
    return nodes.get(key);
  };
  let rolls = 0;
  Object.assign(h.context, {
    DEV_MODE: false, currentInput: 's', isProcessing: false,
    reloadIfDateChanged: () => false, validateInput: () => ({ valid: true }),
    configRefresher: { getTodaySetting: async () => ({ enabled: true }) },
    ensureCheckinStartup: async () => {}, checkTodayAndTime: async () => true,
    setUIProcessing: value => { h.context.isProcessing = value; }, resetInput() {},
    statusUI: { showError() {}, showSuccess() {}, showStatus() {} },
    audio: { triggerFeedback() {} }, $: node, qs: node,
    rollReward: () => { rolls++; throw new Error('A repeated ID must not roll a reward'); },
    reward: { processCheckinReward: () => { throw new Error('A repeated ID must not reveal or save a reward'); } },
  });
  installCheckinQueue(h);
  h.context.saveStudentSession('previous', { nickname: 'Previous child', inventory: { previous: 99 } });
  vm.runInContext(source.slice(source.indexOf('function updateCollectionButton()'), source.indexOf('function onRewardConfirm()')), h.context);
  if (queueStatus) h.context.createPendingStore('checkin').put({
    version: 1, id, requestId: 'previous-request', studentId: 's', today, status: queueStatus,
    nickname: 'Student', subject: 'ME', createdAt: 1, attempts: 1,
    requestedAt: new Date(2026, 9, 19, 17, 35).toISOString(),
    ...(queueStatus === 'done' ? { result: { status: 'created' } } : {}),
  });
  vm.runInContext(source.slice(source.indexOf('window.submitID = async function ()'), source.indexOf('async function ensureCheckinStartup()')), h.context);
  h.node = node;
  h.rolls = () => rolls;
  return h;
}

for (const status of ['active', 'completed']) {
  test(`re-entering an ${status} student's ID prepares their own Collection with no writes or reward roll`, async () => {
    const h = setup({ status });
    await h.context.window.submitID();
    const session = h.context.loadStudentSession();
    assert.equal(session.studentId, 's');
    assert.equal(session.inventory.test, 2);
    assert.equal(session.inventory.previous, undefined);
    assert.equal(h.node('collectionLinkWrapper').style.display, 'flex');
    assert.equal(h.stats.reads, 2);
    assert.equal(h.stats.queries, 0);
    assert.equal(h.stats.writes, 0);
    assert.equal(h.rolls(), 0);
    assert.equal(h.read('attendance/' + id).status, status);
    h.context.checkinJobs.dispose();
  });
}

test('a restored confirmed queue opens Collection using only the student read', async () => {
  const h = setup({ queueStatus: 'done' });
  await h.context.window.submitID();
  assert.equal(h.context.loadStudentSession().studentId, 's');
  assert.equal(h.context.loadStudentSession().inventory.test, 2);
  assert.equal(h.node('collectionLinkWrapper').style.display, 'flex');
  assert.equal(h.stats.reads, 1);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.rolls(), 0);
  h.context.checkinJobs.dispose();
});

test('a pending job does not expose the previous child Collection or resubmit', async () => {
  const h = setup({ queueStatus: 'pending' });
  await h.context.window.submitID();
  assert.equal(h.context.loadStudentSession().studentId, null);
  assert.equal(h.node('collectionLinkWrapper').style.display, 'none');
  assert.equal(h.stats.reads, 1);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.context.checkinJobs.get(id).requestId, 'previous-request');
  assert.equal(h.rolls(), 0);
  h.context.checkinJobs.dispose();
});

test('viewing existing attendance does not claim an ungranted legacy reward', async () => {
  const h = setup({ attendance: { rewardState: 'pending' } });
  await h.context.window.submitID();
  assert.equal(h.context.loadStudentSession().studentId, 's');
  assert.equal(h.stats.writes, 0);
  assert.equal(h.rolls(), 0);
  assert.equal(h.read('attendance/' + id).rewardState, 'pending');
  h.context.checkinJobs.dispose();
});

test('a schedule check-in can view Collection without receiving a scanner reward', async () => {
  const h = setup({ attendance: { rewardEligible: false, rewardState: 'none' } });
  await h.context.window.submitID();
  assert.equal(h.context.loadStudentSession().studentId, 's');
  assert.equal(h.stats.writes, 0);
  assert.equal(h.rolls(), 0);
  h.context.checkinJobs.dispose();
});

test('a new unknown ID clears the previous Collection without writing anything', async () => {
  const h = setup();
  h.context.currentInput = 'missing';
  await h.context.window.submitID();
  assert.equal(h.context.loadStudentSession().studentId, null);
  assert.equal(h.node('collectionLinkWrapper').style.display, 'none');
  assert.equal(h.stats.reads, 1);
  assert.equal(h.stats.writes, 0);
  h.context.checkinJobs.dispose();
});
