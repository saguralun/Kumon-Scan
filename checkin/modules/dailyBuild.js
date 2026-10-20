import { logError, getTodayThai, getTodayWeekday } from "/shared/index.js";
import {
  doc, getDoc, getDocs, collection, query, where, limit, runTransaction, serverTimestamp, deleteField,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { loadBuildStatusCache, saveBuildStatusCache } from "./storage.js";
import * as progressUI from "../ui/progressUI.js";
import * as audio from "../audio/audio.js";

const BUILD_VERSION = 2;
const BUILD_TIMEOUT_MS = 50000;
const BUILD_CHUNK_SIZE = 100;
const SUBJECTS = ["ME", "EFL", "TRP"];
const SECTIONS = ["planned", "checkedIn", "completed", "takeHome", "unplanned"];

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function isValidSlot(slot) {
  return typeof slot === "string" && /^(?:[01]\d|2[0-3]):(?:00|30)$/.test(slot);
}

function wasBuiltToday(plan, today) {
  if (plan.lastDailyBuildDate === today) return true;
  const date = plan.updatedAt?.toDate?.();
  if (!date) return false;
  const key = String(date.getFullYear()) +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");
  return key === today;
}

export async function loadStudentsForBuild(db, subject, weekday) {
  return getDocs(query(
    collection(db, "students"),
    where("active", "==", true),
    where("subject", "==", subject),
    where(`weeklyPlans.${weekday}.planStrength`, ">=", 1),
  ));
}

async function prepareManifest(db, ref, today, weekday, previous) {
  if (!previous?.students) {
    const slots = await getDocs(query(collection(db, "dailySchedule", today, "slots"), limit(1)));
    if (!slots.empty) {
      return runTransaction(db, async tx => {
        const current = (await tx.get(ref)).data();
        if (current?.buildVersion === BUILD_VERSION) return current;
        const existing = {
          buildVersion: BUILD_VERSION, status: "existing", weekday,
          students: [], revision: 1,
        };
        // A legacy table may contain deliberate cancellations; do not rebuild it.
        tx.set(ref, existing, { merge: true });
        return existing;
      });
    }
  }

  const students = new Map((previous?.students || []).map(item => [item.id, item]));
  for (const subject of SUBJECTS) {
    const snap = await loadStudentsForBuild(db, subject, weekday);
    for (const student of snap.docs) {
      students.set(student.id, {
        id: student.id, subject,
        slot: student.data().weeklyPlans?.[weekday]?.timeSlot || "",
      });
    }
  }

  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const current = snap.data();
    if (current?.buildVersion === BUILD_VERSION && current.status !== "partial") return current;
    const merged = new Map((current?.students || []).map(item => [item.id, item]));
    for (const [id, item] of students) merged.set(id, item);
    const manifest = {
      buildVersion: BUILD_VERSION,
      status: "building",
      weekday,
      revision: (current?.revision || 0) + 1,
      students: [...merged.values()].sort((a, b) => (a.slot || "").localeCompare(b.slot || "")),
    };
    tx.set(ref, { ...manifest, startedAt: serverTimestamp() }, { merge: true });
    return manifest;
  });
}

async function buildChunk(db, today, weekday, students) {
  return runTransaction(db, async tx => {
    // Re-read each student once to avoid overwriting a simultaneous check-in.
    const snapshots = await Promise.all(students.map(item => tx.get(doc(db, "students", item.id))));
    const candidates = [];
    const invalid = [];
    for (let i = 0; i < students.length; i++) {
      if (!snapshots[i].exists()) continue;
      const data = snapshots[i].data();
      const plan = data.weeklyPlans?.[weekday];
      if (data.active !== true || data.lastAttendanceDate === today ||
          plan?.lastDailyBuildDate === today) continue;
      if (!plan || !SUBJECTS.includes(data.subject) || !isValidSlot(plan.timeSlot)) {
        invalid.push(students[i].id);
        continue;
      }
      if ((plan.planStrength || 0) < 1 && !wasBuiltToday(plan, today)) continue;
      candidates.push({ id: students[i].id, data, plan });
    }

    const slotKeys = [...new Set(candidates.map(item => item.plan.timeSlot))];
    const slotSnaps = await Promise.all(slotKeys.map(slot =>
      tx.get(doc(db, "dailySchedule", today, "slots", slot))));
    const slots = new Map(slotKeys.map((slot, index) => [slot, slotSnaps[index].data() || {}]));
    const patches = new Map();

    for (const { id, data, plan } of candidates) {
      const subject = data.subject;
      const slot = plan.timeSlot;
      const subjectData = slots.get(slot).subjects?.[subject] || {};
      if (SECTIONS.some(section => subjectData[section]?.[id])) continue;

      const patch = patches.get(slot) || { subjects: {} };
      patch.subjects[subject] ??= { planned: {} };
      patch.subjects[subject].planned[id] = {
        nickname: data.nickname || data.firstName || id,
        firstName: data.firstName || "",
        lastName: data.lastName || "",
      };
      patches.set(slot, patch);

      const updates = { [`weeklyPlans.${weekday}.lastDailyBuildDate`]: today };
      if (!wasBuiltToday(plan, today)) {
        const miss = (plan.missStreak || 0) + 1;
        const strength = Math.max(0, (plan.planStrength || 0) - miss);
        Object.assign(updates, {
          [`weeklyPlans.${weekday}.missStreak`]: miss,
          [`weeklyPlans.${weekday}.planStrength`]: strength,
          [`weeklyPlans.${weekday}.zeroStrengthWeeks`]: strength === 0
            ? (plan.zeroStrengthWeeks || 0) + 1 : 0,
          [`weeklyPlans.${weekday}.updatedAt`]: serverTimestamp(),
        });
      }
      tx.update(doc(db, "students", id), updates);
    }

    // Student penalties and their planned entries commit or fail together.
    for (const [slot, patch] of patches) {
      tx.set(doc(db, "dailySchedule", today, "slots", slot), patch, { merge: true });
    }
    return invalid;
  });
}

async function finishBuild(db, ref, today, manifest, invalidStudentIds) {
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const current = snap.data();
    if (current?.status === "complete") return true;
    if (current?.revision !== manifest.revision) return false;
    const complete = invalidStudentIds.length === 0;
    tx.update(ref, {
      status: complete ? "complete" : "partial",
      invalidStudentIds,
      finishedAt: serverTimestamp(),
      ...(complete ? { students: deleteField() } : {}),
    });
    if (complete) {
      tx.set(doc(db, "system", "config"), { lastDailyBuildDate: today }, { merge: true });
    }
    return complete;
  });
}

export async function ensureDailyScheduleBuilt(db, lastDailyBuildDate, { teachingEnabled = true } = {}) {
  const today = getTodayThai();
  progressUI.updateProgress("checkinSchedule");
  if (teachingEnabled === false) {
    progressUI.updateProgress("ready");
    return { status: "closed", built: false };
  }
  try {
    const cache = loadBuildStatusCache();
    if (cache?.built && cache.buildVersion === BUILD_VERSION) {
      progressUI.updateProgress("ready");
      return { status: "ready", built: true };
    }

    const ref = doc(db, "dailySchedule", today);
    const snap = await withTimeout(getDoc(ref), BUILD_TIMEOUT_MS, "load daily build");
    let manifest = snap.data();
    if (manifest?.buildVersion === BUILD_VERSION && manifest.status === "existing") {
      progressUI.updateProgress("ready");
      return { status: "existing", built: false };
    }
    if (manifest?.buildVersion === BUILD_VERSION && manifest.status === "complete") {
      saveBuildStatusCache({ buildVersion: BUILD_VERSION });
      progressUI.updateProgress("ready");
      return { status: "ready", built: true };
    }

    if (manifest?.buildVersion !== BUILD_VERSION || manifest.status === "partial") {
      progressUI.updateProgress("buildSchedule");
      manifest = await withTimeout(
        prepareManifest(db, ref, today, getTodayWeekday(), manifest),
        BUILD_TIMEOUT_MS, "prepare daily build",
      );
    }
    if (manifest.status === "complete") {
      saveBuildStatusCache({ buildVersion: BUILD_VERSION });
      progressUI.updateProgress("ready");
      return { status: "ready", built: true };
    }
    if (manifest.status === "existing") {
      progressUI.updateProgress("ready");
      return { status: "existing", built: false };
    }

    const invalid = [];
    for (let index = 0; index < manifest.students.length; index += BUILD_CHUNK_SIZE) {
      invalid.push(...await withTimeout(
        buildChunk(db, today, manifest.weekday, manifest.students.slice(index, index + BUILD_CHUNK_SIZE)),
        BUILD_TIMEOUT_MS, "build daily schedule chunk",
      ));
      progressUI.updateBuildProgress(
        10 + Math.floor(Math.min(index + BUILD_CHUNK_SIZE, manifest.students.length) /
          Math.max(1, manifest.students.length) * 80),
        "Building schedule...",
      );
    }

    const complete = await withTimeout(
      finishBuild(db, ref, today, manifest, invalid), BUILD_TIMEOUT_MS, "finish daily build",
    );
    if (complete) saveBuildStatusCache({ buildVersion: BUILD_VERSION });
    else console.warn("Daily schedule needs attention", { today, invalidStudentIds: invalid });
    progressUI.updateProgress("ready");
    return { status: complete ? "built" : "partial", built: complete, invalidStudentIds: invalid };
  } catch (error) {
    audio.triggerFeedback("error");
    progressUI.updateBuildProgress(100, "Schedule build failed");
    void logError(db, {
      tag: "ensureDailyScheduleBuilt", message: "Ensure_DailySchedule_fail", error, extra: { today },
    }).catch(console.error);
    return { status: "failed", built: false, error };
  }
}
