const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('C:/Users/AkiraLun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { mock } = require('./browser-outbox.cjs');
const base = 'http://127.0.0.1:5173';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Bangkok' });
    const blocked = [], errors = [];
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(base + '/')) return route.continue();
      if (url.includes('firebase-firestore.js')) return route.fulfill({ contentType: 'text/javascript', body: mock });
      if (url.includes('firebase-app.js')) return route.fulfill({ contentType: 'text/javascript', body: 'export const initializeApp = () => ({});' });
      if (url.includes('canvas-confetti')) return route.fulfill({ contentType: 'text/javascript', body: 'export default function confetti(){}' });
      blocked.push(url);
      return route.abort();
    });
    await context.addInitScript(() => {
      window.TEST_DATE = '2026-10-19T14:05:00+07:00';
      window.__minuteCallbacks = [];
      const interval = window.setInterval.bind(window);
      window.setInterval = (callback, delay, ...args) => {
        if (delay === 60000) window.__minuteCallbacks.push(callback);
        return interval(callback, delay, ...args);
      };
      const extras = [{ type: 'AT', level: 'A' }, { type: 'WS', level: 'B', ws: '1-10' }];
      const student = (nickname, firstName, lastName) => ({ nickname, firstName, lastName, time: '14:00', extras });
      const slots = {
        '14:00': { subjects: {
          ME: { checkedIn: { '101': student('Preview Very Long Nickname', 'FirstAlpha', 'LastAlpha') },
            completed: { '102': student('Same', 'FirstBeta', 'LastBeta') },
            planned: { '103': student('Same', 'FirstGamma', 'LastGamma') },
            takeHome: { '104': student('Home', '', '') }, unplanned: { '105': student('Unplanned', '', '') } },
          EFL: { checkedIn: { '201': student('English', 'FirstAlpha', 'LastAlpha') } },
        } },
        '14:30': { subjects: { ME: { planned: { '106': student('Later', 'FirstDelta', 'LastDelta'),
          '107': student('<img src=x onerror=alert(1)>', 'SafeName', 'SafeLast') } } } },
      };
      const db = { 'system/config': { appVersion: '6.0.10' } };
      for (const [key, value] of Object.entries(slots)) db['dailySchedule/20261019/slots/' + key] = value;
      localStorage.setItem('__test-db', JSON.stringify(db));
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { errors.push('Unexpected dialog: ' + dialog.message()); await dialog.dismiss(); });
    await page.goto(base + '/schedule.html');
    await page.locator('#scheduleDataStatus').filter({ hasText: 'server' }).waitFor();
    const initialOps = await page.evaluate(() => ({ ...window.__firestoreOps }));
    const initialDb = await page.evaluate(() => localStorage.getItem('__test-db'));
    assert.deepEqual(initialOps, { reads: 1, listens: 1, writes: 0 });
    const mobile = page.locator('#mobileSchedule'), desktop = page.locator('#desktopSchedule');
    assert.equal(await mobile.isVisible(), true);
    assert.equal(await desktop.isVisible(), false);
    assert.equal(await mobile.locator('.student-wrapper').count(), 7);
    assert.equal(await mobile.locator('.student-wrapper img').count(), 0);

    const search = async (keyword, count = 1) => {
      await page.locator('#studentSearch').fill(keyword);
      await page.waitForTimeout(200);
      await page.waitForFunction(count => document.querySelector('#searchCount').textContent.trim() === (count ? `1 / ${count}` : '0 / 0'), count).catch(async error => {
        console.error(await page.locator('#searchCount').innerText(), await mobile.locator('.search-hit').allTextContents());
        throw error;
      });
      const root = await desktop.isVisible() ? desktop : mobile;
      assert.equal(await root.locator('.search-hit').count(), count);
    };
    for (const word of ['Long Nickname', 'FirstAlpha', 'LastAlpha', 'FirstAlpha LastAlpha', '101', 'SafeName']) await search(word);
    await search('not-a-student', 0);
    assert.equal(await mobile.locator('.mobile-slot:visible').count(), 0);
    await search('same', 2);
    await page.locator('#searchNext').click();
    assert.equal((await page.locator('#searchCount').innerText()).trim(), '2 / 2');
    await page.locator('#searchPrev').click();
    assert.equal((await page.locator('#searchCount').innerText()).trim(), '1 / 2');
    await search('FirstAlpha');

    // Existing snapshots rebuild the DOM without losing the active query.
    await page.evaluate(() => window.__notifyMock());
    await page.waitForFunction(() => document.querySelector('#mobileSchedule .search-hit .tooltip-id')?.textContent.trim() === '101');
    await mobile.locator('.mobile-tab').nth(1).click();
    assert.equal(await mobile.locator('.search-hit').count(), 1);
    assert.match(await mobile.locator('.search-hit .tooltip-id').innerText(), /201/);

    for (const width of [1280, 768, 769, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(isMobile => getComputedStyle(document.querySelector('#mobileSchedule')).display === (isMobile ? 'block' : 'none'), width <= 768);
      assert.equal(await desktop.isVisible(), width > 768);
      assert.equal(await page.locator('#studentSearch').inputValue(), 'FirstAlpha');
      assert.equal((await page.locator('#searchCount').innerText()).trim(), width > 768 ? '1 / 2' : '1 / 1');
      if (width <= 768) assert.match(await mobile.locator('.mobile-tab.active').innerText(), /EFL/);
    }
    await page.locator('#searchClear').click();
    await mobile.locator('.mobile-tab').nth(0).click();
    assert.equal(await mobile.locator('.student-wrapper').count(), 7);
    assert.equal(await mobile.locator('.mobile-slot:visible').count(), 2);

    // Keyboard-sized viewport changes must not rebuild the list.
    await mobile.locator('.student-wrapper').first().evaluate(el => { el.dataset.stabilityMarker = 'kept'; });
    await page.setViewportSize({ width: 360, height: 540 });
    await page.waitForTimeout(200);
    assert.equal(await mobile.locator('[data-stability-marker="kept"]').count(), 1);
    const assertNow = async slot => {
      assert.equal(await mobile.locator('.slot-now').count(), slot ? 1 : 0);
      if (slot) assert.equal(await mobile.locator('.current-slot').getAttribute('data-slot'), slot);
      else assert.equal(await mobile.locator('.current-slot').count(), 0);
    };
    await assertNow('14:00');
    for (const [time, slot] of [['14:35', '14:30'], ['14:40', '14:30'], ['15:05', null], ['14:05', '14:00']]) {
      await page.evaluate(time => {
        window.TEST_DATE = `2026-10-19T${time}:00+07:00`;
        for (const callback of window.__minuteCallbacks) callback();
      }, time);
      await assertNow(slot);
    }

    // Existing badge locations and menu actions remain available; do not invoke writes.
    for (const status of ['active', 'completed']) assert.equal(await mobile.locator(`[data-status="${status}"] .student-badge`).count(), 2);
    assert.equal(await mobile.locator('[data-status="planned"] .badge-bottom .badge-detail').count(), 6);
    await mobile.locator('[data-status="active"]').click();
    const menu = page.locator('#contextMenu');
    await menu.waitFor({ state: 'visible' });
    assert.match(await menu.innerText(), /FirstAlpha LastAlpha/);
    assert.match(await menu.innerText(), /Check Out/);
    await page.locator('#menuOverlay').click({ position: { x: 5, y: 5 } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-schedule-ui-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await desktop.waitFor({ state: 'visible' });
    assert.equal(await desktop.locator('.student-wrapper').count(), 8);
    assert.equal(await desktop.locator('.current-slot').getAttribute('data-slot'), '14:00');
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-schedule-ui-desktop.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(await page.evaluate(() => window.__firestoreOps), initialOps);
    assert.equal(await page.evaluate(() => localStorage.getItem('__test-db')), initialDb);
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    console.log(JSON.stringify({ passed: true, scenarios: ['responsive layout', 'NOW rollover', 'full-name search', 'search retention', 'badges and menu'], extraReads: 0, extraListeners: 0, writes: 0, productionRequests: 0 }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
