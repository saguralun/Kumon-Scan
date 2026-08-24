
export function getRarityStyle(rarity){

  switch(rarity){

    case "common":
      return `
        background:#2d2d2d;
        color:white;
      `;

    case "uncommon":
      return `
        background:
          linear-gradient(
            135deg,
            #22c55e,
            #16a34a
          );

        color:white;

        box-shadow:
          0 4px 14px rgba(34,197,94,.35);
      `;

    case "rare":
      return `
        background:
          linear-gradient(
            135deg,
            #38bdf8,
            #2563eb
          );

        color:white;

        box-shadow:
          0 4px 14px rgba(59,130,246,.35);
      `;

    case "epic":
      return `
        background:
          linear-gradient(
            135deg,
            #c084fc,
            #7c3aed
          );

        color:white;

        box-shadow:
          0 4px 18px rgba(124,58,237,.4);
      `;

    case "ultra":
      return `
        background:
          linear-gradient(
            135deg,
            #fde047,
            #f59e0b
          );

        color:white;

        box-shadow:
          0 4px 20px rgba(245,158,11,.45);
      `;

    case "legendary":
      return `
        background:
          linear-gradient(
            135deg,
            #ff4d6d,
            #ffbe0b,
            #8338ec
          );

        background-size:200% 200%;

        color:white;

        animation:
          legendaryFlow 3s linear infinite;

        box-shadow:
          0 4px 24px rgba(255,100,100,.45);
      `;

    case "coming":
      return `
        background:
          linear-gradient(
            135deg,
            #0ea5e9,
            #06b6d4
          );

        color:white;

        box-shadow:
          0 4px 14px rgba(6,182,212,.35);
      `;

    default:
      return `
        background:#444;
        color:white;
      `;
  }
}

export function buildRewardHTML({
  rewardName,
  rewardRarity
}){

  return `
    <div class="reward-result">

      <div class="reward-title">
        🎉 คุณได้รับ
      </div>

      <div class="reward-name">
        ${rewardName || "Unknown"}
      </div>

      <div class="reward-badges">

        <div
          class="reward-rarity"
          style="${getRarityStyle(rewardRarity)}"
        >
          ${rewardRarity || "Unknown"}
        </div>

      </div>

    </div>
  `;

}