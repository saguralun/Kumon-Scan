import {
  getAvailableRewardItems
} from "./rewardCollection.js";

import {
  RARITY,
} from "./rewardRarity.js";

import {
  randomPick
} from "./rewardUtils.js";

import { 
	debugLog,
} from "/shared/index.js";

const NEW_ITEM_CHANCE = 0.8;

const MAX_BAD_LUCK_STREAK = 10;

const BAD_LUCK_BONUS = {

  common: -3,
  uncommon: -2,
  rare: -1,
  epic: 3,
  ultra: 2,
  legendary: 1

};

// สุ่มระดับความหายาก (Rarity)
// โดยปรับ Weight ตาม Bad Luck Streak
// เมื่อสะสม Bad Luck มากขึ้น
// โอกาสออก Common จะลดลง
// และโอกาสออก Epic ขึ้นไปจะเพิ่มขึ้น
function rollRarity(
  badLuckStreak = 0
) {

  const streak =
    Math.min(
      badLuckStreak,
      MAX_BAD_LUCK_STREAK
    );
  
  // สร้างตาราง Weight สำหรับการสุ่ม
  // โดยนำ Weight พื้นฐานของแต่ละ Rarity
  // มาปรับตามค่า Bad Luck
  const rarityTable =
    Object.values(RARITY)
      .filter(
        rarity =>
          rarity.weight > 0
      )
      .map(
        rarity => ({

          id: rarity.id,

          // ป้องกัน Weight ติดลบ
          // อย่างน้อยทุก Rarity ยังมีโอกาสออกเสมอ
          weight:
            Math.max(
              1,
              rarity.weight +
              (
                BAD_LUCK_BONUS[
                  rarity.id
                ] ?? 0
              ) * streak
            )

        })
      );

  if (rarityTable.length === 0) {
    throw new Error("NO_ACTIVE_RARITIES");
  }
    
  // รวม Weight ทั้งหมด
  // เพื่อคำนวณโอกาสสุ่มของแต่ละ Rarity
  const totalWeight =
    rarityTable.reduce(
      (sum, rarity) =>
        sum + rarity.weight,
      0
    );

  console.group("🟦 [RARITY TABLE]");

  console.table(
    rarityTable.map(r => ({
      rarity: r.id,
      weight: r.weight,
      chance:
        (
          r.weight /
          totalWeight *
          100
        ).toFixed(2) + "%"
    }))
  );

  console.groupEnd();

  let cumulative = 0;

  const r = Math.random();

  debugLog(
    "RARITY ROLL",
    {
      badLuckStreak,
      random: r.toFixed(5)
    }
  );

  // สุ่มตาม Weight
  // โดยสะสม Probability ไปเรื่อย ๆ
  // จนเจอช่วงที่เลขสุ่มตกอยู่
  const debugRanges = [];

  for (const rarity of rarityTable) {

    const before =
      cumulative;

    cumulative +=
      rarity.weight /
      totalWeight;

    debugRanges.push({

      rarity:
        rarity.id,

      from:
        before.toFixed(5),

      to:
        cumulative.toFixed(5)

    });

    if (r < cumulative) {

      debugLog(
        "RARITY RANGE",
        debugRanges
      );

      debugLog(
        "RARITY RESULT",
        {

          badLuckStreak,

          random:
            r.toFixed(5),

          result:
            rarity.id,

          cumulative:
            cumulative.toFixed(5)

        }
      );

      return rarity.id;

    }

  }

  // ป้องกันกรณีผิดพลาด
  // ปกติไม่ควรมาถึงจุดนี้  
  return "common";

}

// คืนเฉพาะ Item ที่ตรงกับ Rarity ที่สุ่มได้
function getAvailableItemsByRarity(
  items,
  rarity
){

  return items.filter(
    item =>
      item.rarity === rarity
  );

}

// เลือก Item ที่ยังไม่เคยได้รับก่อน (ถ้ามี)
function getPreferredItems(
  items,
  inventory = {}
){

  const newItems =
    items.filter(
      item => !inventory[item.id]
    );

  if (newItems.length === 0) {
    return {
      selectionMode: "ALL_ITEMS (COMPLETE)",
      candidates: items
    };
  }

  const useNewItems =
    Math.random() < NEW_ITEM_CHANCE;

  return {
    selectionMode: useNewItems
      ? "NEW_ITEMS"
      : "ALL_ITEMS",

    candidates: useNewItems
      ? newItems
      : items
  };

}

// สุ่ม Reward 1 ชิ้นตามระบบ Rarity และ Bad Luck
export function rollReward({
  badLuckStreak = 0,
  inventory = {}
} = {}) {

  const rarity =
    rollRarity(
      badLuckStreak
    );

  const items =
    getAvailableRewardItems();

  if (items.length === 0) {
    throw new Error("NO_REWARD_ITEMS_AVAILABLE");
  }

  const rarityItems =
    getAvailableItemsByRarity(
      items,
      rarity
    );

  let candidatePool =
    rarityItems;

  if (candidatePool.length === 0) {
    console.warn(
      "No reward item for rolled rarity, falling back to any released item",
      { rarity }
    );

    candidatePool =
      items;
  }

  const {
    selectionMode,
    candidates
  } = getPreferredItems(
    candidatePool,
    inventory
  );

  const item =
    randomPick(
      candidates
    );
  
  debugLog("ROLL", {

    badLuckStreak,

    rolledRarity: rarity,

    availableItems:
      candidatePool.map(i => i.id),

    ownedItems:
      candidatePool
        .filter(i => inventory[i.id])
        .map(i => i.id),

    selectionMode,

    newItems:
      candidatePool
        .filter(i => !inventory[i.id])
        .map(i => i.id),

    candidateItems:
      candidates.map(i => i.id),

    selectedItem: {
      id: item.id,
      name: item.name,
      rarity: item.rarity,
      icon: item.icon
    }

  });

  return {

    ...item,

    emoji: item.icon

  };

}

// =====================================
// Reward Test Lab
// =====================================
export function simulateRewardEngine(
  rolls = 1000
) {

  const rarityCount = {};

  Object.values(RARITY).forEach(r => {
    if (r.weight > 0) {
      rarityCount[r.id] = 0;
    }
  });

  let badLuck = 0;
  let highestBadLuck = 0;

  for (let i = 0; i < rolls; i++) {

    const reward = rollReward({
      badLuckStreak: badLuck,
      inventory: {}
    });

    rarityCount[reward.rarity]++;

    if (
      reward.rarity === "common" ||
      reward.rarity === "uncommon"
    ) {

      badLuck++;

      highestBadLuck = Math.max(
        highestBadLuck,
        badLuck
      );

    } else {

      badLuck = 0;

    }

  }

  console.clear();

  console.log(`🎲 Reward Simulation (${rolls} rolls)`);

  console.table(
    Object.entries(rarityCount).map(([rarity, count]) => ({
      rarity,
      count,
      percent: (
        count / rolls * 100
      ).toFixed(2) + "%"
    }))
  );

  console.log(
    "Highest Bad Luck :",
    highestBadLuck
  );

}
