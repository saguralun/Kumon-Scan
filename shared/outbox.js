import { createPendingStore } from "./pendingStore.js";
const TRANSIENT = new Set(["unavailable", "deadline-exceeded", "aborted", "unknown", "network-request-failed", "internal"]);

export function createOutbox({ kind, execute, summarize = value => value, onChange = () => {},
  storage = localStorage, isOnline = () => navigator.onLine !== false, concurrency = 2,
  withLock = (key, action) => globalThis.navigator?.locks
    ? navigator.locks.request(key, { ifAvailable: true }, lock => lock ? action() : undefined)
    : action(),
}) {
  const store = createPendingStore(kind, { storage });
  const { prefix, get, list } = store;
  const running = new Map();
  const groups = new Set();
  const paused = new Set();
  const waiters = new Map();
  const results = new Map();
  let timer = null;
  let started = false;
  let disposed = false;

  function save(job) {
    store.put(job);
    onChange();
  }
  function update(job, patch) {
    const current = get(job.id);
    if (!current || current.requestId !== job.requestId) return;
    save({ ...current, ...patch });
  }
  function wait(id) {
    const job = get(id);
    if (job?.status === "done") return Promise.resolve(results.get(id) || job.result);
    if (job?.status === "failed") return Promise.reject(new Error(job.error));
    if (!waiters.has(id)) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      promise.catch(() => {});
      waiters.set(id, { promise, resolve, reject });
    }
    return waiters.get(id).promise;
  }
  function settle(job) {
    if (!job) return;
    const waiter = waiters.get(job.id);
    if (!waiter) return;
    if (job.status === "done") waiter.resolve(results.get(job.id) || job.result);
    else if (job.status === "failed") waiter.reject(new Error(job.error));
    else return;
    waiters.delete(job.id);
  }
  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!started || disposed || !isOnline()) return;
    if (running.size >= concurrency) return;
    const jobs = list().filter(job => job.status === "pending" && !paused.has(job.id) && !running.has(job.id) && !groups.has(job.group || job.id));
    if (jobs.length) timer = setTimeout(pump, Math.max(1000, Math.min(...jobs.map(job => (job.retryAt || 0) - Date.now()))));
  }
  async function run(job) {
    const group = job.group || job.id;
    let handled = false;
    groups.add(group);
    try {
      await withLock(`kumon-outbox:${kind}:${group}`, async () => {
        handled = true;
        const current = get(job.id);
        if (!current || current.requestId !== job.requestId || current.status !== "pending") return;
        update(current, { attempts: (current.attempts || 0) + 1 });
        try {
          const value = await execute(current);
          // Persist the receipt before resolving any foreground waiter.
          update(current, { status: "done", result: summarize(value), error: null, retryAt: 0 });
          results.set(current.id, value);
          settle(get(current.id));
        } catch (error) {
          const code = String(error?.code || "").replace(/^firestore\//, "");
          const retry = TRANSIENT.has(code);
          update(current, {
            status: retry ? "pending" : "failed",
            retryAt: retry ? Date.now() + Math.min(30000, 3000 * 2 ** Math.min(current.attempts || 0, 4)) : 0,
            error: String(error?.message || error).slice(0, 250),
          });
          settle(get(current.id));
        }
      });
    } catch (error) {
      // A failed local checkpoint must not repeatedly replay a committed request.
      paused.add(job.id);
      console.error("Outbox checkpoint failed; waiting for resume", error);
      onChange();
    } finally {
      groups.delete(group);
      running.delete(job.id);
      schedule();
      if (!disposed && handled) queueMicrotask(pump);
    }
  }
  function pump() {
    if (!started || disposed || !isOnline()) return;
    clearTimeout(timer);
    const blockedGroups = new Set();
    for (const job of list()) {
      if (running.size >= concurrency) break;
      if (job.status !== "pending" || blockedGroups.has(job.group || job.id)) continue;
      blockedGroups.add(job.group || job.id);
      if (job.status !== "pending" || paused.has(job.id) || running.has(job.id) || groups.has(job.group || job.id) || job.retryAt > Date.now()) continue;
      // Reserve before run can complete synchronously or another pump can start.
      running.set(job.id, true);
      void run(job).catch(error => { console.error("Outbox storage failure", error); onChange(); });
    }
    schedule();
  }
  function enqueue(payload) {
    const existing = get(payload.id);
    if (existing) return { job: existing, existing: true, promise: wait(existing.id) };
    const job = { ...payload, version: 1, requestId: crypto.randomUUID(), createdAt: Date.now(),
      status: "pending", attempts: 0, retryAt: 0 };
    save(job);
    const promise = wait(job.id);
    if (started) queueMicrotask(pump);
    return { job, existing: false, promise };
  }
  function resume() {
    started = true;
    paused.clear();
    for (const job of list()) {
      settle(job);
      if (job.status === "pending" && job.retryAt) update(job, { retryAt: 0 });
    }
    onChange();
    pump();
  }
  function retry(id) {
    const job = get(id);
    if (!job || running.has(id) || job.status === "done") return;
    update(job, { status: "pending", retryAt: 0, error: null });
    resume();
  }
  function acknowledge(id) {
    const job = get(id);
    if (job?.status !== "done") return;
    store.remove(id);
    results.delete(id);
    onChange();
  }
  function storageChanged(event) {
    if (!event.key?.startsWith(prefix)) return;
    for (const job of list()) settle(job);
    onChange();
    pump();
  }
  globalThis.window?.addEventListener("storage", storageChanged);
  return { enqueue, wait, get, list, retry, acknowledge, resume,
    dispose() { disposed = true; clearTimeout(timer); globalThis.window?.removeEventListener("storage", storageChanged); },
  };
}
