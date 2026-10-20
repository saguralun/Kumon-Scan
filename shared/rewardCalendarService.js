import { doc, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export async function saveRewardReleaseDates({ db, changes }) {
  if (!changes.length) return;
  const ids = new Set();
  for (const change of changes) {
    if (!/^[A-Za-z0-9_-]+$/.test(change.id) || ids.has(change.id) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(change.releaseDate) ||
        !Number.isFinite(Date.parse(change.releaseDate + "T00:00:00Z")) ||
        new Date(change.releaseDate + "T00:00:00Z").toISOString().slice(0, 10) !== change.releaseDate) {
      throw new Error("REWARD_CALENDAR_INVALID_CHANGE");
    }
    ids.add(change.id);
  }
  const ref = doc(db, "system", "config");
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("SYSTEM_CONFIG_NOT_FOUND");
    const items = snap.data().rewardItems || {};
    const updates = {};
    for (const change of changes) {
      const item = Object.hasOwn(items, change.id) ? items[change.id] : null;
      if (!item || (item.releaseDate !== change.previousDate && item.releaseDate !== change.releaseDate)) {
        throw new Error("REWARD_CALENDAR_CONFLICT: " + change.id);
      }
      if (item.releaseDate !== change.releaseDate) updates[`rewardItems.${change.id}.releaseDate`] = change.releaseDate;
    }
    if (Object.keys(updates).length) tx.update(ref, updates);
  });
}
