const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const root = path.join(__dirname, '../..');
const clone = value => {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return Array.from(value, clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
};
const get = (value, field) => field.split('.').reduce((v, k) => v?.[k], value);
function assign(target, field, value) {
  const keys = field.split('.');
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  if (value?.__delete) delete target[keys.at(-1)];
  else target[keys.at(-1)] = clone(value);
}
function merge(target, value) {
  for (const [key, entry] of Object.entries(value)) {
    if (entry?.__delete) delete target[key];
    else if (entry && typeof entry === 'object' && !Array.isArray(entry) && !entry.toDate) {
      target[key] ??= {};
      merge(target[key], entry);
    } else target[key] = clone(entry);
  }
  return target;
}

function createHarness(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, clone(v)]));
  const versions = new Map();
  const stats = { reads: 0, writes: 0, queries: 0, retries: 0 };
  const logs = [];
  const harness = {
    stats, logs, beforeCommit: null, afterCommit: null,
    read: key => clone(data.get(key)),
    put(key, value) { data.set(key, clone(value)); versions.set(key, (versions.get(key) || 0) + 1); },
  };
  const snapshot = ref => ({
    id: ref.split('/').at(-1), ref, exists: () => data.has(ref), data: () => clone(data.get(ref)),
  });
  const getDoc = async ref => { stats.reads++; return snapshot(ref); };
  const cache = new Map();
  const local = new Map();
  const localStorage = { getItem: k => local.get(k) ?? null, setItem: (k, v) => local.set(k, v),
    removeItem: k => local.delete(k), key: i => [...local.keys()][i] ?? null,
    get length() { return local.size; },
  };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {}, time() {}, timeEnd() {} },
    setTimeout, clearTimeout, queueMicrotask, structuredClone: clone, crypto: { randomUUID }, localStorage,
    navigator: { onLine: true },
    window: { TEST_DATE: new Date(2026, 9, 19, 17, 35).toISOString(), addEventListener() {}, removeEventListener() {} },
    sessionStorage: { getItem: k => cache.get(k) || null, setItem: (k, v) => cache.set(k, v), removeItem: k => cache.delete(k) },
    db: {},
    connection: { runRead: read => read(), beginWrite: async () => () => {} },
    checkinJobs: { resume() {} },
    stopRandomAnimation() {},
    Timestamp: { fromDate: date => ({ toDate: () => new Date(date) }) },
    doc: (db, ...parts) => parts.join('/'), collection: (db, ...parts) => parts.join('/'),
    query: (ref, ...constraints) => ({ ref, constraints }),
    where: (field, op, value) => ({ field, op, value }),
    limit: count => ({ limit: count }),
    getDoc,
    getDocFromServer: getDoc,
    getDocs: async query => {
      stats.queries++;
      const ref = typeof query === 'string' ? query : query.ref;
      const docs = [...data.keys()].filter(key => key.startsWith(ref + '/') &&
        key.slice(ref.length + 1).indexOf('/') === -1).filter(key =>
        (query.constraints || []).every(c => c.limit !== undefined || (c.op === '==' ? get(data.get(key), c.field) === c.value : get(data.get(key), c.field) >= c.value))
      ).slice(0, query.constraints?.find(c => c.limit !== undefined)?.limit ?? Infinity).map(snapshot);
      stats.reads += docs.length;
      return { docs, size: docs.length, empty: docs.length === 0, forEach: fn => docs.forEach(fn) };
    },
    serverTimestamp: () => ({ toDate: () => new Date(2026, 9, 19, 17, 35) }),
    deleteField: () => ({ __delete: true }),
    debugLog() {}, measure: () => ({ end() {} }),
    logError: async (db, entry) => logs.push(entry),
    progressUI: { updateProgress() {}, updateBuildProgress() {} },
    audio: { triggerFeedback() {} },
    $: () => null, qs: () => null,
    runTransaction: async (db, action) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const reads = new Map();
        const writes = [];
        const result = await action({
          get: async ref => {
            if (writes.length) throw new Error('Transaction read after write');
            reads.set(ref, versions.get(ref) || 0);
            return getDoc(ref);
          },
          set: (ref, value, options) => writes.push({ kind: 'set', ref, value, options }),
          update: (ref, value) => writes.push({ kind: 'update', ref, value }),
        });
        if (harness.beforeCommit) await harness.beforeCommit(writes);
        if ([...reads].some(([key, version]) => (versions.get(key) || 0) !== version)) {
          stats.retries++;
          continue;
        }
        for (const write of writes) {
          if (write.kind === 'update' && !data.has(write.ref)) throw new Error('Missing document ' + write.ref);
        }
        for (const write of writes) {
          const target = clone(data.get(write.ref) || {});
          if (write.kind === 'update') {
            for (const [field, value] of Object.entries(write.value)) assign(target, field, value);
            harness.put(write.ref, target);
          } else harness.put(write.ref, write.options?.merge ? merge(target, write.value) : write.value);
          stats.writes++;
        }
        if (harness.afterCommit) await harness.afterCommit(writes);
        return result;
      }
      throw new Error('Transaction retry limit');
    },
  });
  harness.context = context;
  harness.load = (...files) => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), 'utf8')
        .replace(/^import\s+[\s\S]*?from\s+"[^"]+";/gm, '')
        .replace(/^export \*[^\n]*\n/gm, '').replace(/^export /gm, '');
      vm.runInContext(source, context, { filename: file });
    }
    return harness;
  };
  harness.load('shared/textUtils.js');
  return harness;
}

function student(strength = 5) {
  return {
    active: true, subject: 'ME', nickname: 'Student', firstName: 'First', lastName: 'Last',
    weeklyPlans: { 1: { timeSlot: '17:30', timeAverage: '17:30', planStrength: strength, missStreak: 0, totalSessions: 1 } },
  };
}

module.exports = { createHarness, student, root, clone };
