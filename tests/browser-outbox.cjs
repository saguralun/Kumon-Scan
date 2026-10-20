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
export const getDocs = async q => snapshot(q);
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
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(base + '/')) return route.continue();
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
        'system/config': { appVersion:'6.0.6',serverTime:{__timestampISO:date.toISOString()},weekly,
          lastDailyBuildDate:today,rarities:[{id:'common',weight:100,badge:'Common'}],
          rewardItems:{test:{type:'shape',name:'Test Star',icon:'*',rarity:'common',releaseDate:'2020-01-01',enabled:true}} },
        ['dailySchedule/'+today]: {buildVersion:2,status:'complete'},
      };
      for(const id of ['101','102','103','104'])db['students/'+id]={active:true,firstName:'First'+id,lastName:'Last'+id,nickname:'Student '+id,subject:'ME',weeklyPlans:Object.fromEntries(Array.from({length:7},(_,i)=>[i,{timeSlot:'17:30',timeAverage:'17:30',planStrength:5,totalSessions:1}]))};
      localStorage.setItem('__test-db',JSON.stringify(db));
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const enter = async id => {
      for (const n of id) await page.locator('.keypad button').filter({ hasText: new RegExp('^'+n+'$') }).click();
      await page.locator('#enterBtn').click();
    };
    await page.goto(base + '/checkin.html');
    await page.waitForFunction(() => document.querySelector('#loadingOverlay').classList.contains('hide'));
    await enter('101');
    await page.locator('#rewardConfirmBtn').waitFor({ state: 'visible' });
    await page.locator('#rewardConfirmBtn').click();
    await page.evaluate(() => { window.__holdCommit = true; });
    await enter('102');
    await page.waitForFunction(() => !document.querySelector('#enterBtn').disabled, { timeout: 12000 });
    assert.match(await page.locator('#checkinQueue').innerText(), /Student 102/);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#loadingOverlay')).opacity === '0');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-outbox-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 667 });
    assert.ok(await page.locator('.container').evaluate(el => el.getBoundingClientRect().top >= 0));
    await page.locator('#enterBtn').scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { window.__holdCommit = false; });
    await enter('103');
    await page.locator('#rewardConfirmBtn').waitFor({ state: 'visible' });
    const currentStatus = await page.locator('#status').innerText();
    await page.evaluate(() => { for (const done of window.__pendingCommits || []) done(); window.__pendingCommits = []; });
    await page.waitForFunction(() => [...document.querySelectorAll('.checkin-job.done')].some(e => e.textContent.includes('102')));
    assert.equal(await page.locator('#status').innerText(), currentStatus);
    await page.locator('#rewardConfirmBtn').click();
    await page.evaluate(() => { window.__holdCommit = true; });
    await enter('104');
    await page.waitForFunction(() => !document.querySelector('#enterBtn').disabled, { timeout: 12000 });
    await page.reload();
    await page.waitForFunction(() => [...document.querySelectorAll('.checkin-job.done')].some(e => e.textContent.includes('104')));
    const inventory = await page.evaluate(() => JSON.parse(localStorage.getItem('__test-db'))['students/104'].inventory);
    assert.equal(inventory.test, 1);
    await page.goto(base + '/result.html');
    await page.locator('.checkout-btn').first().waitFor();
    await page.evaluate(() => { window.__holdCommit = true; });
    const checkout = page.locator('.checkout-btn').first();
    const handler = await checkout.getAttribute('onclick');
    const id = handler.match(/checkout\('([^']+)'\)/)?.[1] || handler.split("'")[1];
    await checkout.click();
    await page.waitForFunction(() => Object.keys(localStorage).some(k => k.startsWith('kumon-outbox-v1:checkout:')));
    await page.reload();
    await page.waitForFunction(id => JSON.parse(localStorage.getItem('__test-db'))['attendance/'+id]?.status === 'completed', id);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-result-mobile.png'), fullPage: true });
    await page.goto(base + '/schedule.html');
    await page.locator('#scheduleDataStatus').filter({ hasText: 'server' }).waitFor();
    await page.evaluate(() => { window.__fromCache = true; window.__notifyMock(); });
    await page.locator('#scheduleDataStatus').filter({ hasText: 'รอเชื่อมต่อ' }).waitFor();
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-schedule-mobile.png'), fullPage: true });
    await page.setViewportSize({width:1280,height:900});
    await page.screenshot({ path: path.join(os.tmpdir(), 'kumon-schedule-desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, firebase: 'mocked; all non-local requests intercepted', screenshots: ['kumon-outbox-mobile.png','kumon-result-mobile.png','kumon-schedule-mobile.png','kumon-schedule-desktop.png'].map(n=>path.join(os.tmpdir(),n)) }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
