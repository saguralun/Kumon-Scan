import {
  doc,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
  migrateInventory
} from "./inventoryMigration.js";

import {
  logError
} from "/shared/index.js";

export function buildStudentRewardUpdate({
  studentData, rewardId, rewardRarity, extras = [], attendanceId = null, reward = null,
}) {
  if (!rewardId || !rewardRarity) throw new Error("INVALID_REWARD");
  const { inventory } = migrateInventory(studentData.inventory || {});
  if (attendanceId && studentData.rewardReceipt?.attendanceId === attendanceId) {
    return {
      updates: null,
      result: {
        reward: studentData.rewardReceipt.reward,
        isNewItem: studentData.rewardReceipt.isNewItem,
        inventory,
        rewardStats: studentData.rewardStats || {},
        alreadyClaimed: true,
      },
    };
  }

  const oldCount = inventory[rewardId] || 0;
  const oldStats = studentData.rewardStats || {};
  const rewardStats = {
    ...oldStats,
    badLuckStreak: ["common", "uncommon"].includes(rewardRarity)
      ? (oldStats.badLuckStreak || 0) + 1 : 0,
  };
  const lastProgress = { ...(studentData.lastProgress || {}) };
  for (const extra of extras) {
    if (extra.type === "WS" && extra.level) {
      lastProgress.WS = { level: extra.level, ws: extra.ws || null };
    }
    if (extra.type === "AT" && extra.level) lastProgress.AT = extra.level;
  }
  const finalInventory = { ...inventory, [rewardId]: oldCount + 1 };
  const awardedReward = reward || { id: rewardId, rarity: rewardRarity };
  const isNewItem = oldCount === 0;
  return {
    updates: {
      inventory: finalInventory, rewardStats, lastProgress,
      ...(attendanceId ? { rewardReceipt: { attendanceId, reward: awardedReward, isNewItem } } : {}),
    },
    result: { reward: awardedReward, isNewItem, inventory: finalInventory, rewardStats, alreadyClaimed: false },
  };
}

export async function updateStudentReward({
  db,
  studentId,
  studentData,
  rewardId,
  rewardRarity,
  extras = [],
  attendanceId = null,
  reward = null,
  persistAttendanceReceipt = false,
}) {

  if (!rewardId || !rewardRarity) {
    const error = new Error("INVALID_REWARD");

    void logError(db, {
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
    }).catch(console.error);

    throw error;
  }

  const ref = doc(db, "students", studentId);
  const attendanceRef = persistAttendanceReceipt && attendanceId ? doc(db, "attendance", attendanceId) : null;

  // 🔒 อ่าน + คำนวณ + เขียน ต้องทำใน transaction เดียวกัน
  // เพื่อกัน lost update ตอนมีการสแกน/เขียนซ้อนกันในเวลาไล่เลี่ยกัน
  // (ของเดิมอ่าน studentData ที่โหลดไว้ก่อนหน้า แล้วเขียนทับตรง ๆ
  //  ถ้าสแกน 2 ครั้งเร็ว ๆ การเขียนครั้งที่สองจะเขียนทับครั้งแรกหายไป)
  return runTransaction(
    db,
    async (tx) => {

      const attendance = attendanceRef ? await tx.get(attendanceRef) : null;
      const snap = await tx.get(ref);

      if (!snap.exists()) throw new Error("STUDENT_NOT_FOUND");
      if (attendanceRef && (!attendance.exists() || attendance.data().rewardEligible !== true)) {
        throw new Error("ATTENDANCE_REWARD_NOT_ELIGIBLE");
      }
      if (attendance?.data().rewardState === "granted") {
        return { ...attendance.data().rewardReceipt,
          inventory: migrateInventory(snap.data().inventory || {}).inventory,
          rewardStats: snap.data().rewardStats || {}, alreadyClaimed: true };
      }
      const prepared = buildStudentRewardUpdate({
        studentData: snap.data(), rewardId, rewardRarity, extras, attendanceId, reward,
      });
      if (prepared.updates) tx.update(ref, prepared.updates);
      if (attendanceRef) tx.update(attendanceRef, {
        rewardState: "granted",
        rewardReceipt: { reward: prepared.result.reward, isNewItem: prepared.result.isNewItem },
      });
      return prepared.result;

    }
  );

}
