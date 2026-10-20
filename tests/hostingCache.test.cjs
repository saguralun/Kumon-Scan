const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('all application HTML, JS and CSS revalidate without disabling caching of images', () => {
  const config = JSON.parse(read('firebase.json'));
  const rule = config.hosting.headers.find(rule => rule.regex);
  assert.ok(rule);
  const pattern = new RegExp(rule.regex);
  for (const file of ['/checkin.html', '/result.html', '/schedule.html', '/collection.html',
    '/shared/versionControl.js', '/checkin/js/checkin.js', '/checkin/modules/clock.js',
    '/checkin/css/checkin.css', '/collection/js/collectionRenderer.js', '/collection/css/collection.css']) {
    assert.ok(pattern.test(file), file);
  }
  assert.equal(pattern.test('/icons/icon-checkin-192.png'), false);
  assert.equal(rule.headers.find(h => h.key === 'Cache-Control').value, 'no-cache, max-age=0, must-revalidate');
});

test('Check-in entry script and stylesheet carry the current release version', () => {
  const version = read('shared/versionControl.js').match(/export const APP_VERSION = "([^"]+)";/)[1];
  const html = read('checkin.html');
  assert.ok(html.includes(`./checkin/js/checkin.js?v=${version}`));
  assert.ok(html.includes(`./checkin/css/checkin.css?v=${version}`));
});
