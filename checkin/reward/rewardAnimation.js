import {
  delay
} from "./rewardUtils.js";
import { escapeHtml } from "../../shared/textUtils.js";

import {
  buildRewardHTML 
} from "./rewardDom.js";

import {
  $,
  qs
} from "../ui/dom.js"

import {
  hideProgressUI,
  showProgressUI
} from "../ui/progressUI.js"

// รอจนกว่าผู้ใช้จะกดปุ่มยืนยัน
function waitForConfirm() {

  return new Promise(resolve => {

    // ปุ่มยืนยัน
    const btn =
      $("rewardConfirmBtn");

    // ถ้าไม่มีปุ่ม ก็ไปต่อทันที
    if (!btn) {
      resolve();
      return;
    }

    // เมื่อกดปุ่ม
    const handler = () => {

      // ป้องกันการกดซ้ำ
      btn.removeEventListener(
        "click",
        handler
      );

      // ซ่อนปุ่ม
      btn.classList.add(
        "hidden"
      );

      // แจ้งว่าเสร็จแล้ว
      resolve();
    };

    // รอฟังการกดปุ่ม
    btn.addEventListener(
      "click",
      handler
    );

  });

}

export async function showExtraPopup({
  extraDisplay,
  stopRandomAnimation,
  startRandomAnimation,
  setPopupStage
}) {

  // ไม่มีข้อมูล Popup พิเศษ
  if (!extraDisplay) {
    return;
  }

  // เปลี่ยนสถานะเป็น Popup พิเศษ
  setPopupStage("extra");

  // หยุด Animation การสุ่ม
  stopRandomAnimation(
    extraDisplay.emoji
  );

  const btn =
    $("rewardConfirmBtn");

  const loadingBox =
    qs(".loading-box");

  const el =
    $("loadingAnimation");

  const text =
    qs(".loading-text");

  const badge =
    $("rewardBadge");

  const checklist =
    $("checklist");

  const progressBar =
    qs(".progress-bar");

  const progressText =
    $("progressText");

  // Reset UI ของหน้ารางวัล
  badge.classList.add("hidden");
  badge.textContent = "";

  el.removeAttribute(
    "data-rarity"
  );

  // แสดง Emoji ของ Popup พิเศษ
  el.textContent =
    extraDisplay.emoji;

  el.classList.add("change");

  setTimeout(() => {
    el.classList.remove("change");
  }, 400);

  // ขยาย Emoji ให้เด่นขึ้น
  el.style.fontSize = 
    "110px";

  el.style.transform =
    "scale(1.6)";

  el.style.transition =
    "all 0.3s ease";

  // เปลี่ยน UI เป็นโหมด Popup พิเศษ
  hideProgressUI();

  loadingBox?.classList.add(
    "extra-mode"
  );

  // แสดงข้อความของ Popup
  text.innerHTML = `
    <div class="extra-title">
      ${escapeHtml(extraDisplay.title)}
    </div>

    <div class="extra-desc">
      ${escapeHtml(extraDisplay.desc)}
    </div>

    <div class="extra-sub">
      ${escapeHtml(extraDisplay.sub)}
    </div>
  `;

  // เปลี่ยนปุ่มเป็น "รับทราบ"
  btn.textContent = "รับทราบ";

  btn.classList.remove("hidden");

  // รอให้ผู้ใช้กดปุ่ม
  await waitForConfirm();

  // กลับสู่โหมดแสดงรางวัล
  setPopupStage("reward");

  btn.textContent = "ตกลง";

  loadingBox?.classList.remove(
    "extra-mode"
  );

  showProgressUI();

  // คืนค่า Loading UI
  text.innerHTML =
    "🎲 กำลังสุ่มรางวัล...";

  el.style.fontSize = "70px";

  el.style.transform = "";

  // เริ่ม Animation การสุ่มต่อ
  startRandomAnimation();

  await delay(250);

  // Reset Effect
  el.style.transform = "";

}

// แสดงรางวัลที่สุ่มได้
export async function revealRewardBig({
  reward,
  rewardName,
  rewardRarity,
  isNew,
  stopRandomAnimation
}) {

  const el = 
    $("loadingAnimation");

  const text = 
    qs(".loading-text");

  // ไม่มีรางวัล
  if (!reward) 
    return;

  // หยุด Animation ที่รางวัลนี้
  stopRandomAnimation(reward);

  const badge =
    $("rewardBadge");

  // Reset Badge
  badge.classList.add("hidden");

  badge.textContent = "";

  // แสดง Badge NEW
  if (isNew) {

    badge.textContent = "NEW";
    badge.classList.remove("hidden");

  }

  // เล่น Effect ตอนรางวัลโผล่
  el.classList.add("change");

  setTimeout(() => {
    el.classList.remove("change");
  }, 400);

  // ขยาย Emoji ให้เด่น
  el.style.fontSize =
    "110px";

  el.style.transform =
    "scale(1.6)";

  el.style.transition =
    "all 0.3s ease";

  // แสดงข้อมูลรางวัล
  text.innerHTML =
    buildRewardHTML({
      rewardName,
      rewardRarity
    });

  // คืนขนาด Emoji หลัง Effect จบ
  setTimeout(() => {
    el.style.transform = "";
  }, 600);

}
