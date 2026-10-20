
import { 
  $ 
} from "../../checkin/ui/dom.js";
import { escapeHtml } from "../../shared/textUtils.js";

export function openModal(
  item,
  owned
){

  const modal =
    $("modal");

  $("modalIcon").classList.remove("silhouette");
  
  $("modalIcon").innerText =
    owned
      ? item.icon
      : "❔";

  $("modalTitle").innerText =
    owned
      ? item.name
      : "Unknown Item";

  $("modalDetail").innerHTML =
    owned
      ? `
        <div class="modal-row">
          ⭐ Rarity: ${escapeHtml(item.rarity)}
        </div>

        <div class="modal-row">
          📦 Collected: ${escapeHtml(owned)} ครั้ง
        </div>
      `
      : `
        🔒 ยังไม่ได้ค้นพบไอคอนนี้
      `;

  modal.classList.add("show");

}

export function openReleaseModal(item){

  $("modalIcon").innerText = item.icon;

  // ทำเป็นเงา
  $("modalIcon").classList.add("silhouette");

  $("modalTitle").innerText = item.name;

  $("modalDetail").innerHTML = `

    <div class="modal-row">
      ⭐ ${escapeHtml(item.rarity)}
    </div>

    <div class="modal-row">
      📅 Release
    </div>

    <div class="modal-heading">
      ${escapeHtml(item.releaseDate)}
    </div>

  `;

  $("modal").classList.add("show");

}

export function openComingSoon(
  collection
){

  const preview =
    collection.preview;

  $("modalIcon").innerText =
    collection.icon;

  $("modalTitle").innerText =
    collection.title;

  $("modalDetail").innerHTML = `

    <div class="modal-heading">
      🚀 Coming Soon
    </div>

    <br>

    ${escapeHtml(collection.description)}

    <br><br>

    📅 ${escapeHtml(collection.releaseDate)}

    <br><br>

    ${escapeHtml(collection.message)}

  `;

  $("modal")
    .classList
    .add("show");

}

export function closeModal(){

  $("modal")
    .classList
    .remove("show");

}
