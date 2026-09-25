import {
  logError,
  debugLog,
  getTodayThai,
  getTodayWeekday
} from "/shared/index.js";

import {
  doc,
  getDocs,
  setDoc,
  serverTimestamp,
  writeBatch,
  query,
  where,
  collection,
  getCountFromServer,
  limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
  loadBuildStatusCache,
  saveBuildStatusCache,
  clearBuildStatusCache
} from "../modules/storage.js";

import * as progressUI from "../ui/progressUI.js";
import * as audio from "../audio/audio.js";
import * as reward from "../reward/rewardUtils.js";

const BUILD_READ_TIMEOUT_MS = 50000;
const BUILD_WRITE_TIMEOUT_MS = 30000;
const BUILD_LOG_TIMEOUT_MS = 5000;
const SCHEDULE_ORIGIN_SECTIONS = [
  "planned",
  "checkedIn",
  "completed",
  "takeHome"
];

function withTimeout(promise, ms, label) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${Math.round(ms / 1000)}s`
        )
      );
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function buildScheduleClient(
  schedule,
  docSnap,
  weeklyPlan
) {

  const data =
    docSnap.data();

  const slot =
    weeklyPlan.timeSlot;

  const subject =
    data.subject;

  if (!slot || !subject) {
    return;
  }

  schedule[slot] ??= {
    subjects: {},
  };

  schedule[slot]
    .subjects[subject] ??= {
    planned: {},
  };

  schedule[slot]
    .subjects[subject]
    .planned[docSnap.id] = {
      nickname:
        data.nickname || "",
      firstName:
        data.firstName || "",
      lastName:
        data.lastName || "",
    };
}

function processStudentForBuild(
  schedule,
  docSnap,
  weekday
) {

  // ===== update values =====
  
  const data = 
    docSnap.data();
    
  const weeklyPlan =
    data.weeklyPlans[weekday];

  const oldMiss =
    weeklyPlan.missStreak || 0;

  const newMiss =
    oldMiss + 1;

  const oldStrength =
    weeklyPlan.planStrength || 0;

  const newStrength =
    Math.max(
      0,
      oldStrength - newMiss
    );

  let zeroStrengthWeeks =
    weeklyPlan.zeroStrengthWeeks || 0;

  if (newStrength <= 0) {
    zeroStrengthWeeks++;
  } else {
    zeroStrengthWeeks = 0;
  }

  // ===== build schedule =====

  buildScheduleClient(
    schedule,
    docSnap,
    weeklyPlan
  );

  return {
    updates: {
      [`weeklyPlans.${weekday}.missStreak`]:
        newMiss,

      [`weeklyPlans.${weekday}.planStrength`]:
        newStrength,

      [`weeklyPlans.${weekday}.zeroStrengthWeeks`]:
        zeroStrengthWeeks,

      [`weeklyPlans.${weekday}.updatedAt`]:
        serverTimestamp(),
    }
  };

}

async function getBuildStudentCount(
  db,
  weekday
) {

  const snap =
    await withTimeout(
      getCountFromServer(
      query(
        collection(db, "students"),

        where("active", "==", true),

        where(
          `weeklyPlans.${weekday}.planStrength`,
          ">=",
          1
        )
      )
      ),
      BUILD_READ_TIMEOUT_MS,
      "count build students"
    );

  return snap.data().count;
}

async function assertNoDailyScheduleExists(
  db,
  today
) {
  const snap = await withTimeout(
    getDocs(
      query(
        collection(
          db,
          "dailySchedule",
          today,
          "slots"
        ),
        limit(1)
      )
    ),
    BUILD_READ_TIMEOUT_MS,
    "check existing daily schedule before save"
  );

  if (!snap.empty) {
    throw new Error(
      "DAILY_SCHEDULE_EXISTS_ABORT_BUILD"
    );
  }
}

async function saveSchedule(
  db,
  schedule
) {

  const today =
    getTodayThai();

  const entries =
    Object.entries(schedule);

  if (entries.length === 0) {
    return;
  }

  await assertNoDailyScheduleExists(
    db,
    today
  );

  const batch =
    writeBatch(db);

  for (const [slot, data] of entries) {

    const ref = doc(
      db,
      "dailySchedule",
      today,
      "slots",
      slot
    );

    batch.set(
      ref,
      data
    );
  }

  await withTimeout(
    batch.commit(),
    BUILD_WRITE_TIMEOUT_MS,
    "save daily schedule"
  );
}

async function markBuildCompleted(db) {
  const today = getTodayThai();
  const ref = doc(db, "system", "config");

  await withTimeout(
    setDoc(
      ref,
      {
        lastDailyBuildDate: today,
      },
      { merge: true },
    ),
    BUILD_WRITE_TIMEOUT_MS,
    "mark daily build complete",
  );

  saveBuildStatusCache();
}

async function safeCommit(ctx, db) {

  if (ctx.opCount < ctx.MAX_BATCH) {
    return;
  }

  const batch =
    ctx.batch;

  ctx.batch =
    writeBatch(db);

  ctx.opCount = 0;

  await withTimeout(
    batch.commit(),
    BUILD_WRITE_TIMEOUT_MS,
    "commit schedule batch"
  );

}

function isScheduleBuiltToday(
  lastDailyBuildDate
) {

  const cached =
    loadBuildStatusCache();

  if (cached?.built) {

    console.log(
      "⚡ using build status cache"
    );

    console.log(
      "📦 build cache =",
      cached
    );

    return true;

  }

  const built =
    lastDailyBuildDate ===
    getTodayThai();

  if (built) {
    saveBuildStatusCache();
  }

  return built;

}

function countScheduledStudents(slotDocs) {
  const studentKeys = new Set();

  for (const slotDoc of slotDocs) {
    const subjects =
      slotDoc.data()?.subjects || {};

    for (const [subject, subjectData] of Object.entries(subjects)) {
      for (const section of SCHEDULE_ORIGIN_SECTIONS) {
        const students =
          subjectData?.[section] || {};

        for (const studentId of Object.keys(students)) {
          studentKeys.add(`${subject}:${studentId}`);
        }
      }
    }
  }

  return studentKeys.size;
}

async function getDailyScheduleSummary(db) {
  const today = getTodayThai();

  const snap = await withTimeout(
    getDocs(
      collection(
        db,
        "dailySchedule",
        today,
        "slots"
      )
    ),
    BUILD_READ_TIMEOUT_MS,
    "load daily schedule summary"
  );

  return {
    slotCount: snap.size,
    scheduledStudentCount:
      countScheduledStudents(snap.docs),
  };
}

function isDailyScheduleComplete(
  summary,
  expectedStudentCount
) {
  if (expectedStudentCount === 0) {
    return true;
  }

  return (
    summary.slotCount > 0 &&
    summary.scheduledStudentCount >= expectedStudentCount
  );
}

export async function loadStudentsForBuild(
  db,
  subject,
  weekday
) {
  const q = query(
    collection(db, "students"),

    where("active", "==", true),

    where("subject", "==", subject),

    where(
      `weeklyPlans.${weekday}.planStrength`,
      ">=",
      1
    )
  );

  return await withTimeout(
    getDocs(q),
    BUILD_READ_TIMEOUT_MS,
    `load ${subject} students`
  );
}

async function buildDailySchedule(db) {
  const tag = "BUILD_SCHEDULE";

  console.time("BUILD_TOTAL");

  try {
    const weekday = getTodayWeekday();

    progressUI.updateBuildProgress(
      15,
      "📚 Loading students..."
    );

    //นับจำนวนที่ active ทั้งหมด >= 0 
    const grandTotal =
      Math.max(
        1,
        await getBuildStudentCount(
          db,
          weekday
        )
      );

    const subjects = [
      "ME",
      "EFL",
      "TRP"
    ];

    const ctx = {
      batch: writeBatch(db),
      opCount: 0,
      MAX_BATCH: 100,
    };

    let done = 0;

    const schedule = {};
    
    progressUI.updateBuildProgress(
        20,
        `📚 Loading ...`
      );

    for (const subject of subjects) {

      const snap =
        await loadStudentsForBuild(
          db,
          subject,
          weekday
        );

      const total =
        snap.size || 1;

      let subjectDone = 0;

      for (const docSnap of snap.docs) {

        subjectDone++;
        done++;

        if (done % 5 === 0) {

          progressUI.updateBuildProgress(
            20 +
              Math.floor(
                (done / grandTotal) * 70
              ),
            `📋 ${subject} ${subjectDone}/${total}`
          );

        }

        const result =
          processStudentForBuild(
            schedule,
            docSnap,
            weekday
          );

        ctx.batch.update(
          docSnap.ref,
          result.updates
        );

        ctx.opCount++;

        await safeCommit(
          ctx,
          db
        );
      }

    }

    console.time("FINAL_COMMIT");

    if (ctx.opCount > 0) {

      await withTimeout(
        ctx.batch.commit(),
        BUILD_WRITE_TIMEOUT_MS,
        "final schedule commit",
      );

      ctx.opCount = 0;

    }

        /////// บันทึก schedule ลง Firestore

    await saveSchedule(
      db,
      schedule
    );

    console.timeEnd("FINAL_COMMIT");
    console.log("📊 processed =", done);
    console.timeEnd("BUILD_TOTAL");

  } catch (e) {

    console.error(
      "[BUILD_SCHEDULE]",
      e
    );

    throw e;

  }
}

export async function ensureDailyScheduleBuilt(
  db,
  lastDailyBuildDate
) {

  const tag = "ensureDailyScheduleBuilt";

  progressUI.updateProgress(
    "checkinSchedule"
  );

  // 1. เช็คว่าวันนี้สร้างเสร็จหรือยัง
  try {

    const alreadyBuilt =
      isScheduleBuiltToday(
        lastDailyBuildDate
      );

    const weekday =
      getTodayWeekday();

    const expectedStudentCount =
      await getBuildStudentCount(
        db,
        weekday
      );

    const scheduleSummary =
      await getDailyScheduleSummary(db);

    const scheduleComplete =
      isDailyScheduleComplete(
        scheduleSummary,
        expectedStudentCount
      );

    if (alreadyBuilt && scheduleComplete) {
      progressUI.updateProgress(
        "ready",
      );

      await reward.delay(200);

      return {
        status: "ready",
        built: true,
      };
    }

    if (alreadyBuilt && !scheduleComplete) {
      clearBuildStatusCache();

      console.warn(
        "Daily build cache/config said ready, but schedule is incomplete",
        {
          expectedStudentCount,
          ...scheduleSummary,
        }
      );
    }

    if (scheduleComplete) {

        console.log(
          "📅 Daily schedule already exists",
          {
            expectedStudentCount,
            ...scheduleSummary,
          }
        );

        // sync cache + system status
        await markBuildCompleted(db);

        progressUI.updateProgress("ready");

        await reward.delay(200);

        return {
            status: "ready",
            built: true,
        };

    }

    if (scheduleSummary.slotCount > 0) {

      // มี schedule ของวันนี้อยู่แล้วจริง (มีคน checkin ไปแล้วก็เป็นได้)
      // ต่อให้นับจำนวนไม่ตรง (เช่น มีนักเรียน planStrength>=1 แต่ไม่มี
      // timeSlot เลยไม่เคยถูกใส่เข้า schedule ตอน build) ก็ห้าม throw
      // บล็อกทั้งระบบเด็ดขาด เพราะ rebuild ซ้ำก็ทำไม่ได้อยู่แล้ว
      // (assertNoDailyScheduleExists จะ throw ทันทีถ้ามี slot อยู่)
      // แค่ log ไว้เงียบ ๆ เพื่อตามไปดูทีหลังว่าทำไมนับไม่ตรง

      console.warn(
        "Daily schedule count mismatch — treating as built (non-blocking)",
        {
          expectedStudentCount,
          ...scheduleSummary,
        }
      );

      logError(db, {
        tag,
        message: "SCHEDULE_COUNT_MISMATCH",
        extra: {
          expectedStudentCount,
          ...scheduleSummary,
        },
      }).catch((logErr) => {
        console.error(
          "Log schedule count mismatch failed",
          logErr
        );
      });

      await markBuildCompleted(db);

      progressUI.updateProgress("ready");

      await reward.delay(200);

      return {
        status: "ready",
        built: true,
      };
    }

    alert(
      "📅 ยังไม่มี Daily Schedule\n\nกำลังเริ่มสร้าง..."
    );

    progressUI.updateProgress("buildSchedule");

    await buildDailySchedule(db);

    progressUI.updateProgress("finalizeSchedule");

    await markBuildCompleted(db);

    progressUI.updateProgress("ready");

    return {
      status: "built",
      built: true,
    };

  } catch (err) {
      console.error(
        "🚨 ensureDailyScheduleBuilt",
        err
      );

      console.log(
        "type:",
        typeof err
      );

      console.log(
        "keys:",
        Object.keys(err || {})
      );

      console.log(
        "json:",
        JSON.stringify(err, null, 2)
      );
      
    audio.triggerFeedback("error");
    progressUI.updateBuildProgress(
      100,
      "Schedule build failed"
    );
    console.error("Daily schedule build failed", err);

    try {
      await withTimeout(
        logError(db, {
          tag,
          message: "Ensure_DailySchedule _fail",
          error: err,
        }),
        BUILD_LOG_TIMEOUT_MS,
        "log schedule build error",
      );
    } catch (logErr) {
      console.error("Daily schedule error logging failed", logErr);
    }

    return {
      status: "failed",
      built: false,
      error: err,
    };
  }

}
