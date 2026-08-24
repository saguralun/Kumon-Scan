
import {
  getRewardItems
} from "./rewardItems.js";

import {
  RARITY_MAP
} from "./rewardRarity.js";


export const REWARD_COLLECTIONS = [

  { key: 1,
    type: "animal",
    icon: "🐻",
    category: "Animals",
    enabled: true,
  },

  { key: 2,
    type: "nature",
    icon: "🌵",
    category: "Nature",
    enabled: true,
  },

  { key: 3,
    type: "bug",
    icon: "🐞",
    category: "Bug",
    enabled: true,
  },

  { key: 4,
    type: "bird",
    icon: "🐦",
    category: "Bird",
    enabled: true,
  },

  { key: 5,
    type: "sea",
    icon: "🌊",
    category: "Sea",
    enabled: true,
  },

  { key: 51,
    type: "sweet",
    icon: "🍭",
    category: "Sweet",
    enabled: true,
  },

  { key: 52,
    type: "fun",
    icon: "🎈",
    category: "Fun",
    enabled: true,
  },

  { key: 53,
    type: "magic",
    icon: "⭐",
    category: "Magic",
    enabled: true,
  },

  { key: 54,
    type: "vehicle",
    icon: "🚕",
    category: "Vehicle",
    enabled: true,
  },
 
  { key: 55,
    type: "sport",
    icon: "⚽",
    category: "Sport",
    enabled: true,
  },

  { key: 100,
    type: "dinosaur",
    icon: "🦖",
    category: "Dinosaur",
    enabled: true,
  },

  { key: 101,
    type: "fantasy",
    icon: "🦄",
    category: "Fantasy",
    enabled: true,
  },

  { key: 151,
    type: "ultra rare",
    icon: "🔮",
    category: "Ultra",
    enabled: true,
  },

  { key: 200,
    type: "legendary",
    icon: "👑",
    category: "Legendary",
    enabled: true,
  },

];

export function getAllRewardItems() {

  return getRewardItems();

}

export function getAvailableRewardItems() {

  return getRewardItems().filter(
    isItemReleased
  );
}

// Map สำหรับค้นหา Collection จาก type ได้รวดเร็ว
// นำไปสร้างเป็น render cards ต่อ
export const COLLECTION_MAP =
  Object.fromEntries(

    REWARD_COLLECTIONS.map(
      c=>[
        c.type,
        c
      ]
    )

  );

function isItemReleased(item) {

  // Event หรือปิดชั่วคราว
  if (item.enabled === false)
    return false;

  // ไม่มีวันปล่อย = ยังไม่เปิด
  if (!item.releaseDate)
    return false;

  const today =
    new Date().toLocaleDateString("sv-SE");

  return item.releaseDate <= today;

}

// คืนเฉพาะ Emoji ของ Item ที่ "เปิดใช้งานแล้ว"
// ใช้สำหรับ Animation สุ่มรางวัลบนหน้าจอ
export function getAvailableRewardEmojis() {

  const emojis =
    getAvailableRewardItems()
      .map(item => item.icon);

  return emojis.length
    ? emojis
    : ["🎁"];

}

// คำนวณความคืบหน้าการสะสม Collection
// โดยนับเฉพาะ Item ที่เปิดใช้งานแล้ว (Released)
// แล้วเปรียบเทียบกับ Item ที่ผู้เล่นมีใน Inventory
export function getCollectionProgress(inventory){

  const items =
    getAvailableRewardItems();

  const collected =
    items.filter(
      item => (inventory[item.id] ?? 0) > 0
    ).length;

  const percent =
    items.length
      ? Math.floor(
          collected / items.length * 100
        )
      : 0;

  return {

    total: items.length,

    collected,

    percent

  };

}
