const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('C:/Users/AkiraLun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = 'http://127.0.0.1:5173';
const mock = String.raw`
export class Timestamp { constructor(iso) { this.iso = iso; } static fromDate(d) { return new Timestamp(d.toISOString()); } toDate() { return new Date(this.iso); } toJSON() { return {__timestampISO:this.iso}; } }
const load = () => JSON.parse(localStorage.getItem('__test-db'));
const revive = x => x && x.__timestampISO ? new Timestamp(x.__timestampISO) : Array.isArray(x) ? x.map(revive) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k,v])=>[k,revive(v)])) : x;
const field = (v,k) => k.split('.').reduce((a,b)=>a?.[b],v);
const listeners = [];
export const getFirestore = () => ({});
export const doc = (db,...parts) => parts.join('/');
export const collection = doc, collectionGroup = doc;
export const query = (ref,...constraints) => ({ref,constraints});
export const where = (field,op,value) => ({field,op,value});
export const orderBy = field => ({order:field});
export const limit = value => ({limit:value});
export const startAt = () => ({}), endAt = startAt, startAfter = startAt;
export const documentId = () => '__name__';
export const serverTimestamp = () => Timestamp.fromDate(new Date());
export const deleteField = () => ({__delete:true});
export const increment = by => ({__increment:by});
function snap(ref) { const value=load()[ref]; return {id:ref.split('/').pop(),ref,exists:()=>value!==undefined,data:()=>revive(value)}; }
export const getDoc = async ref => snap(ref), getDocFromServer = getDoc;
function snapshot(q) { const ref=q.ref||q; let docs=Object.keys(load()).filter(k=>k.startsWith(ref+'/')&&!k.slice(ref.length+1).includes('/')).map(snap).filter(d=>(q.constraints||[]).every(c=>!c.field||(c.op==='=='?field(d.data(),c.field)===c.value:field(d.data(),c.field)>=c.value))); const n=q.constraints?.find(c=>c.limit)?.limit; if(n)docs=docs.slice(0,n); return {docs,size:docs.length,empty:!docs.length,metadata:{fromCache:!!window.__fromCache,hasPendingWrites:false},forEach:fn=>docs.forEach(fn),docChanges:()=>docs.map(doc=>({type:'added',doc}))}; }
export const getDocs = async q => { if(window.__failCompletedRead && q.constraints?.some(c=>c.field==='status'&&c.value==='completed')){window.__failCompletedRead=false;throw Object.assign(new Error('simulated read failure'),{code:'unavailable'});}return snapshot(q); };
export const getCountFromServer = async q => ({data:()=>({count:snapshot(q).size})});
function notify(){for(const fn of listeners)queueMicrotask(fn);}
export function onSnapshot(q,options,callback) { if(typeof options==='function')callback=options; let previous=new Set(); const fire=()=>{const s=snapshot(q);const changes=s.docs.filter(d=>!previous.has(d.id)).map(doc=>({type:'added',doc}));previous=new Set(s.docs.map(d=>d.id));s.docChanges=()=>changes;callback(s);};listeners.push(fire);queueMicrotask(fire);return()=>{const i=listeners.indexOf(fire);if(i>=0)listeners.splice(i,1);}; }
window.__notifyMock = notify;
function assign(target,key,value){const keys=key.split('.');for(const k of keys.slice(0,-1))target=target[k]??={};const k=keys.at(-1);if(value?.__delete)delete target[k];else if(value?.__increment)target[k]=(target[k]||0)+value.__increment;else target[k]=value;}
function merge(target,value){for(const[k,v]of Object.entries(value)){if(v?.__delete)delete target[k];else if(v&&typeof v==='object'&&!Array.isArray(v)&&!v.toDate&&!v.__timestampISO){target[k]??={};merge(target[k],v);}else target[k]=v;}return target;}
async function commit(writes){if(window.__holdCommit)await new Promise(resolve=>(window.__pendingCommits??=[]).push(resolve));const db=load();for(const w of writes){if(w.kind==='update'){const data=db[w.ref]||{};for(const[k,v]of Object.entries(w.value))assign(data,k,v);db[w.ref]=data;}else db[w.ref]=w.options?.merge?merge(db[w.ref]||{},w.value):w.value;}localStorage.setItem('__test-db',JSON.stringify(db));notify();if(window.__loseAck){window.__loseAck=false;throw Object.assign(new Error('ack lost'),{code:'unavailable'});}}
export async function runTransaction(db,fn){const writes=[];const value=await fn({get:getDoc,update:(ref,value)=>writes.push({kind:'update',ref,value}),set:(ref,value,options)=>writes.push({kind:'set',ref,value,options})});if(writes.length)await commit(writes);return value;}
export const updateDoc = async(ref,value)=>commit([{kind:'update',ref,value}]);
export const setDoc = async(ref,value,options)=>commit([{kind:'set',ref,value,options}]);
export const addDoc = async()=>{};
export const enableNetwork = async()=>{}, disableNetwork = async()=>{};
export function writeBatch(){const writes=[];return{update:(ref,value)=>writes.push({kind:'update',ref,value}),set:(ref,value,options)=>writes.push({kind:'set',ref,value,options}),commit:()=>commit(writes)};}
`;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Bangkok' });
    let clockMode = 'slow', clockRequests = 0, clockRequestedAt = 0;
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(base + '/')) return route.continue();
      if (url.startsWith('https://scan-qrcode-kumon.web.app/manifest/manifest-checkin.json?clock=')) {
        clockRequests++;
        clockRequestedAt = Date.now();
        if (clockMode === 'slow') await new Promise(resolve => setTimeout(resolve, 4500));
        return route.fulfill({ status: 200, headers: {
          Date: new Date().toUTCString(), 'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Date, Age',
        }, body: '' }).catch(() => {});
      }
      if (url.includes('firebase-firestore.js')) return route.fulfill({ contentType: 'text/javascript', body: mock });
      if (url.includes('firebase-app.js')) return route.fulfill({ contentType: 'text/javascript', body: 'export const initializeApp = () => ({});' });
      if (url.includes('canvas-confetti')) return route.fulfill({ contentType: 'text/javascript', body: 'export default function confetti(){}' });
      return route.abort();
    });
    await context.addInitScript(() => {
      if (localStorage.getItem('__test-db')) return;
      const date = new Date(), today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replaceAll('-', '');
      const weekly = Object.fromEntries(Array.from({length:7},(_,i)=>[i,{enabled:true,open:'00:00',close:'23:59'}]));
      const db = {
        'system/config': { appVersion:'6.0.9',serverTime:{__timestampISO:new Date(date.getTime()-3*86400000).toISOString()},weekly,
          lastDailyBuildDate:today,rarities:[{id:'common',weight:100,badge:'Common'}],
          rewardItems:{test:{type:'shape',name:'Test Star',icon:'*',rarity:'common',releaseDate:'2020-01-01',enabled:true}} },
        ['dailySchedule/'+today]: {buildVersion:2,status:'complete'},
      };
      for(const id of ['101','102','103','104'])db['students/'+id]={active:true,firstName:'First'+id,lastName:'Last'+id,nickname:'Student '+id,subject:'ME',weeklyPlans:Object.fromEntries(Array.from({length:7},(_,i)=>[i,{timeSlot:'17:30',timeAverage:'17:30',planStrength:5,totalSessions:1}]))};
      localStorage.setItem('__test-db',JSON.stringify(db));
      localStorage.setItem('__test-initial-db',JSON.stringify(db));
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const enter = async id => {
      for (const n of id) await page.locator('.keypad button').filter({ hasText: new RegExp('^'+n+'$') }).click();
      await page.locator('#enterBtn').click();
    };
    await page.goto(base + '/checkin.html');
    await page.locator('#status').filter({ hasText: 'ตรวจสอบเวลาไม่สำเร็จ' }).waitFor({timeout:7000});
    assert.ok(Date.now() - clockRequestedAt < 4000);
    assert.equal(await page.evaluate(() => localStorage.getItem('__test-db') === localStorage.getItem('__test-initial-db')), true);
    assert.equal(await page.locator('.checkin-job').count(), 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#loadingOverlay')).opacity === '0');
    await page.screenshot({path:path.join(os.tmpdir(),'kumon-clock-timeout-mobile.png'),fullPage:true});
    clockMode = 'ok';
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#loadingOverlay').classList.contains('hide'));
    assert.ok(clockRequests >= 2);
    assert.equal(await page.evaluate(() => localStorage.getItem('__test-db') === localStorage.getItem('__test-initial-db')), true);
    await enter('101');
    await page.locator('#rewardConfirmBtn').waitFor({ state: 'visible' });
    await page.locator('#rewardConfirmBtn').click();
    let savedDatabase = await page.evaluate(() => localStorage.getItem('__test-db'));
    await enter('101');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('กำลังเรียนอยู่'));
    await page.waitForFunction(() => !document.querySelector('#enterBtn').disabled);
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('currentStudentId'))), '101');
    assert.equal(await page.evaluate(() => localStorage.getItem('__test-db')), savedDatabase);
    assert.equal(await page.locator('#collectionLinkWrapper').isVisible(), true);
    await page.evaluate(() => { window.__holdCommit = true; });
    await enter('102');
    await page.waitForFunction(() => !document.querySelector('#enterBtn').disabled, { timeout: 12000 });
    assert.match(await page.locator('#checkinQueue').innerText(), /Student 102/);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#loadingOverlay')).opacity === '0');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-outbox-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 667 });
    assert.ok(await page.locator('.container').evaluate(el => el.getBoundingClientRect().top + scrollY >= 0));
    await page.locator('#enterBtn').scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { window.__holdCommit = false; });
    await enter('103');
    await page.locator('#rewardConfirmBtn').waitFor({ state: 'visible' });
    const currentStatus = await page.locator('#status').innerText();
    await page.evaluate(() => { for (const done of window.__pendingCommits || []) done(); window.__pendingCommits = []; });
    await page.waitForFunction(() => Object.keys(localStorage).filter(k => k.startsWith('kumon-outbox-v1:checkin:')).some(k => {
      const job = JSON.parse(localStorage.getItem(k)); return job.studentId === '102' && job.status === 'done';
    }));
    assert.equal(await page.locator('.checkin-job.done').count(), 0);
    assert.equal(await page.locator('#checkinQueue').isVisible(), false);
    assert.equal(await page.locator('#status').innerText(), currentStatus);
    await page.locator('#rewardConfirmBtn').click();
    savedDatabase = await page.evaluate(() => localStorage.getItem('__test-db'));
    await enter('102');
    await page.waitForFunction(() => !document.querySelector('#enterBtn').disabled);
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('currentStudentId'))), '102');
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('studentInventory')).test), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('__test-db')), savedDatabase);
    assert.equal(await page.locator('#collectionLinkWrapper').isVisible(), true);
    assert.equal(await page.locator('#checkinQueue').isVisible(), false);
    await page.evaluate(() => {
      const key = Object.keys(localStorage).filter(k => k.startsWith('kumon-outbox-v1:checkin:')).find(k => JSON.parse(localStorage.getItem(k)).studentId === '101');
      const job = JSON.parse(localStorage.getItem(key));
      job.status = 'failed'; job.error = 'Simulated recoverable queue error';
      localStorage.setItem(key, JSON.stringify(job));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });
    const retry = page.locator('.checkin-job.failed button');
    await retry.waitFor();
    assert.equal(await retry.innerText(), 'ลองใหม่');
    assert.ok(await retry.evaluate(el => el.getBoundingClientRect().width >= 44));
    await retry.click();
    await page.waitForFunction(() => document.querySelector('#checkinQueue').hidden);
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('currentStudentId'))), '102');
    assert.equal(await page.evaluate(() => localStorage.getItem('__test-db')), savedDatabase);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#loadingOverlay')).opacity === '0');
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-collection-repeat-mobile.png'), fullPage: true });
    assert.equal(await page.locator('.checkin-job').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('__test-db')), savedDatabase);
    await page.evaluate(() => { window.__holdCommit = true; });
    await enter('104');
    await page.waitForFunction(() => !document.querySelector('#enterBtn').disabled, { timeout: 12000 });
    await page.reload();
    await page.waitForFunction(() => Object.keys(localStorage).filter(k => k.startsWith('kumon-outbox-v1:checkin:')).some(k => {
      const job = JSON.parse(localStorage.getItem(k)); return job.studentId === '104' && job.status === 'done';
    }));
    assert.equal(await page.locator('#checkinQueue').isVisible(), false);
    const inventory = await page.evaluate(() => JSON.parse(localStorage.getItem('__test-db'))['students/104'].inventory);
    assert.equal(inventory.test, 1);
    await page.goto(base + '/result.html');
    await page.locator('.checkout-btn').first().waitFor();
    await page.evaluate(() => { window.__holdCommit = true; });
    const checkout = page.locator('.checkout-btn').first();
    const handler = await checkout.getAttribute('onclick');
    const id = await checkout.getAttribute('data-attendance-id') || handler.match(/checkout\('([^']+)'\)/)?.[1] || handler.split("'")[1];
    await checkout.click();
    await page.waitForFunction(() => Object.keys(localStorage).some(k => k.startsWith('kumon-outbox-v1:checkout:')));
    await page.reload();
    await page.waitForFunction(id => JSON.parse(localStorage.getItem('__test-db'))['attendance/'+id]?.status === 'completed', id);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-result-mobile.png'), fullPage: true });
    await page.goto(base + '/checkin.html');
    await page.waitForFunction(() => document.querySelector('#loadingOverlay').classList.contains('hide'));
    savedDatabase = await page.evaluate(() => localStorage.getItem('__test-db'));
    const hasReceipt = await page.evaluate(id => JSON.parse(localStorage.getItem('kumon-outbox-v1:checkin:' + encodeURIComponent(id)))?.status === 'done', id);
    await enter(id.split('_')[0]);
    await page.waitForFunction(message => document.querySelector('#status').textContent.includes(message), hasReceipt ? 'มีผลเช็กอินแล้ว' : 'วันนี้เรียนเสร็จแล้ว');
    await page.waitForFunction(() => !document.querySelector('#enterBtn').disabled);
    assert.equal(await page.locator('#checkinQueue').isVisible(), false);
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('currentStudentId'))), id.split('_')[0]);
    assert.equal(await page.evaluate(() => localStorage.getItem('__test-db')), savedDatabase);
    await page.locator('#collectionLinkWrapper a').click();
    await page.locator('#studentInfo').filter({ hasText: id.split('_')[0] }).waitFor();
    assert.ok(await page.locator('#collectionContainer .card:not(.locked)').count() > 0);
    await page.goto(base + '/schedule.html');
    await page.locator('#scheduleDataStatus').filter({ hasText: 'server' }).waitFor();
    await page.evaluate(() => { window.__fromCache = true; window.__notifyMock(); });
    await page.locator('#scheduleDataStatus').filter({ hasText: 'รอเชื่อมต่อ' }).waitFor();
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-schedule-mobile.png'), fullPage: true });
    await page.setViewportSize({width:1280,height:900});
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-schedule-desktop.png'), fullPage: true });
    await page.setViewportSize({width:390,height:844});
    await page.goto(base + '/result.html');
    await page.locator('#dataStatus').filter({ hasText: 'server' }).waitFor();
    await page.evaluate(() => { window.__failCompletedRead = true; });
    await page.locator('[data-tab="completed"]').click();
    await page.locator('#cardView .retry-load').waitFor();
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-result-retry-mobile.png'), fullPage: true });
    await page.locator('#cardView .retry-load').click();
    await page.locator('.student-card-complete').first().waitFor();
    savedDatabase = await page.evaluate(() => localStorage.getItem('__test-db'));
    const tomorrow = await page.evaluate(() => { const d=new Date();d.setDate(d.getDate()+1);return d.toISOString(); });
    await page.evaluate(iso => { window.TEST_DATE=iso;document.dispatchEvent(new Event('visibilitychange')); }, tomorrow);
    await page.waitForFunction(() => document.querySelector('#cardView').textContent.includes('วันนี้ยังไม่มีนักเรียนเรียนเสร็จ'));
    assert.equal(await page.evaluate(() => localStorage.getItem('__test-db')), savedDatabase);
    await page.goto(base + '/schedule.html');
    await page.locator('#scheduleDataStatus').filter({ hasText: 'server' }).waitFor();
    const oldTitle = await page.locator('#pageTitle').innerText();
    await page.evaluate(iso => { window.TEST_DATE=iso;document.dispatchEvent(new Event('visibilitychange')); }, tomorrow);
    await page.waitForFunction(old => document.querySelector('#pageTitle').innerText !== old, oldTitle);
    assert.equal(await page.evaluate(() => localStorage.getItem('__test-db')), savedDatabase);
    const calendarDates = await page.evaluate(() => {
      const format = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      const initial=new Date(), target=new Date();target.setDate(target.getDate()+2);
      return { initial:format(initial), target:format(target) };
    });
    await page.evaluate(initial => {
      const db=JSON.parse(localStorage.getItem('__test-db'));
      db['system/config'].rewardItems.test.releaseDate=initial;
      localStorage.setItem('__test-db',JSON.stringify(db));
    }, calendarDates.initial);
    await page.goto(base + '/rewardCalendar.html');
    await page.locator('#syncBtn').click();
    await page.locator('.reward[data-id="test"]').first().waitFor();
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.locator('.reward[data-id="test"]').first().dispatchEvent('dragstart', {dataTransfer});
    await page.locator(`.day[data-date="${calendarDates.target}"]`).first().dispatchEvent('drop', {dataTransfer});
    await page.waitForFunction(() => !document.querySelector('#saveBtn').disabled);
    await page.evaluate(() => {
      const db=JSON.parse(localStorage.getItem('__test-db'));
      db['system/config'].rewardItems.test.name='Concurrent editor';
      db['system/config'].rewardItems.second={...db['system/config'].rewardItems.test,id:'second',releaseDate:'2026-11-01'};
      localStorage.setItem('__test-db',JSON.stringify(db));
    });
    await page.locator('#saveBtn').click();
    await page.waitForFunction(() => document.querySelector('#saveBtn').textContent.includes('Saved'));
    const calendarSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('__test-db'))['system/config'].rewardItems);
    assert.equal(calendarSaved.test.releaseDate,calendarDates.target);
    assert.equal(calendarSaved.test.name,'Concurrent editor');
    assert.ok(calendarSaved.second);
    await page.screenshot({path:path.join(os.tmpdir(),'kumon-calendar-safe-save-mobile.png'),fullPage:false});
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, firebase: 'mocked; all non-local requests intercepted', screenshots: ['kumon-outbox-mobile.png','kumon-result-mobile.png','kumon-schedule-mobile.png','kumon-schedule-desktop.png'].map(n=>path.join(os.tmpdir(),n)) }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
