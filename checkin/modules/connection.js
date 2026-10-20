import {
  disableNetwork, enableNetwork,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const CHECKIN_RECONNECT_AFTER_MS = 4000;
const RECONNECT_COOLDOWN_MS = 15000;
const CONNECTION_ERRORS = new Set(["unavailable", "deadline-exceeded", "network-request-failed"]);

export function createCheckinConnection({ db, isOnline = () => navigator.onLine !== false }) {
  let reconnecting = null;
  let activeWrites = 0;
  let lastReconnectAt = -Infinity;

  function reconnect() {
    if (reconnecting) return reconnecting;
    if (activeWrites || !isOnline() || Date.now() - lastReconnectAt < RECONNECT_COOLDOWN_MS) {
      return Promise.resolve(false);
    }
    lastReconnectAt = Date.now();
    reconnecting = (async () => {
      try {
        await disableNetwork(db);
      } finally {
        // Always restore the SDK, including when disabling the network fails.
        await enableNetwork(db);
      }
      return true;
    })().finally(() => { reconnecting = null; });
    return reconnecting;
  }

  async function beginWrite() {
    while (reconnecting) await reconnecting;
    activeWrites++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeWrites--;
    };
  }

  async function runRead(read, { canRetry = () => true } = {}) {
    while (reconnecting) await reconnecting;
    let timer;
    // Observe both outcomes so an abandoned first read cannot reject unhandled.
    const first = Promise.resolve().then(read).then(
      value => ({ value }), error => ({ error }),
    );
    const stalled = new Promise(resolve => {
      timer = setTimeout(() => resolve({ stalled: true }), CHECKIN_RECONNECT_AFTER_MS);
    });
    let outcome = await Promise.race([first, stalled]);
    clearTimeout(timer);

    const error = outcome.error || (outcome.value?.status === "error" ? outcome.value.error : null);
    const code = String(error?.code || "").replace(/^firestore\//, "");
    if ((outcome.stalled || CONNECTION_ERRORS.has(code)) && canRetry() && await reconnect() && canRetry()) {
      // Disabling the SDK may settle an old getDoc from cache; discard that result.
      // Retry only this read, once. Never replay a transaction or a save.
      return read();
    }
    if (outcome.stalled) outcome = await first;
    if (outcome.error) throw outcome.error;
    return outcome.value;
  }

  return { runRead, beginWrite };
}
