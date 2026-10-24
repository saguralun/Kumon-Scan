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
    const blockedWrites = [], errors = [], failedAssets = [], failedRequests = [], summaries = [];
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
      if (response.status() >= 400) {
        const url = new URL(response.url());
        failedRequests.push({ url: url.origin + url.pathname, status: response.status(), method: response.request().method() });
      }
      if (response.status() >= 400 && /\.(js|css)(\?|$)/.test(response.url())) failedAssets.push({ url: response.url(), status: response.status() });
    });
    const snapshot = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' overflows horizontally');
      await page.screenshot({ path: path.join(os.tmpdir(), `kumon-live-${version}-${name}.png`), fullPage: true });
    };

    await page.goto(base + '/checkin.html');
    await page.waitForFunction(() => document.querySelector('#loadingOverlay').classList.contains('hide'), null, { timeout: 20000 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#loadingOverlay')).opacity === '0');
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
    const activeBySubject = {};
    for (const subject of ['ME', 'EFL', 'TRP']) {
      const button = page.locator(`.sub-btn[data-subject="${subject}"]`);
      const count = Number(await button.locator('strong').innerText());
      await button.click();
      await page.waitForFunction(count => document.querySelectorAll('.checkout-btn').length === count, count);
      activeBySubject[subject] = count;
    }
    assert.equal(await page.locator('.header-actions a').count(), 2);
    await snapshot('result-mobile');
    await page.locator('[data-tab="completed"]').click();
    await page.locator('#dataStatus').filter({ hasText: 'server' }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.retry-load').count(), 0);
    summaries.push({ page: 'result', version, activeBySubject, completed: await page.locator('.student-card-complete').count(), server: true });

    await page.goto(base + '/schedule.html');
    await page.locator('#scheduleDataStatus').filter({ hasText: 'server' }).waitFor({ timeout: 20000 });
    assert.ok((await page.locator('#versionText').innerText()).includes(version));
    const mobile = page.locator('#mobileSchedule'), desktop = page.locator('#desktopSchedule');
    assert.equal(await mobile.isVisible(), true);
    assert.equal(await mobile.locator('.mobile-tab').count(), 3);
    for (const id of ['searchPrev', 'searchNext', 'searchClear']) {
      const bounds = await page.locator('#' + id).boundingBox();
      assert.ok(bounds.width >= 44 && bounds.height >= 44, id + ' touch target');
    }
    const first = mobile.locator('.student-wrapper').first();
    if (await first.count()) {
      const [id] = JSON.parse(await first.getAttribute('data-search-text'));
      await page.locator('#studentSearch').fill(String(id));
      await page.waitForFunction(() => document.querySelector('#mobileSchedule .search-hit'));
      await page.locator('#searchNext').click();
      await page.locator('#searchPrev').click();
      await page.locator('#searchClear').click();
      assert.equal(await page.locator('#studentSearch').inputValue(), '');
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
    summaries.push({ page: 'schedule', version, entries: total, responsive: true, searchButtons44px: true, server: true });

    const served = await context.request.get(base + '/shared/versionControl.js');
    assert.equal(served.status(), 200);
    assert.equal(await served.text(), fs.readFileSync(path.join(__dirname, '../shared/versionControl.js'), 'utf8'));
    const schedule = await context.request.get(base + '/schedule.html');
    assert.equal(await schedule.text(), fs.readFileSync(path.join(__dirname, '../schedule.html'), 'utf8'));
    const stylesheet = await context.request.get(base + '/schedule/css/schedule.css');
    assert.equal(stylesheet.status(), 200);
    assert.equal(await stylesheet.text(), fs.readFileSync(path.join(__dirname, '../schedule/css/schedule.css'), 'utf8'));
    assert.match(stylesheet.headers()['cache-control'], /no-cache/);
    for (const file of ['checkin.html', 'checkin/js/checkin.js', 'checkin/modules/checkinQueue.js',
      'checkin/ui/checkinJobStatus.js', 'checkin/ui/statusUI.js', 'checkin/css/checkin.css']) {
      const response = await context.request.get(base + '/' + file);
      assert.equal(response.status(), 200, file);
      assert.equal(await response.text(), fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), file);
      assert.match(response.headers()['cache-control'], /no-cache/, file);
    }
    const hiddenGit = await context.request.get(base + '/.git/config');
    assert.equal(hiddenGit.status(), 404);
    assert.deepEqual(blockedWrites, []);
    assert.deepEqual(failedAssets, []);
    if (errors.length) console.error(JSON.stringify({ summaries, failedRequests, errors, blockedWrites }));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, summaries, blockedWriteAttempts: blockedWrites.length, productionWrites: 0, gitConfigStatus: hiddenGit.status(), runtimeErrors: errors.length }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
