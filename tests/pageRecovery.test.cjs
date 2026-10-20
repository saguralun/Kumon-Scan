const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function resultUI() {
  const source = read('result.html'), nodes = new Map(), requests = [], listeners = [], buttons = [];
  const h = { today: '20261019', requests, listeners, writes: 0, unsubscriptions: 0 };
  for (const tab of ['active', 'completed']) {
    const button = { dataset: { tab }, selected: tab === 'active' };
    button.classList = { toggle: (key, value) => { button.selected = value; } }; buttons.push(button);
  }
  const context = vm.createContext({
    db: {}, console: { error() {} },
    $: id => { if (!nodes.has(id)) nodes.set(id, { style: {}, querySelector: () => ({}) }); return nodes.get(id); },
    document: { querySelectorAll: () => buttons },
    getTodayThai: () => h.today,
    collection: (db, ...parts) => parts.join('/'), query: (ref, ...constraints) => ({ ref, constraints }),
    where: (field, op, value) => ({ field, op, value }), orderBy: field => ({ order: field }),
    getDocs: query => { const pending = deferred(); requests.push({ query, ...pending }); return pending.promise; },
    onSnapshot: (query, options, next, error) => { listeners.push({ query, next, error }); return () => { h.unsubscriptions++; }; },
    renderAll() {}, renderQueue() {}, rebuildCheckinQueue() {}, updateToggleSlider() {},
    window: {}, checkoutState: { loading: new Set(), pending: new Set() },
    addPendingCheckout() { h.writes++; }, processCheckout() { h.writes++; },
  });
  vm.runInContext('let currentDate="20261019", currentTab="active", activeDataAll=[], completedData=[], listenerInitialized=false;\n' +
    'let completedRequestVersion=0, completedLoading=false, completedError=false, activeListenerVersion=0, activeListenerFailed=false, unsubscribeListener=null;\n' +
    'const activityState={checkinQueue:[],checkoutQueue:[]};\n' +
    section(source, 'async function loadCompleted()', 'function updateToggleSlider(') +
    section(source, 'async function switchTab(tab)', 'window.checkout =') +
    section(source, 'window.checkout =', 'window.retryCheckout =') +
    section(source, 'function startListener()', 'function renderAll()') +
    section(source, 'function ensureResultDate()', 'document.addEventListener(') +
    '\nglobalThis.peek=()=>({currentDate,currentTab,completedData,completedError,completedLoading,activeDataAll});', context);
  h.context = context; h.buttons = buttons;
  return h;
}
const snapshot = id => ({ docs: [{ id, data: () => ({ status: 'completed' }) }] });

test('Completed failure is visible and reselecting its tab really retries', async () => {
  const h = resultUI(), first = h.context.switchTab('completed');
  h.requests[0].reject(new Error('offline')); await first;
  assert.equal(h.context.peek().completedError, true);
  assert.equal(h.context.peek().completedLoading, false);
  const retry = h.context.switchTab('completed');
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(snapshot('recovered')); await retry;
  assert.equal(h.context.peek().completedError, false);
  assert.equal(h.context.peek().completedData[0].id, 'recovered');
});

test('a slow Completed request cannot change a later Active selection', async () => {
  const h = resultUI(), pending = h.context.switchTab('completed');
  await h.context.switchTab('active');
  h.requests[0].resolve(snapshot('old')); await pending;
  assert.equal(h.context.peek().currentTab, 'active');
  assert.equal(h.buttons.find(b => b.dataset.tab === 'active').selected, true);
  assert.equal(h.context.peek().completedData.length, 0);
});

test('overlapping Completed requests only accept the newest result', async () => {
  const h = resultUI(), old = h.context.switchTab('completed');
  await h.context.switchTab('active');
  const current = h.context.switchTab('completed');
  h.requests[1].resolve(snapshot('latest')); await current;
  h.requests[0].resolve(snapshot('stale')); await old;
  assert.equal(h.context.peek().completedData[0].id, 'latest');
});

test('Result day rollover replaces its listener once and rejects yesterday snapshots and clicks', async () => {
  const h = resultUI(); h.context.startListener();
  vm.runInContext('activeDataAll=[{id:"yesterday"}];', h.context);
  h.today = '20261020';
  await h.context.window.checkout('yesterday');
  assert.equal(h.writes, 0);
  assert.equal(h.listeners.length, 2);
  assert.equal(h.unsubscriptions, 1);
  assert.equal(h.listeners[1].query.constraints.find(c => c.field === 'date').value, '20261020');
  h.listeners[0].next({});
  assert.equal(h.context.peek().activeDataAll.length, 0);
  for (let i = 0; i < 5; i++) assert.equal(h.context.ensureResultDate(), false);
  assert.equal(h.listeners.length, 2);
});

test('Completed day rollover invalidates the old read and loads the new date once', async () => {
  const h = resultUI(), old = h.context.switchTab('completed');
  h.today = '20261020'; assert.equal(h.context.ensureResultDate(), true);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].query.constraints.find(c => c.field === 'date').value, h.today);
  h.requests[1].resolve(snapshot('today')); await Promise.resolve(); await Promise.resolve();
  h.requests[0].resolve(snapshot('yesterday')); await old;
  assert.equal(h.context.peek().completedData[0].id, 'today');
  assert.equal(h.context.ensureResultDate(), false);
  assert.equal(h.requests.length, 2);
});

test('Active listener failure stops claiming latest server data and allows a manual retry', async () => {
  const h = resultUI(); h.context.startListener();
  h.listeners[0].error(new Error('permission'));
  await h.context.switchTab('active');
  assert.equal(h.listeners.length, 2);
});

function scheduleUI() {
  const source = read('schedule.html'), nodes = new Map(), listeners = [];
  const h = { today: '20261019', listeners, unsubscriptions: 0, actions: 0 };
  const node = id => { if (!nodes.has(id)) nodes.set(id, { style: {} }); return nodes.get(id); };
  const context = vm.createContext({
    db: {}, console: { error() {} }, $: node,
    getTodayThai: () => h.today, query: (ref, ...constraints) => ({ ref, constraints }),
    collection: (db, ...parts) => parts.join('/'), orderBy: field => ({ field }),
    onSnapshot: (query, options, next, error) => { listeners.push({ query, next, error }); return () => { h.unsubscriptions++; }; },
    renderSkeleton() {}, renderSchedule() {}, highlightCurrentSlot() {}, updateTotalCounts() {},
    detectScheduleChanges() {}, hideMenu() {}, setThaiDateTitle() {}, showToast() {}, updateScheduleDataStatus() {},
    searchInput: node('search'), searchCount: node('searchCount'),
  });
  vm.runInContext('let scheduleDate="20261019",scheduleUnsubscribe=null,scheduleListenerVersion=0,currentSlots={},firstLoad=true,scheduleFromCache=true,searchResults=[],currentSearchIndex=-1,scheduleActionBusy=false;\n' +
    section(source, 'function loadSchedule()', 'function showVersionUpdate(') +
    section(source, 'async function runScheduleAction(', 'function updateTotalCounts(') +
    '\nglobalThis.slots=()=>currentSlots;', context);
  h.context = context;
  return h;
}

test('Schedule blocks a stale confirmation and subscribes to the new day without a write', async () => {
  const h = scheduleUI(); h.context.loadSchedule();
  h.today = '20261020';
  await h.context.runScheduleAction(async () => { h.actions++; });
  assert.equal(h.actions, 0);
  assert.equal(h.listeners.length, 2);
  assert.equal(h.listeners[1].query.ref, 'dailySchedule/20261020/slots');
  assert.equal(h.unsubscriptions, 1);
  h.listeners[0].next({});
  assert.equal(Object.keys(h.context.slots()).length, 0);
  for (let i = 0; i < 5; i++) assert.equal(h.context.ensureScheduleDate(), false);
  assert.equal(h.listeners.length, 2);
});

test('Schedule same-day actions do not add a new listener or config read', async () => {
  const h = scheduleUI(); h.context.loadSchedule();
  await h.context.runScheduleAction(async () => { h.actions++; });
  assert.equal(h.actions, 1);
  assert.equal(h.listeners.length, 1);
});
