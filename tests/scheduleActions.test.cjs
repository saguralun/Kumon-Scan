const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../schedule.html'), 'utf8');

function setup() {
  const nodes = new Map();
  const notices = [];
  const context = vm.createContext({
    $: id => {
      if (!nodes.has(id)) nodes.set(id, { style: {}, disabled: false });
      return nodes.get(id);
    },
    console: { error() {} }, showToast: (...args) => notices.push(args), hideMenu() {},
  });
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  vm.runInContext('let scheduleActionBusy = false; let scheduleFromCache = false;\n' +
    section('function showConfirm(', 'function showAddWSModal(') +
    section('function handleActionWithConfirm(', 'function updateTotalCounts('), context);
  return { context, nodes, notices };
}

test('schedule confirmation waits for its save and ignores double taps', async () => {
  const h = setup(); let finish, calls = 0;
  h.context.handleActionWithConfirm({ title: 'Confirm', desc: 'Save', action: () => {
    calls++; return new Promise(resolve => { finish = resolve; });
  } });
  const click = h.nodes.get('confirmBtn').onclick;
  const task = click();
  await click();
  assert.equal(calls, 1);
  assert.equal(h.nodes.get('confirmBtn').disabled, true);
  assert.equal(h.nodes.get('confirmModal').style.display, 'flex');
  assert.match(h.nodes.get('scheduleDataStatus').textContent, /บันทึก/);
  finish(); await task;
  assert.equal(h.nodes.get('confirmModal').style.display, 'none');
  assert.equal(h.nodes.get('confirmBtn').disabled, false);
  assert.match(h.nodes.get('scheduleDataStatus').textContent, /server/);
});

test('failed schedule save keeps confirmation open and unlocks retry', async () => {
  const h = setup(); let fail = true;
  h.context.showConfirm({ title: 'Confirm', desc: 'Save', onConfirm: async () => {
    if (fail) throw new Error('network');
  } });
  await h.nodes.get('confirmBtn').onclick();
  assert.equal(h.nodes.get('confirmModal').style.display, 'flex');
  assert.equal(h.nodes.get('confirmBtn').disabled, false);
  assert.equal(h.notices.length, 1);
  fail = false;
  await h.nodes.get('confirmBtn').onclick();
  assert.equal(h.nodes.get('confirmModal').style.display, 'none');
});
