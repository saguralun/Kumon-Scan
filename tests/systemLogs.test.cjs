const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../shared/logService.js'), 'utf8')
  .replace(/^import\s+[\s\S]*?from\s+"[^"]+";/gm, '')
  .replace(/^export /gm, '');

function createLogger() {
  const writes = [];
  let now = 0;
  let fail = false;
  const context = vm.createContext({
    window: {}, navigator: { userAgent: 'test-device' },
    console: { error() {} }, Date: { now: () => now },
    collection: (db, name) => name,
    serverTimestamp: () => 'server-time',
    addDoc: async (ref, payload) => {
      if (fail) throw new Error('write failed');
      writes.push({ ref, payload });
    },
  });
  vm.runInContext(source, context);
  return {
    writes, log: details => context.logError({}, details),
    advance: amount => { now += amount; },
    fail: value => { fail = value; },
  };
}

const details = () => ({
  tag: 'CHECKOUT', message: 'checkout failed',
  error: new Error('CHECKIN_DATA_INVALID : checkedInData'),
  extra: { attendanceId: '1091_20261002', studentId: '1091', subject: 'EFL', slotKey: '17:30' },
});

test('one checkout error propagating through three catches writes only once', async () => {
  const logger = createLogger();
  const entry = details();
  await Promise.all([
    logger.log({ ...entry, tag: 'CHECKIN_DATA_CORRUPTED' }),
    logger.log({ ...entry, tag: 'completeAttendanceAndSchedule', extra: {} }),
    logger.log(entry),
  ]);
  assert.equal(logger.writes.length, 1);
  assert.equal(logger.writes[0].payload.errorMessage, entry.error.message);
  assert.ok(logger.writes[0].payload.stack);
});

test('fresh errors for the same student are suppressed for ten minutes', async () => {
  const logger = createLogger();
  await logger.log(details());
  logger.advance(9 * 60 * 1000);
  await logger.log(details());
  assert.equal(logger.writes.length, 1);
  logger.advance(60 * 1000);
  await logger.log(details());
  assert.equal(logger.writes.length, 2);
});

test('another student and a different failure are still recorded', async () => {
  const logger = createLogger();
  await logger.log(details());
  await logger.log({ ...details(), extra: { studentId: '1092', attendanceId: '1092_20261002' } });
  await logger.log({ ...details(), error: new Error('INVALID_REWARD') });
  assert.equal(logger.writes.length, 3);
});

test('temporary network errors, expected duplicate actions, and count warnings do not write', async () => {
  const logger = createLogger();
  for (const code of ['unavailable', 'firestore/deadline-exceeded', 'aborted', 'cancelled', 'network-request-failed']) {
    await logger.log({ ...details(), error: Object.assign(new Error('network'), { code }) });
  }
  for (const message of ['already-completed', 'ATTENDANCE_ALREADY_EXISTS', 'DAILY_SCHEDULE_EXISTS_ABORT_BUILD']) {
    await logger.log({ ...details(), error: new Error(message) });
  }
  await logger.log({ tag: 'ensureDailyScheduleBuilt', message: 'SCHEDULE_COUNT_MISMATCH' });
  assert.equal(logger.writes.length, 0);
});

test('permission, quota, and internal errors remain visible in systemLogs', async () => {
  const logger = createLogger();
  for (const code of ['permission-denied', 'resource-exhausted', 'internal']) {
    await logger.log({ ...details(), error: Object.assign(new Error(code), { code }) });
  }
  assert.equal(logger.writes.length, 3);
});

test('a failed log write does not prevent a later attempt from reporting the error', async () => {
  const logger = createLogger();
  const entry = details();
  logger.fail(true);
  await logger.log(entry);
  logger.fail(false);
  await logger.log(entry);
  assert.equal(logger.writes.length, 1);
});
