import { checkVersionAndReload, getTodayThai, getTodayWeekday } from "/shared/index.js";
import {
  loadTodaySettingCache, saveTodaySettingCache, clearTodaySettingCache, saveSystemConfig,
} from "./storage.js";
import { isValidTodaySetting } from "./settings.js";

export function createCheckinConfigRefresher({ db, onConfig = () => {}, readConfig = read => read() }) {
  let pending = null;
  let needsRefresh = true;
  let currentSetting = null;

  function refresh() {
    // Wake-up events and a simultaneous scan share the same server read.
    if (pending) return pending;
    needsRefresh = true;
    pending = (async () => {
      try {
        const config = await readConfig(() => checkVersionAndReload(db, { fromServer: true }));
        if (!config.ok) {
          throw Object.assign(new Error("CONFIG_VERSION_MISMATCH"), { code: "config/version-mismatch" });
        }
        const setting = config.weekly?.[getTodayWeekday()];
        if (!isValidTodaySetting(setting)) throw new Error("TODAY_SETTING_INVALID");

        currentSetting = { ...setting, cacheDate: getTodayThai() };
        saveSystemConfig(config);
        saveTodaySettingCache(currentSetting);
        onConfig(config, currentSetting);
        needsRefresh = false;
        return config;
      } catch (error) {
        currentSetting = null;
        clearTodaySettingCache();
        throw error;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  async function getTodaySetting() {
    if (pending) await pending;
    if (needsRefresh || currentSetting?.cacheDate !== getTodayThai() ||
        !isValidTodaySetting(loadTodaySettingCache())) {
      await refresh();
    }
    return currentSetting;
  }

  return { refresh, getTodaySetting, invalidate() { needsRefresh = true; } };
}
