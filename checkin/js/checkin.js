import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  enableNetwork,
  disableNetwork,
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
  collectionGroup,
  query,
  where,
  writeBatch,
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- 2. Shared Utilities ---
import {
  APP_VERSION,
  logError,
  debugLog,
  measure,
  checkVersionAndReload,
  getTodayThai,
  getTodayWeekday,
  formatToSlotKey,
  moveToCheckinSchedule,
  getDiffMinutes,
  formatFirestoreTime,
  getActiveStudent,
  studentUpdateWeeklyPlan,
  moveToCompletedSchedule,
  processAttendance,
  handleAttendanceResult,
  processCheckinSuccess,
  handleStudentResult,
  getTimeDiffMinutes,
  refreshServerTime,
  MAX_SERVER_TIME_AGE_MINUTES,
  escapeHtml,
} from "/shared/index.js";

import {
  ensureDailyScheduleBuilt
} from "../modules/dailyBuild.js";

import {
  loadTodaySettingCache,
  saveTodaySettingCache,
  saveStudentSession,
  hasStudentSession,
  clearAllCache,
  loadSystemConfig, 
  saveSystemConfig
} from "../modules/storage.js";

import {
  checkTodayAndTime,
} from "../modules/settings.js";

import {
  setRarities
} from "../reward/rewardRarity.js";

import { $, qs } from "../ui/dom.js";
import * as progressUI from "../ui/progressUI.js";
import * as statusUI from "../ui/statusUI.js";
import * as audio from "../audio/audio.js";
import * as reward from "../reward/index.js";

const firebaseConfig = {
  apiKey: "AIzaSyBfJ9F94tdUw6sIY8ffUPV0AKxXWzZig8s",
  authDomain: "scan-qrcode-kumon.firebaseapp.com",
  projectId: "scan-qrcode-kumon",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const MAX_LENGTH = 5; // ความยาวสูงสุดของรหัสนักเรียน (ปรับตามจริง)
const logoEl = $("adminLogo")
const DEV_MODE =
  location.hostname === "localhost" ||
  //location.hostname === "127.0.0.1" ||
  location.hostname.startsWith("192.168");
const MOCK_IDS = ["512"];

window.reward = reward;

let cachedTodaySetting = null;
let currentInput = "";
let isProcessing = false;
let studentData;
let adminTimer;
let animationInterval = null;
let checkinSuccess = false;
let popupStage = "reward";

window.submitID = async function () {

  if (reloadIfDateChanged()) {
    return;
  }
  const tag = "submitID";
  const studentId = currentInput;
  const today = getTodayThai();

  checkinSuccess = false;

  if (DEV_MODE && isMockUser(currentInput)) {
    console.log("🚧 DEV MODE: skip server");

    setUIProcessing(true);

    // fake progress เหมือนของจริง
    progressUI.updateProgress(
      "checkTime"
    );
    await reward.delay(100);

    progressUI.updateProgress(
      "loadStudent"
    );
    await reward.delay(100);

    progressUI.updateProgress(
      "attendance"
    );
    await reward.delay(100);

    progressUI.updateProgress(
      "processing"
    );
    await reward.delay(100);

    progressUI.updateProgress(
      "saveData"
    );
    await reward.delay(100);

    const fakeStudent = mockStudent(currentInput);
    studentData = fakeStudent;

    const oldSnap = await getDoc(doc(db, "students", studentId));

    if (oldSnap.exists()) {
      const oldData = oldSnap.data();

      Object.assign(fakeStudent.inventory, oldData.inventory || {});

      fakeStudent.rewardStats = oldData.rewardStats || {};
    }

    const extraDisplay = getExtraDisplay(fakeStudent.extras || []);

    const extras = fakeStudent.extras || [];

    if (extraDisplay) {
      await reward.showExtraPopup({
        extraDisplay,
        stopRandomAnimation,
        startRandomAnimation,
        setPopupStage: (stage) => {
          popupStage = stage;
        },
      });
    }

    await reward.processCheckinReward({
      db,
      studentId,
      studentData,
      extras,
      stopRandomAnimation,
    });

    progressUI.updateProgress("done");

    qs(".progress-bar").style.display = "none";

    $("progressText").style.display = "none";

    $("rewardConfirmBtn").classList.remove("hidden");

    $("collectionLinkWrapper").style.display = "flex";

    saveStudentSession(studentId, studentData);

    statusUI.showSuccess(
      `DEV MODE<br>
      ${escapeHtml(fakeStudent.firstName)} ${escapeHtml(fakeStudent.lastName)} (${escapeHtml(fakeStudent.nickname)})<br>
      ✔ จำลองเช็คอินสำเร็จ`,
    );
    checkinSuccess = true;

    return; // 🔥 สำคัญมาก ตัด flow จริง

  }

  // 1. กันเบิ้ลระดับ Protocol ก่อนเลย
  if (isProcessing) return; // 1. กันเบิ้ลระดับ Protocol ก่อนเลย
  const valid = validateInput();
  // 2. เช็คความพร้อม
  if (!valid.valid) return statusUI.showError(valid.msg);
  debugLog(tag, "START submitID");

  const endTotalProcess = 
    measure("TOTAL_PROCESS");

  try {

    // 2. เริ่มประมวลผล: ล็อก UI ทันทีเพื่อป้องกันการกดซ้ำ และแสดงสถานะกำลังประมวลผล
    setUIProcessing(true);

    // Step 1: ตรวจสอบเวลา
    progressUI.updateProgress(
      "checkTime"
    );

    const endCheckTodayTime =
      measure("CHECK_TODAY_TIME");

    const todaySetting = 
      await checkTodayAndTime();

    endCheckTodayTime.end();

    if (!todaySetting) return;

    const endGetStudentTime = 
      measure("GET_STUDENT");

    // Step 2: ค้นหารายชื่อ
    progressUI.updateProgress(
      "loadStudent"
    );

    const dataResult = 
      await getActiveStudent(db, 
        studentId
      );

    endGetStudentTime.end();  

    const studentResult =
      handleStudentResult({
        dataResult,
        statusUI
      });

    if (!studentResult.canContinue) {
      return;
    }

    studentData =
      studentResult.studentData;  

    debugLog(tag, "GET_STUDENT_RESULT", dataResult);

    const attendanceResult =
      await processAttendance({
        db,
        studentId,
        studentData,
        today
      });

    const canContinue =
      handleAttendanceResult({
        attendanceResult,
        studentData,
        statusUI,
        audio
      });

    if (!canContinue) {
      return;
    }

    const successResult =
      await processCheckinSuccess({
        db,
        today,
        studentId,
        studentData,
        attendance:
          attendanceResult.attendance
      });


    const extras =
      successResult.extras || [];

    const extraDisplay =
      getExtraDisplay(extras);

    if (extraDisplay) {

        await reward.showExtraPopup({
          extraDisplay,
          stopRandomAnimation,
          startRandomAnimation,
          setPopupStage: (stage) => {
            popupStage = stage;
          }
        });

    }

    const endProcessReward =
      measure("PROCESS_REWARD");

    await reward.processCheckinReward({
      db,
      studentId,
      studentData,
      extras,
      stopRandomAnimation,
    });

    endProcessReward.end();

    progressUI.updateProgress(
      "done"
    );

    setTimeout(() => {
      qs(".progress-bar").style.opacity = ".15";
    }, 100);

    qs(".progress-bar").style.display = "none";

    $("progressText").style.display = "none";

    $("rewardConfirmBtn").classList.remove("hidden");

    $("collectionLinkWrapper").style.display = "flex";

    saveStudentSession(studentId, studentData);

    statusUI.showSuccess(
      `ยินดีต้อนรับ ${escapeHtml(studentData.firstName)} ${escapeHtml(studentData.lastName)} (${escapeHtml(studentData.nickname)})<br>
       เข้าเรียนวิชา ${escapeHtml(studentData.subject)} เวลา ${successResult.timeText}`,
    );

    checkinSuccess = true;

  } catch (error) {

    debugLog(tag, "CATCH_ERROR", error);
    await logError(db, { tag, message: "Submit button error", error });
    statusUI.showError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    console.warn("Reward fail แต่ไม่กระทบระบบ", error);

  } finally {

    endTotalProcess.end();

    if (!checkinSuccess) {

      setUIProcessing(false);

      resetInput();
    }
  }
};

// หน้าโหลด checkversion กับโหลด storage ตารางวัน เวลา เปิด-ปิด
window.addEventListener("load", async () => {

  let shouldHideOverlay = true;

  try {

    // 1. ตรวจสอบเวอร์ชันก่อน (สำคัญที่สุด)
    const config = 
      await checkVersionAndReload(
        db
      );

    // เก็บ cache config ทั้งหมด
    saveSystemConfig(config);

    setRarities(config.rarities);

    console.log("Config =", config);
    console.log("Weekly =", config.weekly);
    console.log(config.rarities);

    const ok =
      await verifyClientClock(
        db,
        config
      );

    if (!ok) {

      shouldHideOverlay = false;

      statusUI.showError(
        "วันที่หรือเวลาเครื่องไม่ถูกต้อง<br>กรุณาตรวจสอบการตั้งค่า"
      );

      return;
    }

    if (!config.ok) {
      shouldHideOverlay = 
        false;

      return;

    }

    cachedTodaySetting = 
      loadTodaySettingCache();

    const today = 
      getTodayThai();

    // 2. โหลดหา weeklySettings เก็บไว้เป็น storage
    if (cachedTodaySetting && cachedTodaySetting.cacheDate === today) {

      console.log("⚡ using cachedTodaySetting");
      console.log("📦 cachedTodaySetting =", cachedTodaySetting);

    } else {

      cachedTodaySetting = {
          cacheDate: today,
          ...(config.weekly?.[getTodayWeekday()] || {}),
      };

      saveTodaySettingCache(cachedTodaySetting);
      console.log("📦 cachedTodaySetting saved");

    }

    // 3. จัดการเรื่องข้อมูล (หลังบ้าน)
    const scheduleBuildResult =
      await ensureDailyScheduleBuilt(
        db,
        config.lastDailyBuildDate
      );

    if (scheduleBuildResult?.status === "failed") {
      statusUI.showError(
        "Schedule build failed. Please refresh when the network is stable.",
        "orange"
      );
    }

  // 4. แสดงผล UI
  } catch (error) {

    console.error("Check-in startup failed", error);

    try {

      await logError(db, {
        tag: "CHECKIN_STARTUP",
        message: "Check-in startup failed",
        error,
      });

    } catch (logErr) {

      console.error("Startup error logging failed", logErr);

    }

    statusUI.showError(
      "Startup failed. Please refresh and try again.",
      "orange"
    );

  } finally {

    $("versionLabel").innerText =
      "Version : " + APP_VERSION;

    if (shouldHideOverlay) {
      $("loadingOverlay").classList.add("hide");
    }

  }

});

window.addEventListener("online", async () => {
  console.log("🌐 Browser online");

  try {

    await enableNetwork(db);
    console.log("✅ Firestore reconnect");

  } catch (e) {

    console.error(e);

  }
});

window.addEventListener("offline", async () => {
  console.log("📴 Browser offline");

  try {

    await disableNetwork(db);

  } catch (e) {

    console.error(e);

  }
});

function updateOnlineStatus() {

  const status = $("onlineStatus");

  status.className =
    navigator.onLine
      ? "online"
      : "offline";

  $("enterBtn").innerText =
    navigator.onLine
      ? "Enter"
      : "No Net";

    refreshEnterButton();
  
}

function reloadIfDateChanged() {

  const today =
    getTodayThai();

  if (
    cachedTodaySetting?.cacheDate &&
    cachedTodaySetting.cacheDate !== today
  ) {

    console.log(
      "📅 Date changed, reloading..."
    );

    clearAllCache();

    location.reload();

    return true;
  }

  return false;
}

function refreshEnterButton() {
  const enterBtn = $("enterBtn");

  enterBtn.disabled =
    isProcessing ||
    !navigator.onLine;
}

function setUIProcessing(processing) {
  isProcessing = processing;

  refreshEnterButton();

  processing
    ? showLoading()
    : $("loadingOverlay")
        .classList.add("hide");

}

async function verifyClientClock(
  db,
  config
) {

  let diff =
    getTimeDiffMinutes(
      config.serverTime
    );

  // diff === null หมายถึงไม่มี serverTime ให้เทียบเลย ต้อง refresh ก่อน
  // (ห้ามผ่านเลย เพราะ `null <= 60` จะเป็น true และข้ามการตรวจนาฬิกาไปดื้อ ๆ)
  if (diff !== null && diff <= MAX_SERVER_TIME_AGE_MINUTES) {
    return true;
  }

  console.warn(
    "Refresh Server Time..."
  );

  const newServerTime =
    await refreshServerTime(db);

  diff =
    getTimeDiffMinutes(
      newServerTime
    );

  console.log(
    "Diff After Refresh =",
    diff
  );

  if (diff !== null && diff <= MAX_SERVER_TIME_AGE_MINUTES) {
    return true;
  }

  console.error(
    "Clock Invalid"
  );

  return false;

}

window.press = function (num) {

  if (reloadIfDateChanged()) {
    return;
  }

  if (currentInput.length >= MAX_LENGTH) 
    return;

  audio.triggerFeedback("tap");

  currentInput += num;

  statusUI.showStatus("");

  updateDisplay(currentInput);
};

window.backspace = function () {

  if (reloadIfDateChanged()) {
    return;
  }
  
  currentInput = 
    currentInput.slice(0, -1);

  statusUI.showStatus("");

  audio.triggerFeedback("tap");

  updateDisplay(currentInput);
};

// 🔹 ตรวจสอบ input
function validateInput() {

  if (!currentInput) {
    return {
      valid: false,
      msg: "กรุณากรอก ID",
    };
  }

  return { valid: true };
}

function getExtraDisplay(extras = []) {
  if (!extras.length) return null;

  const first = extras[0];

  if (first.type === "WS") {
    return {
      emoji: "📘",
      title: "ขึ้นชุดใหม่!",
      desc: `${first.level} ${first.ws}`,
      sub: "กรุณาเข้าพบครูผู้สอน",
    };
  }

  if (first.type === "AT") {
    return {
      emoji: "📝",
      title: "วันนี้มีการสอบ",
      desc: `AT Level ${first.level}`,
      sub: "กรุณาเข้าพบครูติ๊ก",
    };
  }

  return null;
}

function startRandomAnimation() {

  const el = $("loadingAnimation");
  if (!el) return;

  if (animationInterval) {
    clearTimeout(animationInterval);
  }

  let delay = 50;

  function spin() {

    const emojis =
      reward.getAvailableRewardEmojis();

    el.textContent =
      emojis[
        Math.floor(
          Math.random() *
          emojis.length
        )
      ];

    delay = Math.min(
      delay * 1.03,
      300
    );

    animationInterval =
      setTimeout(
        spin,
        delay
      );

  }

  spin();

}

function stopRandomAnimation(finalReward) {

  const el = $("loadingAnimation");
  if (!el) return;

  if (animationInterval) {
    clearTimeout(animationInterval);
    animationInterval = null;
  }

  if (finalReward) {

    el.textContent = finalReward;
    el.classList.add("change");

    setTimeout(() => {
      el.classList.remove("change");
    }, 300);

  }

}

function mockStudent(studentId) {

  const names = ["น้องเอ", "น้องบี", "น้องซี", "น้องดี"];

  return {

    firstName: names[Math.floor(Math.random() * names.length)],
    lastName: studentId,
    nickname: "Dev",
    subject: ["ME", "EFL", "TRP"][Math.floor(Math.random() * 3)],

    //extras: [{type:"WS",level:"G",ws:"111"}],
    extras: [{type: "AT",level: "F"}],

    inventory: {},

  };

}

function isMockUser(id) {
  return MOCK_IDS.includes(id);
}

logoEl.addEventListener("touchstart", () => {

  adminTimer = setTimeout(async () => {

    const confirmReset = 
      confirm(
        "🛠 ต้องการล้าง Cache ทั้งหมดและสร้าง Daily Schedule ใหม่หรือไม่?",
      );

    if (confirmReset) {

      try {

        clearAllCache();
        location.reload();

      } catch (e) {

        alert("❌ ไม่สามารถล้าง Lock ได้: " + e.message);

      }

    }

  }, 5000);

});

function updateDisplay(value) {

  const display = $("display");
  const group = $("displayGroup");

  display.innerText = value ? value.split("").join(" ") : "";

  if (value) {
    display.classList.remove("placeholder");
    group.classList.add("active");
  } else {
    display.classList.add("placeholder");
    group.classList.remove("active");
  }

}

function updateCollectionButton() {

  const collectionWrapper =
    $("collectionLinkWrapper");

  collectionWrapper.style.display =
    hasStudentSession()
      ? "flex"
      : "none";

}

function onRewardConfirm() {

  if (popupStage === "extra") {
    return;
  }

  resetInput();

  resetLoadingUI();

  setUIProcessing(false);

  $("rewardConfirmBtn")
    .classList.add("hidden");

}

function resetInput() {
  currentInput = "";
  updateDisplay("");
}

function resetLoadingUI() {

  const el = $("loadingAnimation");
  const text = qs(".loading-text");
  const badge = $("rewardBadge");

  badge.classList.add("hidden");
  badge.textContent = "";

  el.classList.remove("change");
  el.style.fontSize = "70px";
  el.style.transform = "";

  text.innerHTML = "🔄 กำลังเชื่อมต่อระบบ...";

  progressUI.updateProgress(
    "start"
  );

}

function showLoading() {

  resetLoadingUI();

  startRandomAnimation();

  $("loadingOverlay")
    .classList.remove("hide");

}

// ปิด Context Menu สำหรับทั้งหน้าจอ
window.oncontextmenu = 
  function (event) {
    event.preventDefault();
    event.stopPropagation();
    return false;
  };

logoEl.addEventListener(
  "touchend", () => clearTimeout(adminTimer)
);

window.addEventListener(
  "online", 
  updateOnlineStatus
);

window.addEventListener(
  "offline", 
  updateOnlineStatus
);

window.addEventListener(
  "focus",
  () => {
    reloadIfDateChanged();
  }
);

document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.visibilityState ===
      "visible"
    ) {

      reloadIfDateChanged();

    }

  }
);

rewardConfirmBtn.addEventListener(
  "click",
  onRewardConfirm
);

updateOnlineStatus();
updateCollectionButton();