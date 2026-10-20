const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { createHarness, root } = require('./helpers/firestore.cjs');
const source = fs.readFileSync(path.join(root, 'checkin/js/checkin.js'), 'utf8');

function setup(jobs) {
  const h = createHarness();
  const node = () => ({
    children: [], listeners: {}, hidden: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this[key] = value; },
    addEventListener(type, callback) { this.listeners[type] = callback; },
  });
  h.container = node();
  h.jobs = jobs;
  h.retried = [];
  h.context.$ = () => h.container;
  h.context.document = { createElement: node };
  h.context.checkinJobs = {
    list: () => h.jobs,
    retry: id => h.retried.push(id),
    acknowledge() { throw new Error('Rendering must not delete completion receipts'); },
  };
  vm.runInContext(source.slice(source.indexOf('function renderCheckinJobs()')), h.context);
  h.render = () => h.context.renderCheckinJobs();
  return h;
}
const job = (id, status) => ({ id, status, nickname: id, subject: 'ME', result: { status: 'active' } });

test('only pending and failed jobs appear without changing receipts or touching Firestore', () => {
  const jobs = [job('waiting', 'pending'), job('saved', 'done'), job('error', 'failed')];
  const before = JSON.stringify(jobs);
  const h = setup(jobs);
  h.render();
  assert.equal(h.container.hidden, false);
  assert.deepEqual(h.container.children.map(row => row.className), ['checkin-job pending', 'checkin-job failed']);
  assert.equal(h.container.children[0].children.length, 1);
  const retry = h.container.children[1].children[1];
  assert.equal(retry.textContent, 'ลองใหม่');
  retry.listeners.click();
  assert.deepEqual(h.retried, ['error']);
  assert.equal(JSON.stringify(jobs), before);
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.writes, 0);
});

test('a completed queue stays hidden, including receipts restored after reload', () => {
  const h = setup([job('saved', 'done')]);
  h.render();
  assert.equal(h.container.hidden, true);
  assert.equal(h.container.children.length, 0);
  assert.equal(h.jobs[0].status, 'done');
  h.render();
  assert.equal(h.jobs.length, 1);
  assert.equal(h.container.children.length, 0);
});

test('a pending row disappears as soon as its local status becomes done', () => {
  const h = setup([job('waiting', 'pending')]);
  h.render();
  assert.equal(h.container.children.length, 1);
  h.jobs[0].status = 'done';
  h.render();
  assert.equal(h.container.hidden, true);
  assert.equal(h.container.children.length, 0);
  assert.equal(h.jobs[0].result.status, 'active');
});

test('success removes only its own row while another pending or failed job remains visible', () => {
  const h = setup([job('first', 'pending'), job('second', 'failed')]);
  h.render();
  h.jobs[0].status = 'done';
  h.render();
  assert.equal(h.container.hidden, false);
  assert.equal(h.container.children.length, 1);
  assert.equal(h.container.children[0].children[0].children[0].textContent, 'second (ME)');
});

test('retrying an error keeps the pending row and removes the retry button until it completes', () => {
  const h = setup([job('retry', 'failed')]);
  h.render();
  h.jobs[0].status = 'pending';
  h.render();
  assert.equal(h.container.children[0].className, 'checkin-job pending');
  assert.equal(h.container.children[0].children.length, 1);
  h.jobs[0].status = 'done';
  h.render();
  assert.equal(h.container.hidden, true);
});
