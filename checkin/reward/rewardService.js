import {
  doc,
  updateDoc,
  runTransaction,
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

  const ref = doc(db, "students", studentId);

  // 🔒 อ่าน + คำนวณ + เขียน ต้องทำใน transaction เดียวกัน
  // เพื่อกัน lost update ตอนมีการสแกน/เขียนซ้อนกันในเวลาไล่เลี่ยกัน
  // (ของเดิมอ่าน studentData ที่โหลดไว้ก่อนหน้า แล้วเขียนทับตรง ๆ
  //  ถ้าสแกน 2 ครั้งเร็ว ๆ การเขียนครั้งที่สองจะเขียนทับครั้งแรกหายไป)
  const { legacyDeletes, migratedLegacy } = await runTransaction(
    db,
    async (tx) => {

      const snap = await tx.get(ref);

      // ใช้ค่าล่าสุดจาก Firestore เป็นหลัก (studentData ที่รับมาอาจ stale)
      const freshData =
        snap.exists() ? snap.data() : studentData;

      const {
        inventory,
        legacyDeletes,
        migratedLegacy
      } = migrateInventory(
        freshData.inventory
      );

      const oldCount =
        inventory[rewardId] || 0;

      const oldStats = freshData.rewardStats || {};

      let badLuckStreak = oldStats.badLuckStreak || 0;

      if (rewardRarity === "common" || rewardRarity === "uncommon") {
        badLuckStreak++;
      } else {
        badLuckStreak = 0;
      }

      const lastProgress = {
        ...(freshData.lastProgress || {}),
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

      tx.set(
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

      return { legacyDeletes, migratedLegacy };

    }
  );

  if (migratedLegacy) {

    await updateDoc(
      ref,
      legacyDeletes
    );

  }

}
