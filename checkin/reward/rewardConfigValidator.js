
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

		if (ids.has(item.id)) {
			throw new Error(`DUPLICATE_ITEM_ID ${item.id}`);
		}

		ids.add(item.id);

		if (!rarityIds.has(item.rarity)) {
			throw new Error(`INVALID_RARITY ${item.id}`);
		}

	}

}