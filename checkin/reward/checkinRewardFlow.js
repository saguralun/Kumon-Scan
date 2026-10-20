import {
  rollReward
} from "./rewardEngine.js";

import {
  updateStudentReward,
  buildStudentRewardUpdate,
} from "./rewardService.js";

import {
  revealRewardBig
} from "./rewardAnimation.js";

import {
  migrateInventory
} from "./inventoryMigration.js";

import { 
	debugLog, 
	logError,
  measure 
} from "/shared/index.js";

// จัดการขั้นตอนทั้งหมดของระบบรางวัลหลังเช็กอิน
// ตั้งแต่สุ่มรางวัล บันทึกข้อมูล ซิงก์ข้อมูล ไปจนถึงแสดงผลบนหน้าจอ
export function prepareCheckinReward({ studentData, extras = [], attendanceId = null }) {
  const previous = attendanceId && studentData.rewardReceipt?.attendanceId === attendanceId
    ? studentData.rewardReceipt.reward : null;
  const rolled = previous || rollReward({
    badLuckStreak: studentData.rewardStats?.badLuckStreak || 0,
    inventory: migrateInventory(studentData.inventory || {}).inventory,
  });
  return buildStudentRewardUpdate({
    studentData, extras, attendanceId, rewardId: rolled.id, rewardRarity: rolled.rarity,
    reward: {
      id: rolled.id, name: rolled.name, icon: rolled.icon || rolled.emoji,
      rarity: rolled.rarity, type: rolled.type,
    },
  });
}

export async function processCheckinReward({
  db,
  studentId,
  studentData,
  extras = [],
  attendanceId = null,
  savedReward = null,
  stopRandomAnimation
}) {
  const tag = "processCheckinReward";
  const endTotalProcessReward = 
    measure("TOTAL_PROCESS_REWARD");

  // =====================================
  // ROLL REWARD
  // =====================================

  const endRollReward = 
    measure("ROLL_REWARD");

  const proposal = savedReward ? null : prepareCheckinReward({ studentData, extras, attendanceId });
  
  endRollReward.end();

  // =====================================
  // UPDATE FIRESTORE
  // =====================================

  const endUpdateStudentReward = 
    measure("UPDATE_STUDENT_REWARD");

  const saved = savedReward || await updateStudentReward({
    db,
    studentId,
    studentData,
    rewardId: proposal.result.reward.id,
    rewardRarity:
      proposal.result.reward.rarity,
    extras,
    attendanceId,
    reward: proposal.result.reward,
  });

  const rewardResult = { ...saved.reward, emoji: saved.reward.icon };

  endUpdateStudentReward.end();

  // =====================================
  // CHECK NEW ITEM
  // =====================================

  const endCheckNewItem = 
    measure("CHECK_NEW_ITEM");

  const isNewItem = saved.isNewItem;

  endCheckNewItem.end();

  // =====================================
  // CLIENT SYNC
  // =====================================

  const endSyncInventory = 
    measure("SYNC_INVENTORY_CLIENT");

  studentData.inventory = saved.inventory;
  studentData.rewardStats = saved.rewardStats;
  if (attendanceId) {
    studentData.rewardReceipt = { attendanceId, reward: saved.reward, isNewItem };
  }

  endSyncInventory.end();

  // =====================================
  // REVEAL UI
  // =====================================

  const endRevealRewardBig = 
    measure("REVEAL_REWARD_BIG");

  await revealRewardBig({
    reward: rewardResult.emoji,
    rewardName: rewardResult.name,
    rewardRarity: rewardResult.rarity,
    isNew: isNewItem,
    stopRandomAnimation
  });

  endRevealRewardBig.end();

  // =====================================
  // TOTAL
  // =====================================

  endTotalProcessReward.end();

  return {
    rewardResult,
    isNewItem
  };

}

function syncInventoryToClient({
  studentData,
  rewardId
}){

  const {
    inventory
  } = migrateInventory(
    studentData.inventory
  );

  studentData.inventory =
    inventory;

  studentData.inventory[rewardId] =
    (studentData.inventory[rewardId] || 0) + 1;

  console.log(
    "🧠 CLIENT INVENTORY SYNCED",
    rewardId
  );
}
