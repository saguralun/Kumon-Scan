
export function validateRewardItem(item, rarityIds = null) {
  if (!item || typeof item !== "object") throw new Error("INVALID_REWARD_ITEM");
  for (const field of ["id", "type", "rarity", "icon", "name"]) {
    if (typeof item[field] !== "string" || !item[field].trim()) {
      throw new Error(`MISSING_${field.toUpperCase()} ${item.id || ""}`);
    }
  }
  if (!/^[A-Za-z0-9_-]+$/.test(item.id)) throw new Error(`INVALID_ITEM_ID ${item.id}`);
  if (rarityIds && !rarityIds.has(item.rarity)) throw new Error(`INVALID_RARITY ${item.id}`);
  if (item.releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(item.releaseDate)) {
    throw new Error(`INVALID_RELEASE_DATE ${item.id}`);
  }
}

export function validateRewardConfig({
	rewardItems,
	rarities
}) {

	const rarityIds =
		new Set(
			rarities.map(r => r.id)
		);
	
	const ids = new Set();

	for (const item of rewardItems) {

    validateRewardItem(item, rarityIds);

		if (ids.has(item.id)) {
			throw new Error(`DUPLICATE_ITEM_ID ${item.id}`);
		}

		ids.add(item.id);

		if (!rarityIds.has(item.rarity)) {
			throw new Error(`INVALID_RARITY ${item.id}`);
		}

	}

}
