const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('C:/Users/AkiraLun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = 'https://scan-qrcode-kumon.web.app';
const version = fs.readFileSync(path.join(__dirname, '../shared/versionControl.js'), 'utf8').match(/APP_VERSION = "([^"]+)"/)[1];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Bangkok', serviceWorkers: 'block' });
    const blockedWrites = [], errors = [], failedAssets = [], summaries = [];
    // Read-only smoke test: even automatic background work cannot write to production.
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      const firestore = url.hostname === 'firestore.googleapis.com';
      const write = firestore && (/\/Write\/|:commit|:batchWrite/.test(url.pathname) ||
        ['PATCH', 'DELETE', 'PUT'].includes(request.method()) ||
        (request.method() === 'POST' && /\/documents\//.test(url.pathname) && !/:batchGet|:runQuery|:runAggregationQuery/.test(url.pathname)));
      if (write) {
        blockedWrites.push({ path: url.pathname, method: request.method() });
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => {
      if (response.status() >= 400 && /\.(js|css)(\?|$)/.test(response.url())) failedAssets.push({ url: response.url(), status: response.status() });
    });
    const snapshot = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' overflows horizontally');
      await page.screenshot({ path: path.join(os.tmpdir(), `kumon-live-${version}-${name}.png`), fullPage: true });
    };

    await page.goto(base + '/checkin.html');
    await page.waitForFunction(() => document.querySelector('#loadingOverlay').classList.contains('hide'), null, { timeout: 20000 });
    assert.match(await page.locator('#versionLabel').innerText(), new RegExp(version.replaceAll('.', '\\.')));
    assert.equal(await page.locator('.keypad button').count(), 12);
    assert.equal(await page.locator('#display').getAttribute('class'), 'placeholder');
    assert.equal(await page.locator('.checkin-job').count(), 0);
    assert.doesNotMatch(await page.locator('#status').innerText(), /failed|ไม่สำเร็จ|ไม่ถูกต้อง/i);
    await snapshot('checkin-mobile');
    summaries.push({ page: 'checkin', version, startup: 'ready', studentSubmitted: false });

    await page.goto(base + '/result.html');
    await page.locator('#dataStatus').filter({ hasText: 'server' }).waitFor({ timeout: 20000 });
    assert.ok((await page.locator('#appVersion').innerText()).includes(version));
    const active = await page.locator('.checkout-btn').count();
    assert.equal(await page.locator('.header-actions a').count(), 2);
    await snapshot('result-mobile');
    await page.locator('[data-tab="completed"]').click();
    await page.locator('#dataStatus').filter({ hasText: 'server' }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.retry-load').count(), 0);
    summaries.push({ page: 'result', version, active, completed: await page.locator('.student-card-complete').count(), server: true });

    await page.goto(base + '/schedule.html');
    await page.locator('#scheduleDataStatus').filter({ hasText: 'server' }).waitFor({ timeout: 20000 });
    assert.ok((await page.locator('#versionText').innerText()).includes(version));
    const mobile = page.locator('#mobileSchedule'), desktop = page.locator('#desktopSchedule');
    assert.equal(await mobile.isVisible(), true);
    assert.equal(await mobile.locator('.mobile-tab').count(), 3);
    const first = mobile.locator('.student-wrapper').first();
    if (await first.count()) {
      const [id] = JSON.parse(await first.getAttribute('data-search-text'));
      await page.locator('#studentSearch').fill(String(id));
      await page.waitForFunction(() => document.querySelector('#mobileSchedule .search-hit'));
      await page.locator('#searchClear').click();
    }
    await snapshot('schedule-mobile');
    await page.setViewportSize({ width: 1280, height: 900 });
    await desktop.waitFor({ state: 'visible' });
    assert.equal(await mobile.isVisible(), false);
    await snapshot('schedule-desktop');
    const total = await desktop.locator('.student-wrapper').count();
    await page.setViewportSize({ width: 390, height: 844 });
    await mobile.waitFor({ state: 'visible' });
    assert.ok(await mobile.locator('.slot-now').count() <= 1);
    summaries.push({ page: 'schedule', version, entries: total, responsive: true, server: true });

    const served = await context.request.get(base + '/shared/versionControl.js');
    assert.equal(served.status(), 200);
    assert.equal(await served.text(), fs.readFileSync(path.join(__dirname, '../shared/versionControl.js'), 'utf8'));
    const schedule = await context.request.get(base + '/schedule.html');
    assert.equal(await schedule.text(), fs.readFileSync(path.join(__dirname, '../schedule.html'), 'utf8'));
    const hiddenGit = await context.request.get(base + '/.git/config');
    assert.equal(hiddenGit.status(), 404);
    assert.deepEqual(blockedWrites, []);
    assert.deepEqual(failedAssets, []);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, summaries, blockedWriteAttempts: blockedWrites.length, productionWrites: 0, gitConfigStatus: hiddenGit.status(), runtimeErrors: errors.length }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
