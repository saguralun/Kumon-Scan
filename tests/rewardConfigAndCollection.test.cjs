const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { createHarness, root } = require('./helpers/firestore.cjs');

const validReward = { id: 'bear', type: 'animal', name: 'Bear', icon: 'B', rarity: 'common', releaseDate: '2026-10-19' };

test('invalid rewards do not erase weekly settings or prevent valid rewards from loading', async () => {
  const weekly = { 1: { enabled: true, open: '12:00', close: '20:00' } };
  const h = createHarness({ 'system/config': { appVersion: '6.0.7', weekly, rarities: [{ id: 'common', weight: 1 }], rewardItems: {
    bear: validReward, broken: { ...validReward, name: '' }, other: { ...validReward, rarity: 'unknown' },
  } } }).load('checkin/reward/rewardConfigValidator.js', 'checkin/reward/rewardItems.js',
    'checkin/reward/rewardRarity.js', 'shared/versionControl.js');
  const result = await h.context.checkVersionAndReload({});
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.weekly)), weekly);
  assert.equal(result.rewardItems.length, 1);
  assert.equal(result.rewardItems[0].id, 'bear');
  assert.equal(h.stats.writes, 0);
});

test('reward editor validation rejects incomplete records and unsafe field path IDs locally', () => {
  const h = createHarness().load('checkin/reward/rewardConfigValidator.js');
  for (const field of ['name', 'icon', 'id', 'type', 'rarity']) {
    assert.throws(() => h.context.validateRewardItem({ ...validReward, [field]: '' }), /MISSING_/);
  }
  assert.throws(() => h.context.validateRewardItem({ ...validReward, id: 'bad.path' }), /INVALID_ITEM_ID/);
  h.context.validateRewardItem(validReward);
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.writes, 0);
});

const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('collection header, cards and modals escape stored HTML including attributes', () => {
  const malicious = '<img src=x onerror="alert(1)">';
  const nodes = new Map();
  const node = () => ({ className: '', innerHTML: '', innerText: '', classList: { add() {}, remove() {} } });
  const h = createHarness().load('shared/textUtils.js');
  h.context.$ = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  h.context.session = { studentId: malicious, profile: { nickname: malicious } };
  h.context.document = { createElement: node };
  h.context.getRarityBadge = () => malicious;
  h.context.openReleaseModal = () => {};

  const html = fs.readFileSync(path.join(root, 'collection.html'), 'utf8');
  vm.runInContext(section(html, 'function initStudentHeader()', 'window.goBackCheckin'), h.context);
  h.context.initStudentHeader();
  assert.ok(nodes.get('studentInfo').innerHTML.includes('&lt;img'));
  assert.equal(nodes.get('studentInfo').innerHTML.includes('<img'), false);

  const renderer = fs.readFileSync(path.join(root, 'collection/js/collectionRenderer.js'), 'utf8');
  vm.runInContext(section(renderer, 'function createUpcomingCard(', 'function updateProgress('), h.context);
  const item = { icon: malicious, name: malicious, releaseDate: malicious, rarity: '" onmouseover="alert(1)' };
  const card = h.context.createUpcomingCard(item);
  assert.equal(card.innerHTML.includes('<img'), false);
  const cardHtml = h.context.buildCardHTML(item, true, malicious);
  assert.equal(cardHtml.includes('class="rarity " onmouseover='), false);
  assert.equal(cardHtml.includes('<img'), false);

  h.load('collection/js/collectionModal.js');
  h.context.openModal(item, malicious);
  assert.equal(nodes.get('modalDetail').innerHTML.includes('<img'), false);
  h.context.openReleaseModal(item);
  assert.equal(nodes.get('modalDetail').innerHTML.includes('<img'), false);
});

test('schedule extra badges escape WS and AT details from saved records', () => {
  const h = createHarness().load('shared/textUtils.js');
  const source = fs.readFileSync(path.join(root, 'schedule.html'), 'utf8');
  vm.runInContext(section(source, 'function renderBadges(', 'function setThaiDateTitle('), h.context);
  const item = { extras: [{ type: 'WS', level: '<img src=x onerror=alert(1)>', ws: '1' }] };
  for (const mode of ['compact', 'detail']) {
    const html = h.context.renderBadges(item, mode);
    assert.equal(html.includes('<img'), false);
    assert.ok(html.includes('&lt;img'));
  }
});
