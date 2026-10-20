const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { createHarness, student, root } = require('./helpers/firestore.cjs');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const today = '20261019';

test('Hosting excludes the contents of hidden directories, tests and logs', () => {
  const config = JSON.parse(read('firebase.json'));
  for (const pattern of ['**/.*/**', '**/node_modules/**', 'tests/**', '**/*.log']) {
    assert.ok(config.hosting.ignore.includes(pattern), pattern);
  }
});

function attendanceHarness(nickname = '') {
  return createHarness({ 'students/s': { ...student(), nickname } }).load(
    'shared/dateUtils.js', 'shared/studentService.js', 'shared/scheduleService.js', 'shared/attendanceService.js',
  );
}

test('blank nickname can check in and out with the same read/write count as a named student', async () => {
  const counts = [];
  for (const nickname of ['', '   ', 'Named']) {
    const h = attendanceHarness(nickname);
    await h.context.processAttendance({ db: {}, studentId: 's', studentData: h.read('students/s'), today });
    const data = h.read('attendance/s_' + today);
    assert.equal(data.nickname, nickname.trim() || 'First');
    await h.context.checkoutAttendance({ db: {}, attendanceData: { id: 's_' + today, ...data } });
    assert.equal(h.read('attendance/s_' + today).status, 'completed');
    counts.push([h.stats.reads, h.stats.writes]);
  }
  assert.deepEqual(counts[0], counts[2]);
  assert.deepEqual(counts[1], counts[2]);
});

test('legacy checkedIn with a blank nickname completes with its extras in the existing two writes', async () => {
  const h = attendanceHarness();
  h.put('dailySchedule/' + today + '/slots/17:30', { subjects: { ME: { checkedIn: { s: {
    nickname: '', time: '17:35', extras: [{ type: 'AT', level: 'A' }],
  } } } } });
  h.put('attendance/s_' + today, { status: 'active', studentId: 's', subject: 'ME', slotKey: '17:30', date: today,
    checkInTime: { toDate: () => new Date(2026, 9, 19, 17, 35) } });
  await h.context.checkoutAttendance({ db: {}, attendanceData: { id: 's_' + today, ...h.read('attendance/s_' + today) } });
  const completed = h.read('dailySchedule/' + today + '/slots/17:30').subjects.ME.completed.s;
  assert.equal(completed.nickname, 's');
  assert.equal(completed.extras[0].type, 'AT');
  assert.equal(h.stats.reads, 2);
  assert.equal(h.stats.writes, 2);
});

test('closed teaching day does not query, build, penalize or mark the daily build complete', async () => {
  const h = attendanceHarness();
  h.load('checkin/modules/storage.js', 'checkin/modules/dailyBuild.js');
  const result = await h.context.ensureDailyScheduleBuilt({}, null, { teachingEnabled: false });
  assert.equal(result.status, 'closed');
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.read('students/s').weeklyPlans[1].planStrength, 5);
  assert.equal(h.context.loadBuildStatusCache(), null);
});

test('startup passes the refreshed closed-day setting to the build guard', async () => {
  const h = attendanceHarness(); let options;
  Object.assign(h.context, {
    configRefresher: { refresh: async () => ({ weekly: { 1: { enabled: false } } }) },
    verifyClientClock: async () => true,
    ensureDailyScheduleBuilt: async (db, date, value) => { options = value; return { status: 'closed' }; },
  });
  vm.runInContext('let checkinStartupReady=false, checkinStartupTask=null;\n' +
    section(read('checkin/js/checkin.js'), 'async function ensureCheckinStartup()', '// หน้าโหลด checkversion'), h.context);
  await h.context.ensureCheckinStartup();
  assert.equal(options.teachingEnabled, false);
  assert.equal(h.stats.writes, 0);
});

test('production Check-in no longer contains the mock-ID bypass or its reward write path', () => {
  const source = read('checkin/js/checkin.js');
  for (const marker of ['DEV_MODE', 'MOCK_IDS', 'mockStudent', 'isMockUser']) assert.ok(!source.includes(marker), marker);
});

test('student status modal escapes the decoded stored name and ID again', () => {
  const h = createHarness(), nodes = new Map();
  h.context.$ = id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); };
  h.context.bootstrap = { Modal: class { show() {} } };
  vm.runInContext(section(read('student_data.html'), 'window.toggleStatus =', '$("confirmStatusBtn").onclick'), h.context);
  h.context.window.toggleStatus('<img src=x onerror=bad()>', true, '<svg onload=bad()>');
  const html = nodes.get('targetStudentInfo').innerHTML;
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<svg'));
  assert.match(html, /&lt;svg/);
});

test('Result checkout action does not interpolate a stored ID into executable JavaScript', () => {
  const h = createHarness(); h.context.timeFormat = {};
  vm.runInContext(section(read('result.html'), 'function createActiveCard(', 'function createSubjectHeader('), h.context);
  const html = h.context.createActiveCard({ item: { id: "s');bad();//", nickname: '<img src=x>' },
    cardClass: 'student-card', badgeHTML: '', minutes: 1, percent: 1, color: '#000000', checkIn: new Date() });
  assert.match(html, /onclick="checkout\(this.dataset.attendanceId\)"/);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes("checkout('s"));
});

function calendar() {
  return createHarness({ 'system/config': { appVersion: '6.0.8', weekly: { 1: { enabled: true } }, rewardItems: {
    a: { releaseDate: '2026-10-20', name: 'A' }, b: { releaseDate: '2026-10-21', name: 'B' },
  } } }).load('shared/rewardCalendarService.js');
}
const change = { id: 'a', previousDate: '2026-10-20', releaseDate: '2026-10-22' };

test('calendar saves only the changed release date with one read and one existing document write', async () => {
  const h = calendar(), config = h.read('system/config');
  config.rewardItems.a.name = 'Changed by editor';
  config.rewardItems.c = { releaseDate: '2026-11-01', name: 'New reward' };
  h.put('system/config', config);
  await h.context.saveRewardReleaseDates({ db: {}, changes: [change] });
  const result = h.read('system/config');
  assert.equal(result.rewardItems.a.name, 'Changed by editor');
  assert.equal(result.rewardItems.a.releaseDate, change.releaseDate);
  assert.deepEqual(result.rewardItems.b, config.rewardItems.b);
  assert.deepEqual(result.rewardItems.c, config.rewardItems.c);
  assert.deepEqual(result.weekly, config.weekly);
  assert.equal(h.stats.reads, 1);
  assert.equal(h.stats.writes, 1);
});

test('conflicting calendar date rejects the whole save without overwriting either item', async () => {
  const h = calendar(), config = h.read('system/config');
  config.rewardItems.a.releaseDate = '2026-10-25'; h.put('system/config', config);
  await assert.rejects(h.context.saveRewardReleaseDates({ db: {}, changes: [change,
    { id: 'b', previousDate: '2026-10-21', releaseDate: '2026-10-24' }] }), /REWARD_CALENDAR_CONFLICT/);
  assert.deepEqual(h.read('system/config'), config);
  assert.equal(h.stats.writes, 0);
});

test('calendar retry after a lost reply does not write an already applied date again', async () => {
  const h = calendar();
  await h.context.saveRewardReleaseDates({ db: {}, changes: [change] });
  const writes = h.stats.writes;
  await h.context.saveRewardReleaseDates({ db: {}, changes: [change] });
  assert.equal(h.stats.writes, writes);
});

test('calendar transaction retry keeps an unrelated concurrent edit', async () => {
  const h = calendar();
  h.beforeCommit = () => {
    h.beforeCommit = null;
    const config = h.read('system/config'); config.rewardItems.b.name = 'Concurrent'; h.put('system/config', config);
  };
  await h.context.saveRewardReleaseDates({ db: {}, changes: [change] });
  assert.equal(h.read('system/config').rewardItems.b.name, 'Concurrent');
  assert.equal(h.stats.retries, 1);
  assert.equal(h.stats.writes, 1);
});

test('empty or invalid calendar changes do not access Firestore', async () => {
  const h = calendar();
  await h.context.saveRewardReleaseDates({ db: {}, changes: [] });
  for (const invalid of [{ ...change, id: 'a.bad' }, { ...change, releaseDate: '2026-02-30' }]) {
    await assert.rejects(h.context.saveRewardReleaseDates({ db: {}, changes: [invalid] }), /INVALID_CHANGE/);
  }
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.writes, 0);
});

test('calendar UI prevents duplicate Save and preserves unsaved changes after a conflict', async () => {
  let finish, calls = 0;
  const alerts = [];
  const state = { dirty: true, saving: false, syncing: false,
    items: [{ id: 'a', releaseDate: '2026-10-22' }], originalDates: new Map([['a', '2026-10-20']]) };
  const ui = { saveBtn: {}, syncBtn: {} };
  const context = vm.createContext({ state, ui, db: {}, alert: message => alerts.push(message),
    console: { error() {} },
    updateSaveButton: () => { ui.saveBtn.disabled = !state.dirty || state.saving || state.syncing; },
    saveRewardReleaseDates: () => { calls++; return new Promise((resolve, reject) => { finish = reject; }); },
  });
  vm.runInContext(section(read('rewardCalendar.html'), 'async function save()', 'createMonthCards();'), context);
  const first = context.save();
  await context.save();
  assert.equal(calls, 1);
  assert.equal(ui.syncBtn.disabled, true);
  finish(new Error('REWARD_CALENDAR_CONFLICT: a')); await first;
  assert.equal(state.dirty, true);
  assert.equal(state.originalDates.get('a'), '2026-10-20');
  assert.equal(ui.saveBtn.disabled, false);
  assert.equal(ui.syncBtn.disabled, false);
  assert.equal(alerts.length, 1);
});
