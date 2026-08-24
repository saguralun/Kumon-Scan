
import {
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const LEGACY_INVENTORY_MAP = {

  animal_0: "bear",
  animal_1: "cat",
  animal_2: "dog",
  animal_3: "panda",
  animal_4: "frog",
  animal_5: "fox",
  animal_6: "monkey",
  animal_7: "tiger",

  animal_8: "rabbit",
  animal_9: "koala",
  animal_10: "hamster",     
  animal_11: "pig", 
  animal_12: "cow", 
  animal_13: "chick", 
  animal_14: "penguin", 
  animal_15: "unicorn",
   
  animal_16: "turtle", 
  animal_17: "octopus", 
  animal_18: "dolphin", 
  animal_19: "dinosaur", 
  animal_20: "t_rex", 
  animal_21: "bee", 
  animal_22: "butterfly",
  animal_23: "ladybug", 

  nature_0: "cactus", 
  nature_1: "palm_tree", 
  nature_2: "cherry_blossom", 
  nature_3: "sunflower", 
  nature_4: "clover", 
  nature_5: "mushroom", 
  nature_6: "plant", 
  nature_7: "volcano", 

  sweet_0: "lollipop", 
  sweet_1: "donut", 
  sweet_2: "cookie", 
  sweet_3: "cupcake", 
  sweet_4: "chocolate", 
  sweet_5: "cake", 
  sweet_6: "ice_cream", 
  sweet_7: "strawberry", 

  fun_0: "balloon", 
  fun_1: "party_popper", 
  fun_2: "gift_box", 
  fun_3: "game_controller", 
  fun_4: "yo_yo", 
  fun_5: "teddy_bear", 
  fun_6: "rocket", 
  fun_7: "car", 

  magic_0: "star", 
  magic_1: "sparkles", 
  magic_2: "glowing_star", 
  magic_3: "dizzy_star", 
  magic_4: "rainbow", 
  magic_5: "sun", 
  magic_6: "moon", 
  magic_7: "lightning", 

  ultra_0: "crystal_ball",
  ultra_1: "diamond", 

  legendary_0: "crown",
  legendary_1: "ring",

};

export function migrateInventory(
  inventory = {}
) {

  const migrated = {};
  const legacyDeletes = {};

  for (const [key, value] of Object.entries(inventory)) {

    const newId = 
      LEGACY_INVENTORY_MAP[key];

    if (newId) {

      migrated[newId] =
        (migrated[newId] || 0) +
        (value?.count || 0);

      legacyDeletes[`inventory.${key}`] =
        deleteField();

      continue;

    }
        // รูปแบบใหม่อยู่แล้ว
    if (typeof value === "number") {

      migrated[key] =
        (migrated[key] || 0) +
        value;

    }
    
  }

  return {
    inventory: migrated,

    legacyDeletes,

    migratedLegacy:
      Object.keys(
        legacyDeletes
      ).length > 0
  };

}
