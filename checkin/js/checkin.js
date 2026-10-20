import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  enableNetwork,
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
  getTodayThai,
  getNow,
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
  escapeHtml,
} from "/shared/index.js";

import {
  ensureDailyScheduleBuilt
} from "../modules/dailyBuild.js";

import {
  saveStudentSession,
  hasStudentSession,
  clearStudentSession,
  clearAllCache,
} from "../modules/storage.js";

import {
  checkTodayAndTime,
} from "../modules/settings.js";

import { createCheckinConfigRefresher } from "../modules/configRefresh.js";
import { verifyCheckinClock } from "../modules/clock.js";
import { createReadDeadline } from "/shared/readDeadline.js";
import { createCheckinConnection } from "../modules/connection.js";
import { createCheckinQueue, waitForCheckinJob } from "../modules/checkinQueue.js";

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

window.reward = reward;

let cachedTodaySetting = null;
let currentInput = "";
let isProcessing = false;
let studentData;
let adminTimer;
let animationInterval = null;
let checkinSuccess = false;
let popupStage = "reward";
let checkinStartupStarted = false;
let checkinPageActive = false;
let checkinStartupReady = false;
let checkinStartupTask = null;
const connection = createCheckinConnection({ db });
const configRefresher = createCheckinConfigRefresher({
  db,
  readConfig: read => connection.runRead(read),
  onConfig(config, setting) {
    if (cachedTodaySetting?.enabled === false && setting.enabled === true) checkinStartupReady = false;
    cachedTodaySetting = setting;
  },
});
const checkinJobs = createCheckinQueue({ db, connection,
  ensureReady: ensureCheckinStartup, onChange: renderCheckinJobs,
});

window.submitID = async function () {

  if (reloadIfDateChanged()) {
    return;
  }
  const tag = "submitID";
  const studentId = currentInput;
  const today = getTodayThai();
  const requestedAt = getNow();

  let attendanceSaved = false;
  let keepStartupOverlay = false;
  let queuedId = null;

  checkinSuccess = false;


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

    clearStudentSession();
    updateCollectionButton();

    // Step 1: ตรวจสอบเวลา
    const readDeadline = createReadDeadline();
    progressUI.updateProgress(
      "checkTime"
    );

    const endCheckTodayTime =
      measure("CHECK_TODAY_TIME");

    let setting;
    try {
      await readDeadline.run(() => ensureCheckinStartup(), "startup");
      setting = await readDeadline.run(() => configRefresher.getTodaySetting(), "config");
      // A same-day reopening must prepare the schedule that was skipped while closed.
      await readDeadline.run(() => ensureCheckinStartup(), "startup");
    } catch (error) {
      console.warn("Check-in config unavailable", error);
      keepStartupOverlay = ["config/version-mismatch", "config/clock-invalid"].includes(error.code);
      if (error.code === "config/clock-invalid") {
        statusUI.showError("วันที่หรือเวลาเครื่องไม่ถูกต้อง<br>กรุณาตรวจสอบการตั้งค่า");
      } else if (!keepStartupOverlay) {
        statusUI.showError("ยังโหลดข้อมูลวันเรียนไม่สำเร็จ<br>กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
      }
      return;
    }
    const todaySetting = await checkTodayAndTime(setting);

    endCheckTodayTime.end();

    if (!todaySetting) return;

    const endGetStudentTime = 
      measure("GET_STUDENT");

    // Step 2: ค้นหารายชื่อ
    progressUI.updateProgress(
      "loadStudent"
    );

    const dataResult = 
      await readDeadline.run(() => connection.runRead(() => getActiveStudent(db, studentId), {
        canRetry: () => readDeadline.isActive(),
      }), "student");

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

    readDeadline.assertActive();
    const submitted = checkinJobs.submit({ studentId, studentData, today, requestedAt });
    queuedId = submitted.job.id;
    if (submitted.existing) {
      if (submitted.job.status === "done") {
        showCollectionForStudent(studentId, studentData);
      }
      statusUI.showStatus(submitted.job.status === "done"
        ? "มีผลเช็กอินแล้ว ดูได้ในรายการด้านล่าง"
        : "มีรายการรอยืนยันอยู่แล้ว ไม่ต้องส่งซ้ำ", "#946200");
      return;
    }
    checkinJobs.resume();
    progressUI.updateProgress("saveAttendance");
    const outcome = await waitForCheckinJob(submitted.promise);
    if (outcome.pending) {
      stopRandomAnimation();
      statusUI.showStatus("รับรายการไว้แล้ว กำลังรอยืนยัน<br>เด็กคนถัดไปเช็กอินต่อได้", "#946200");
      return;
    }
    if (!outcome.value.attendanceResult) {
      showCollectionForStudent(studentId, studentData);
      statusUI.showStatus("ยืนยันรายการแล้ว ดูผลในรายการด้านล่าง", "#267744");
      return;
    }
    const { attendanceResult } = outcome.value;
    studentData = outcome.value.studentData;

    const canContinue =
      handleAttendanceResult({
        attendanceResult,
        studentData,
        statusUI,
        audio
      });

    attendanceSaved = ["created", "reward_pending"].includes(attendanceResult.status);

    if (!canContinue) {
      if (["active", "completed"].includes(attendanceResult.status)) {
        showCollectionForStudent(studentId, studentData);
      }
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
      attendanceId: attendanceResult.attendance.attendanceId,
      savedReward: attendanceResult.savedReward,
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

    showCollectionForStudent(studentId, studentData);
    checkinJobs.acknowledge(queuedId);

    statusUI.showSuccess(
      `ยินดีต้อนรับ ${escapeHtml(studentData.firstName)} ${escapeHtml(studentData.lastName)} (${escapeHtml(studentData.nickname)})<br>
       เข้าเรียนวิชา ${escapeHtml(studentData.subject)} เวลา ${successResult.timeText}`,
    );

    checkinSuccess = true;

  } catch (error) {

    debugLog(tag, "CATCH_ERROR", error);
    void logError(db, { tag, message: "Submit button error", error }).catch(console.error);
    statusUI.showError(attendanceSaved
      ? "บันทึกเข้าเรียนแล้ว แต่รางวัลยังไม่สำเร็จ<br>กรุณาสแกนรหัสเดิมอีกครั้งเพื่อรับรางวัล"
      : queuedId ? "รายการยังอยู่ในคิว กรุณาตรวจสอบรายการด้านล่าง"
      : error.isOutboxStorageError ? "เก็บคิวในเครื่องไม่ได้ ยังไม่ได้เริ่มบันทึก<br>กรุณาตรวจสอบพื้นที่จัดเก็บของเบราว์เซอร์"
      : error.isCheckinReadTimeout
      ? "เชื่อมต่อช้า ยังไม่ได้เริ่มบันทึกเข้าเรียน<br>กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
      : "เกิดข้อผิดพลาด กรุณาลองใหม่");
    console.warn("Reward fail แต่ไม่กระทบระบบ", error);

  } finally {

    endTotalProcess.end();

    if (!checkinSuccess) {
      stopRandomAnimation();

      setUIProcessing(false);
      if (keepStartupOverlay) $("loadingOverlay").classList.remove("hide");

      resetInput();
    }
  }
};

async function ensureCheckinStartup() {
  if (checkinStartupReady) return;
  if (checkinStartupTask) return checkinStartupTask;
  // Keep one initialization running after a UI timeout; scans cannot bypass it.
  checkinStartupTask = (async () => {
    const config = await configRefresher.refresh();
    if (!await verifyClientClock(db, config)) {
      throw Object.assign(new Error("CLIENT_CLOCK_INVALID"), { code: "config/clock-invalid" });
    }
    const finishStartupWrite = await connection.beginWrite();
    try {
      const scheduleBuildResult = await ensureDailyScheduleBuilt(db, config.lastDailyBuildDate, {
        teachingEnabled: config.weekly?.[getTodayWeekday()]?.enabled,
      });
      if (scheduleBuildResult?.status === "failed") {
        statusUI.showError(
          "Schedule build failed. Please refresh when the network is stable.",
          "orange"
        );
      }
      checkinStartupReady = true;
      queueMicrotask(() => checkinJobs.resume());
    } finally {
      finishStartupWrite();
    }
  })().finally(() => { checkinStartupTask = null; });
  return checkinStartupTask;
}

// หน้าโหลด checkversion กับโหลด storage ตารางวัน เวลา เปิด-ปิด
window.addEventListener("load", async () => {
  let shouldHideOverlay = true;
  checkinStartupStarted = true;
  checkinPageActive = document.visibilityState !== "hidden";

  try {
    await createReadDeadline().run(() => ensureCheckinStartup(), "startup");

  // 4. แสดงผล UI
  } catch (error) {

    console.error("Check-in startup failed", error);
    if (error.code === "config/version-mismatch") {
      shouldHideOverlay = false;
      return;
    }
    if (error.code === "config/clock-invalid") {
      shouldHideOverlay = false;
      statusUI.showError("วันที่หรือเวลาเครื่องไม่ถูกต้อง<br>กรุณาตรวจสอบการตั้งค่า");
      return;
    }

    void logError(db, {
        tag: "CHECKIN_STARTUP",
        message: "Check-in startup failed",
        error,
      }).catch(console.error);

    statusUI.showError(
      error.stage === "clock"
        ? "ตรวจสอบเวลาไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง"
        : error.isCheckinReadTimeout
        ? "การเชื่อมต่อใช้เวลานาน ระบบยังเตรียมข้อมูลอยู่ กรุณาลองอีกครั้ง"
        : "Startup failed. Please refresh and try again.",
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
    configRefresher.invalidate();
    if (checkinStartupStarted && document.visibilityState !== "hidden") {
      await createReadDeadline().run(() => configRefresher.refresh(), "online-config");
      checkinJobs.resume();
    }

  } catch (e) {

    console.error(e);

  }
});

window.addEventListener("offline", () => {
  console.log("📴 Browser offline");
  configRefresher.invalidate();
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
  return verifyCheckinClock(config);
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

function showCollectionForStudent(studentId, data) {
  saveStudentSession(studentId, data);
  updateCollectionButton();
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

function refreshConfigOnActivation() {
  if (!checkinStartupStarted || document.visibilityState === "hidden" || checkinPageActive) return;
  checkinPageActive = true;
  if (reloadIfDateChanged()) return;
  checkinJobs.resume();
  void createReadDeadline().run(() => configRefresher.refresh(), "activation-config").catch(error => {
    console.warn("Could not refresh check-in config on activation", error);
  });
}

function markCheckinInactive() {
  checkinPageActive = false;
  configRefresher.invalidate();
}

window.addEventListener("focus", refreshConfigOnActivation);
window.addEventListener("blur", markCheckinInactive);
window.addEventListener("pageshow", event => {
  if (!event.persisted) return;
  markCheckinInactive();
  refreshConfigOnActivation();
});

document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.visibilityState ===
      "visible"
    ) {

      refreshConfigOnActivation();
    } else {
      markCheckinInactive();
    }

  }
);

rewardConfirmBtn.addEventListener(
  "click",
  onRewardConfirm
);

updateOnlineStatus();
updateCollectionButton();
renderCheckinJobs();

function renderCheckinJobs() {
  const container = $("checkinQueue");
  if (!container) return;
  try {
    const jobs = checkinJobs.list();
    container.replaceChildren();
    for (const job of jobs) {
      const row = document.createElement("div");
      row.className = "checkin-job " + job.status;
      const text = document.createElement("div");
      const label = document.createElement("strong");
      label.textContent = `${job.nickname} (${job.subject})`;
      const detail = document.createElement("span");
      const result = job.result;
      detail.textContent = job.status === "done"
        ? `${["active", "completed"].includes(result?.status) ? "มีบันทึกแล้ว" : "ยืนยันแล้ว"} ${result?.timeText || ""}${result?.reward ? " · " + result.reward.icon + " " + result.reward.name : ""}${result?.extras?.length ? " · " + result.extras.map(e => e.type + " " + e.level + (e.ws ? " " + e.ws : "")).join(", ") : ""}`
        : job.status === "failed" ? "ต้องตรวจสอบ · กดลองใหม่ได้" : "รอยืนยันจาก server";
      text.append(label, detail);
      row.append(text);
      if (job.status !== "pending") {
        const button = document.createElement("button");
        button.type = "button";
        const dismiss = job.status === "done";
        button.textContent = dismiss ? "\u00d7" : "ลองใหม่";
        button.classList.toggle("dismiss-job", dismiss);
        button.title = dismiss ? "ปิดรายการแจ้งเตือน" : "ลองส่งรายการอีกครั้ง";
        button.setAttribute("aria-label", `${button.title}: ${job.nickname}`);
        button.addEventListener("click", () => job.status === "done"
          ? checkinJobs.acknowledge(job.id) : checkinJobs.retry(job.id));
        row.append(button);
      }
      container.append(row);
    }
    container.hidden = jobs.length === 0;
  } catch (error) {
    container.hidden = false;
    container.textContent = "เปิดคิวในเครื่องไม่ได้ กรุณาตรวจสอบพื้นที่จัดเก็บของเบราว์เซอร์";
    console.error(error);
  }
}
