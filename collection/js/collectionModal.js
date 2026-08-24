
import { 
  $ 
} from "../../checkin/ui/dom.js";

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
          ⭐ Rarity: ${item.rarity}
        </div>

        <div class="modal-row">
          📦 Collected: ${owned} ครั้ง
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
      ⭐ ${item.rarity}
    </div>

    <div class="modal-row">
      📅 Release
    </div>

    <div class="modal-heading">
      ${item.releaseDate}
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

    ${collection.description}

    <br><br>

    📅 ${collection.releaseDate}

    <br><br>

    ${collection.message}

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