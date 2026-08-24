export let RARITY = {};

export let RARITY_MAP = {};

export function setRarities(rarities = []) {

  RARITY = Object.fromEntries(
    rarities.map(r => [
      r.id.toUpperCase(),
      r
    ])
  );

  RARITY_MAP = Object.fromEntries(
    rarities.map(r => [
      r.id,
      r
    ])
  );

}

export const getRarity =
  rarityId => RARITY_MAP[rarityId];

export const getRarityBadge =
  rarityId => RARITY_MAP[rarityId]?.badge ?? "?";