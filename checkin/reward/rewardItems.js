let rewardItems = [];

export function setRewardItems(items = []) {
    validateRewardItems(items);
    rewardItems = items;
}

export function getRewardItems() {
  return rewardItems;
}

// ตรวจสอบความถูกต้องของข้อมูล Reward Item
export function validateRewardItems(items) {

  for (const item of items) {

    if (!item.id)
      throw new Error("MISSING_ID");

    if (!item.type)
      throw new Error(
        `MISSING_TYPE ${item.id}`
      );

    if (!item.rarity)
      throw new Error(
        `MISSING_RARITY ${item.id}`
      );

    if (!item.icon)
      throw new Error(
        `MISSING_ICON ${item.id}`
      );

    if (!item.name)
      throw new Error(
        `MISSING_NAME ${item.id}`
      );

  }

}
