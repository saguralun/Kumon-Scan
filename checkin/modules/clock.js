import { MAX_SERVER_TIME_AGE_MINUTES } from "/shared/dateUtils.js";

export const CHECKIN_CLOCK_TIMEOUT_MS = 2500;
const CLOCK_REFERENCE_URL = "https://scan-qrcode-kumon.web.app/manifest/manifest-checkin.json";

function clockUnavailable() {
  return Object.assign(new Error("CLOCK_REFERENCE_UNAVAILABLE"), {
    code: "unavailable", stage: "clock",
  });
}

export async function verifyCheckinClock(config, {
  fetchTime = (...args) => fetch(...args),
  now = () => Date.now(),
  timeoutMs = CHECKIN_CLOCK_TIMEOUT_MS,
} = {}) {
  const maxDifference = MAX_SERVER_TIME_AGE_MINUTES * 60000;
  let savedTime = NaN;
  try {
    savedTime = config?.serverTime?.toDate?.().getTime();
  } catch {
    savedTime = NaN;
  }
  if (Number.isFinite(savedTime) && Math.abs(now() - savedTime) <= maxDifference) return true;

  const controller = new AbortController();
  let timer;
  try {
    // A Hosting header verifies the clock without queuing a Firestore write.
    const response = await Promise.race([
      fetchTime(`${CLOCK_REFERENCE_URL}?clock=${now()}`, {
        method: "HEAD", cache: "no-store", credentials: "omit", redirect: "error",
        signal: controller.signal,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(clockUnavailable()); }, timeoutMs);
      }),
    ]);
    const date = response.headers.get("Date");
    const ageHeader = response.headers.get("Age");
    const age = ageHeader === null ? 0 : Number(ageHeader);
    const serverTime = Date.parse(date);
    if (!response.ok || !Number.isFinite(serverTime) || !Number.isInteger(age) || age < 0 || age > 60) {
      throw clockUnavailable();
    }
    return Math.abs(now() - (serverTime + age * 1000)) <= maxDifference;
  } catch {
    throw clockUnavailable();
  } finally {
    clearTimeout(timer);
  }
}
