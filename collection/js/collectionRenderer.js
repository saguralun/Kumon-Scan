import { $ } from "../../checkin/ui/dom.js";

import {
  getCollectionProgress,
  getAvailableRewardItems,
  getAllRewardItems,
} from "../../checkin/reward/rewardCollection.js";

import {
  getRarityBadge,
} from "../../checkin/reward/rewardRarity.js";

import {
  openModal,
  openComingSoon,
  openReleaseModal,
} from "./collectionModal.js";

const collapsedSections = new Set();

export function renderCollection(inventory){

  const container = 
    $("collectionContainer");

  container.innerHTML = "";

  updateProgress(inventory);

  const groups = {};

  getAvailableRewardItems().forEach(item => {

    if (!groups[item.type]) {

      groups[item.type] = [];

    }

    groups[item.type].push(item);

  });

  Object.entries(groups)

    .sort((a, b) =>

      b[1].length - a[1].length

    )

    .forEach(([type, items]) => {

    const ownedCount = 
      items.filter(
        item => inventory[item.id]
      ).length;

    const section = 
      document.createElement("div");
      
    const sectionIcon =
      items[0]?.icon ?? "❔";

    section.className = "section";

    section.innerHTML = `
      <div class="section-header">

        <div class="section-title">
          ${sectionIcon} ${capitalize(type)}
        </div>

        <div class="section-right">

          <div class="section-count">

            <span class="owned">
              ${ownedCount}
            </span>

            <span class="slash">
              /
            </span>

            <span class="total">
              ${items.length}
            </span>

          </div>

          <div class="section-arrow open">
            ▸
          </div>

        </div>

      </div>
      <div class="grid"></div>
    `;

    const grid = 
      section.querySelector(".grid");

    const header =
      section.querySelector(".section-header");

    const arrow =
      section.querySelector(".section-arrow");

    header.onclick = () => {

      grid.classList.toggle("collapsed");

      const collapsed =
        grid.classList.contains("collapsed");
    
      arrow.classList.toggle(
        "open",
        !collapsed
      );

      if (collapsed) {
        collapsedSections.add(type);
      } else {
        collapsedSections.delete(type);
      }

    };

    if (collapsedSections.has(type)) {

      grid.classList.add("collapsed");

      section.querySelector(".section-arrow")
        .classList.remove("open");

    }
    
    const rarityOrder = {

      common: 0,
      uncommon: 1,
      rare: 2,
      epic: 3,
      ultra: 4,
      legendary: 5,

    };

    items
      .sort(
        (a, b) =>
          rarityOrder[a.rarity] -
          rarityOrder[b.rarity]
      )
      .forEach(item => {

        grid.appendChild(
          createCard(item, inventory)
        );

      });

        container.appendChild(section);

      });

      renderNext7Days(container);

}

function capitalize(text){

  return text.charAt(0).toUpperCase()

    + text.slice(1);

}

function renderNext7Days(container){

  const today =
    new Date().toLocaleDateString("sv-SE");

  const end = new Date();

  end.setDate(end.getDate() + 7);

  const endString =
    end.toLocaleDateString("sv-SE");

  const upcoming =
    getAllRewardItems()

      .filter(item => {

        if (item.enabled === false)
          return false;

        if (!item.releaseDate)
          return false;

        return (
          item.releaseDate > today &&
          item.releaseDate <= endString
        );

      })

      .sort((a, b) =>
        a.releaseDate.localeCompare(b.releaseDate)
      );

  if (upcoming.length === 0)
    return;

  const section =
    document.createElement("div");

  section.className = "section";

  section.innerHTML = `
    <div class="section-header">

      <div class="section-title">
        📅 Next 7 Days
      </div>

      <div class="section-count">
        ${upcoming.length}
      </div>

    </div>

    <div class="grid"></div>
  `;

  const grid =
    section.querySelector(".grid");

  upcoming.forEach(item => {

    grid.appendChild(
      createUpcomingCard(item)
    );

  });

  container.appendChild(section);

}

function renderComingCollections(container){

  if(COMING_COLLECTIONS.length === 0)
    return;

  const section =
    document.createElement("div");

  section.className = "section";

  section.innerHTML = `
    <div class="section-header">
      <div class="section-title">
        🚀 Coming Soon
      </div>

      <div class="section-count">
        ${COMING_COLLECTIONS.length}
      </div>
    </div>

    <div class="grid"></div>
  `;

  const grid =
    section.querySelector(".grid");

  COMING_COLLECTIONS.forEach(collection => {

    grid.appendChild(
      createComingCard(collection)
    );

  });

  container.appendChild(section);

}

function createCard(item, inventory){

  const owned = 
    inventory[item.id];

  const amount =
    owned || 0;

  const card = 
    document.createElement("div");

  card.className =
    owned
      ? `card ${item.rarity}`
      : "card locked";

  card.innerHTML =
    buildCardHTML(
      item,
      owned,
      amount
    );

  card.onclick = ()=>{

    openModal(
      item,
      owned
    );

  }

  return card;

}

function createUpcomingCard(item){

  const card=document.createElement("div");

  card.className="card locked";

  card.innerHTML=`

    <div class="icon silhouette">
      ${item.icon}
    </div>

    <div class="name">
      ${item.name}
    </div>

    <div class="amount">
      ${item.releaseDate}
    </div>

  `;

  card.onclick=()=>{

    openReleaseModal(item);

  };

  return card;

}

function buildCardHTML(
  item,
  owned,
  amount
){

  return `

    <div class="rarity ${item.rarity}">
      ${getRarityBadge(item.rarity)}
    </div>

    <div class="
      icon
    ">
      ${
        owned
          ? item.icon
          : "❔"
      }
    </div>

    <div class="amount">
      ${
        owned
          ? `x${amount}`
          : "Locked"}
    </div>
  `;

}

function updateProgress(inventory){

  const progress =
    getCollectionProgress(inventory);

  $("progressFill").style.width = 
    progress.percent + "%";

  $("progressText").innerText =
    `${progress.collected} / ${progress.total} Unique Collected (${progress.percent}%)`;

}
