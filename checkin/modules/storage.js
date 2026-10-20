import { getTodayThai } from "/shared/index.js";

function loadCache(key) {

  try {
    const raw = sessionStorage.getItem(key);

    if (!raw) return null;

    return JSON.parse(raw);
  } catch (e) {
    console.error(`load ${key} fail`, e);
    return null;
  }
  
}

function saveCache(key, data) {

  sessionStorage.setItem(
    key,
    JSON.stringify(data),
  );

}

function clearCache(key) {

  sessionStorage.removeItem(key);

}

function loadTodayCache(key) {

  const parsed = loadCache(key);

  if (!parsed) return null;

  if (parsed.cacheDate !== getTodayThai()) {
    clearCache(key);
    return null;
  }

  return parsed;

}

// ======================
// Daily Build Cache
// ======================

export function loadBuildStatusCache() {

  const parsed = loadTodayCache("dailyBuildStatus");

  if (!parsed) return null;

  return parsed?.built === true 
    ? parsed 
    : null;

}

export function saveBuildStatusCache(metadata = {}) {

  saveCache("dailyBuildStatus", {
    cacheDate: getTodayThai(),
    built: true,
    ...metadata,
  });

}

export function clearBuildStatusCache() {

  clearCache("dailyBuildStatus");

}

// ======================
// Today Setting Cache
// ======================


export function loadTodaySettingCache() {
    return loadTodayCache("cachedTodaySetting");
}

export function saveTodaySettingCache(data) {
  saveCache("cachedTodaySetting", data);
}

export function clearTodaySettingCache() {
  clearCache("cachedTodaySetting");
}

// ======================
// Student Session
// ======================

export function saveStudentSession(studentId, studentData) {
  saveCache("currentStudentId", studentId);

  saveCache(
    "studentInventory",
    studentData.inventory || {},
  );

  saveCache("studentProfile", {
    nickname: studentData.nickname || "",
    firstName: studentData.firstName || "",
    subject: studentData.subject || "",
  });
}

export function loadStudentSession() {
  return {
    studentId: loadCache("currentStudentId"),
    inventory: loadCache("studentInventory"),
    profile: loadCache("studentProfile"),
  };
}

export function clearStudentSession() {
  clearCache("currentStudentId");
  clearCache("studentInventory");
  clearCache("studentProfile");
}

export function hasStudentSession() {
  return !!loadCache("currentStudentId");
}

export function clearAllCache() {
  clearBuildStatusCache();
  clearTodaySettingCache();
  clearStudentSession();
}

// ======================
// System Config Session
// ======================

export function saveSystemConfig(config) {
  saveCache("systemConfig", config);
}

export function loadSystemConfig() {
  return loadCache("systemConfig");
}

export function clearSystemConfig() {
  clearCache("systemConfig");
}
