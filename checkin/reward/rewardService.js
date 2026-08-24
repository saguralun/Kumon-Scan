import {
  doc,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
  migrateInventory
} from "./inventoryMigration.js";

import {
  logError
} from "/shared/index.js";

export async function updateStudentReward({
  db,
  studentId,
  studentData,
  rewardId,
  rewardRarity,
  extras = [],
}) {

  if (!rewardId || !rewardRarity) {
    const error = new Error("INVALID_REWARD");

    await logError(db, {
      tag: "updateStudentReward",
      message: "INVALID_REWARD",
      error,
      extra: {
        studentId,
        rewardId,
        rewardRarity,
        rewardData: {
          id: rewardId,
          rarity: rewardRarity,
        },
        extras,
      },
    });

    throw error;
  }

  const {
    inventory,
    legacyDeletes,
    migratedLegacy
  } = migrateInventory(
    studentData.inventory
  );

  const oldCount =
    inventory[rewardId] || 0;

  const oldStats = studentData.rewardStats || {};

  let badLuckStreak = oldStats.badLuckStreak || 0;

  if (rewardRarity === "common" || rewardRarity === "uncommon") {
    badLuckStreak++;
  } else {
    badLuckStreak = 0;
  }

  const ref = doc(db, "students", studentId);

  const lastProgress = {
    ...(studentData.lastProgress || {}),
  };

  for (const extra of extras) {
    if (extra.type === "WS" && extra.level) {
      lastProgress.WS = {
        level: extra.level,
        ws: extra.ws || null,
      };
    }

    if (extra.type === "AT" && extra.level) {
      lastProgress.AT = extra.level;
    }
  }

  await setDoc(
    ref,
    {
      rewardStats: {
        badLuckStreak,
      },

      inventory: {
        ...inventory,

        [rewardId]:
          oldCount + 1,
      },

      lastProgress,
    },
    {
      merge: true,
    },
  );

  if (migratedLegacy) {

    await updateDoc(
      ref,
      legacyDeletes
    );

  }

}
