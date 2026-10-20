import {
  doc,
  getDoc,
  getDocFromServer,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { debugLog, logError } from "/shared/index.js";

import { setRewardItems } from "../checkin/reward/rewardItems.js";

import { setRarities } from "../checkin/reward/rewardRarity.js";

import { validateRewardConfig } from "../checkin/reward/rewardConfigValidator.js";

import { $, qs } from "../checkin/ui/dom.js";

export const APP_VERSION = "6.0.5";

const EMPTY_VERSION_DATA = {
  serverVersion: null,
  serverTime: null,
  lastDailyBuildDate: null,
  weekly: null,
  rarities: [],
  rewardItems: [],
  rewardItemsMap: {},
};

export async function checkVersionAndReload(db, { fromServer = false } = {}) {
  const tag = "checkVersionAndReload";

  try {
    const ref = doc(db, "system", "config");

    const snap = await (fromServer ? getDocFromServer(ref) : getDoc(ref));

    if (!snap.exists()) {
      if (fromServer) throw new Error("SYSTEM_CONFIG_NOT_FOUND");
      debugLog(tag, "⚠️ config not found");

      return {
        ...EMPTY_VERSION_DATA,
        ok: true,
        serverTime: null,
        lastDailyBuildDate: null,
        weekly: null,
      };
    }

    const versionData = normalizeSystemConfig(snap.data());

    const { serverVersion } = versionData;

    initializeModules(versionData);

    if (serverVersion == null) {
      debugLog(tag, "⚠️ invalid server version", { serverVersion });

      return {
        ok: true,
        ...versionData,
      };

    }

    if (APP_VERSION !== serverVersion) {
      debugLog(tag, "🔄 version mismatch", {
        APP_VERSION,
        serverVersion,
      });

      const btn = $("rewardConfirmBtn");

      if (btn) {
        btn.innerText = "🔄 รีเฟรชระบบ";

        btn.classList.remove("hidden");

        btn.onclick = () => {
          location.reload();
        };
      }

      $("loadingOverlay")?.classList.remove("hide");

      const text = qs(".loading-text");

      if (text) {
        text.innerHTML = "⚠️ ระบบมีการอัปเดต<br>กรุณารีเฟรช";
      }

      return {
        ok: false,
        ...versionData,
      };
    }

    debugLog(tag, "✅ version up-to-date", {
      version: APP_VERSION,
    });

    return {
      ok: true,
      ...versionData,
    };

  } catch (err) {
    // Check-in must distinguish an unavailable config from a closed school day.
    if (fromServer) throw err;
    console.error(err);

    const isOffline =
      err.code === "unavailable" ||
      err.message?.toLowerCase().includes("offline");

    if (isOffline) {
      debugLog(tag, "🌐 offline - skip version check", {
        currentVersion: APP_VERSION,
      });

      return {
        ok: true,
        ...EMPTY_VERSION_DATA,
      };
    }

    await logError(db, {
      tag,
      message: "version check failed",
      error: err,
      extra: {
        APP_VERSION,
      },
    });

    return {
      ok: true,
      ...EMPTY_VERSION_DATA,
    };
  }
}

function normalizeSystemConfig(data) {

  const {
    appVersion: serverVersion,
    serverTime,
    lastDailyBuildDate,
    weekly,
  } = data;

  const rarities = data.rarities ?? [];

  const rewardItemsMap = data.rewardItems ?? {};

  const rewardItems = Object.entries(rewardItemsMap).map(([id, item]) => ({
    ...item,
    id,
  }));

  return {
    serverVersion,
    serverTime,
    lastDailyBuildDate,
    weekly,
    rarities,
    rewardItems,
    rewardItemsMap,
  };
}

function initializeModules(config) {

  setRarities(config.rarities);

  const valid = [];
  for (const item of config.rewardItems) {
    try {
      validateRewardConfig({ rewardItems: [item], rarities: config.rarities });
      valid.push(item);
    } catch (error) {
      console.warn("Ignoring invalid reward item", { id: item.id, message: error.message });
    }
  }
  config.rewardItems = valid;
  config.rewardItemsMap = Object.fromEntries(valid.map(item => [item.id, item]));

  setRewardItems(config.rewardItems);

}
