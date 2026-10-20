export function createPendingStore(kind, { storage = localStorage } = {}) {
  const prefix = `kumon-outbox-v1:${kind}:`;
  const key = id => prefix + encodeURIComponent(id);
  function get(id) {
    const raw = storage.getItem(key(id));
    if (!raw) return null;
    const job = JSON.parse(raw);
    if (job.version !== 1 || job.id !== id || typeof job.requestId !== "string") {
      throw new Error("OUTBOX_DATA_INVALID");
    }
    return job;
  }
  function list() {
    const jobs = [];
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name?.startsWith(prefix)) jobs.push(get(decodeURIComponent(name.slice(prefix.length))));
    }
    return jobs.filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
  }
  return { prefix, get, list,
    put(job) {
      try { storage.setItem(key(job.id), JSON.stringify(job)); }
      catch (error) { error.isOutboxStorageError = true; throw error; }
    },
    remove(id) { storage.removeItem(key(id)); },
  };
}
