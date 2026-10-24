const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { createHarness, student, root } = require('./helpers/firestore.cjs');
const { installCheckinQueue } = require('./helpers/checkinQueue.cjs');

function setup(status = 'pending') {
  const h = createHarness().load('checkin/ui/checkinJobStatus.js');
  h.job = { id: 's_today', requestId: 'request-1', status };
  h.messages = [];
  h.presenter = h.context.createCheckinJobStatus({
    getJob: id => h.job?.id === id ? h.job : null,
    showStatus: (text, color) => h.messages.push({ text, color }),
  });
  return h;
}

test('pending uses the agreed message and repeated queue updates do not announce it again', () => {
  const h = setup();
  h.presenter.watch(h.job);
  assert.equal(h.messages[0].text, 'รับรายการเช็กอินแล้ว กำลังรอยืนยันจากระบบ<br>นักเรียนคนถัดไปเช็กอินต่อได้ทันที ไม่ต้องกรอกรหัสซ้ำ<br>กรุณาเปิดหน้านี้ไว้ รายการจะหายจากคิวเมื่อยืนยันสำเร็จ');
  const before = JSON.stringify(h.job);
  h.presenter.refresh(); h.presenter.refresh();
  assert.equal(h.messages.length, 1);
  assert.equal(JSON.stringify(h.job), before);
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.writes, 0);
});

test('late success replaces pending text and safely describes the already saved reward', () => {
  const h = setup(); h.presenter.watch(h.job);
  h.job.status = 'done';
  h.job.result = { reward: { name: '<img src=x onerror=alert(1)>' } };
  h.presenter.refresh();
  assert.match(h.messages.at(-1).text, /ยืนยันการเช็กอินสำเร็จแล้ว/);
  assert.match(h.messages.at(-1).text, /&lt;img/);
  assert.doesNotMatch(h.messages.at(-1).text, /<img/);
  assert.match(h.messages.at(-1).text, /ไม่เช็กอินหรือสุ่มรางวัลซ้ำ/);
  assert.equal(h.messages.at(-1).color, '#267744');
  assert.equal(h.stats.reads + h.stats.writes, 0);
});

test('a confirmed existing attendance does not claim a reward when no reward receipt is present', () => {
  const h = setup('done'); h.job.result = { status: 'active', reward: null };
  h.presenter.watch(h.job);
  assert.match(h.messages[0].text, /เปิดดู Collection/);
  assert.doesNotMatch(h.messages[0].text, /บันทึกรางวัล/);
});

test('failed, retrying and successful states follow the local job without submitting anything', () => {
  const h = setup(); h.presenter.watch(h.job);
  for (const status of ['failed', 'pending', 'done']) {
    h.job.status = status; h.presenter.refresh();
  }
  assert.match(h.messages[1].text, /กดปุ่มลองใหม่/);
  assert.match(h.messages[2].text, /กำลังรอยืนยัน/);
  assert.match(h.messages[3].text, /สำเร็จแล้ว/);
  assert.equal(h.stats.reads + h.stats.writes, 0);
});

test('another child taking over the status area prevents late results from replacing their screen', () => {
  const h = setup(); h.presenter.watch(h.job); h.presenter.clear();
  for (const status of ['failed', 'pending', 'done']) {
    h.job.status = status; h.presenter.refresh();
  }
  assert.equal(h.messages.length, 1);
});

test('a different request for the same ID or a removed receipt cannot replace the current message', () => {
  for (const replace of [h => { h.job = { ...h.job, requestId: 'request-2', status: 'done' }; }, h => { h.job = null; }]) {
    const h = setup(); h.presenter.watch(h.job); replace(h); h.presenter.refresh();
    assert.equal(h.messages.length, 1);
  }
});

test('keypad typing and backspace release the previous job status ownership', () => {
  const h = setup();
  const source = fs.readFileSync(path.join(root, 'checkin/js/checkin.js'), 'utf8');
  Object.assign(h.context, { checkinJobStatus: h.presenter, currentInput: '', MAX_LENGTH: 5,
    reloadIfDateChanged: () => false, updateDisplay() {}, statusUI: { showStatus() {} },
  });
  vm.runInContext(source.slice(source.indexOf('window.press = function'), source.indexOf('function validateInput()')), h.context);
  for (const action of [() => h.context.window.press(1), () => h.context.window.backspace()]) {
    h.presenter.watch(h.job); action(); h.job.status = 'done'; h.presenter.refresh();
  }
  assert.equal(h.messages.length, 2);
});

test('showing real queued status leaves check-in reads, writes and the single reward unchanged', async () => {
  const runs = [];
  for (const show of [false, true]) {
    const h = createHarness({ 'students/s': student() }).load('shared/dateUtils.js', 'shared/readDeadline.js',
      'shared/studentService.js', 'shared/scheduleService.js', 'shared/attendanceService.js');
    h.context.ensureCheckinStartup = async () => {};
    const messages = [];
    h.context.statusUI = { showStatus: text => messages.push(text) };
    const queue = installCheckinQueue(h);
    try {
      const accepted = queue.submit({ studentId: 's', studentData: h.read('students/s'), today: '20261019', requestedAt: new Date(2026, 9, 19, 17, 35) });
      if (show) h.context.checkinJobStatus.watch(accepted.job);
      queue.resume(); await accepted.promise;
      assert.equal(h.read('students/s').inventory.test, 1);
      assert.equal(h.read('attendance/s_20261019').rewardState, 'granted');
      if (show) assert.match(messages.at(-1), /ยืนยันการเช็กอินสำเร็จแล้ว/);
      runs.push({ ...h.stats });
    } finally { queue.dispose(); }
  }
  assert.deepEqual(runs[0], runs[1]);
});

test('only queued status expands the message area and ordinary status resets its layout', () => {
  const h = createHarness();
  const classes = new Set();
  const node = { style: {}, classList: { toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key) } };
  h.context.$ = () => node;
  h.load('checkin/ui/statusUI.js');
  h.context.showStatus('Pending', '#946200', { expanded: true });
  assert.equal(classes.has('checkin-job-status'), true);
  h.context.showStatus('Next student');
  assert.equal(classes.has('checkin-job-status'), false);
  assert.equal(node.innerHTML, 'Next student');
});

test('real queue failure and retry update the message without an extra check-in or reward', async () => {
  const h = createHarness({ 'students/s': student() }).load('shared/dateUtils.js', 'shared/readDeadline.js',
    'shared/studentService.js', 'shared/scheduleService.js', 'shared/attendanceService.js');
  h.context.ensureCheckinStartup = async () => {};
  const messages = [];
  h.context.statusUI = { showStatus: text => messages.push(text) };
  const queue = installCheckinQueue(h);
  try {
    h.beforeCommit = () => {
      h.beforeCommit = null;
      throw Object.assign(new Error('simulated permission failure'), { code: 'permission-denied' });
    };
    const accepted = queue.submit({ studentId: 's', studentData: h.read('students/s'), today: '20261019', requestedAt: new Date(2026, 9, 19, 17, 35) });
    h.context.checkinJobStatus.watch(accepted.job);
    queue.resume();
    await assert.rejects(accepted.promise, /simulated permission failure/);
    assert.match(messages.at(-1), /กดปุ่มลองใหม่/);
    assert.equal(h.stats.writes, 0);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    queue.retry(accepted.job.id);
    assert.match(messages.at(-1), /กำลังรอยืนยัน/);
    await queue.wait(accepted.job.id);
    assert.match(messages.at(-1), /ยืนยันการเช็กอินสำเร็จแล้ว/);
    assert.equal(h.read('students/s').inventory.test, 1);
    assert.equal(h.read('attendance/s_20261019').rewardState, 'granted');
  } finally { queue.dispose(); }
});
