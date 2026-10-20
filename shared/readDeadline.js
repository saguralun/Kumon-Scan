export const CHECKIN_READ_TIMEOUT_MS = 10000;

export function createReadDeadline(timeoutMs = CHECKIN_READ_TIMEOUT_MS) {
  const expiresAt = Date.now() + timeoutMs;

  function timeoutError(stage) {
    return Object.assign(new Error(`CHECKIN_READ_TIMEOUT: ${stage}`), {
      code: "deadline-exceeded",
      stage,
      isCheckinReadTimeout: true,
    });
  }

  function assertActive(stage = "before-save") {
    if (Date.now() >= expiresAt) throw timeoutError(stage);
  }

  function run(read, stage = "read") {
    assertActive(stage);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(timeoutError(stage)), expiresAt - Date.now());
      // Timing out stops the caller, not the SDK read. Late results cannot start a save.
      Promise.resolve().then(() => {
        assertActive(stage);
        return read();
      }).then(value => {
        clearTimeout(timer);
        assertActive(stage);
        resolve(value);
      }, error => {
        clearTimeout(timer);
        reject(error);
      }).catch(reject);
    });
  }

  return { run, assertActive, isActive: () => Date.now() < expiresAt };
}
