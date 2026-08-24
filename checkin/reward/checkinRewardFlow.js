import {
  rollReward
} from "./rewardEngine.js";

import {
  updateStudentReward
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
export async function processCheckinReward({
  db,
  studentId,
  studentData,
  extras = [],
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

  const {
    inventory
  } = migrateInventory(
    studentData.inventory
  );

  const rewardResult =
    rollReward({
      badLuckStreak:
        studentData.rewardStats
          ?.badLuckStreak || 0,

      inventory
    });
  
  console.log(rewardResult);
  
  endRollReward.end();

  // =====================================
  // UPDATE FIRESTORE
  // =====================================

  const endUpdateStudentReward = 
    measure("UPDATE_STUDENT_REWARD");

  await updateStudentReward({
    db,
    studentId,
    studentData,
    rewardId: rewardResult.id,
    rewardRarity:
      rewardResult.rarity,
    extras
  });

  endUpdateStudentReward.end();

  // =====================================
  // CHECK NEW ITEM
  // =====================================

  const endCheckNewItem = 
    measure("CHECK_NEW_ITEM");

  const isNewItem =
    !inventory[
      rewardResult.id
    ]

  endCheckNewItem.end();

  // =====================================
  // CLIENT SYNC
  // =====================================

  const endSyncInventory = 
    measure("SYNC_INVENTORY_CLIENT");

  syncInventoryToClient({
    studentData,
    rewardId: rewardResult.id
  });

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