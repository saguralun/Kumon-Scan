import {
  doc,
  updateDoc,
  deleteField,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { 
	debugLog, 
	logError, 
	measure, 
	getTodayWeekday,
	APP_VERSION 
} from "/shared/index.js";

// =======================
// 🟣 CHECKOUT → COMPLETED
// =======================

function getCompletedScheduleContext(attData) {
  if (!attData?.slotKey || !attData?.subject || !attData?.studentId) {
    throw new Error("Invalid attData");
  }

  return {
    slotKey: attData.slotKey,
    subject: attData.subject,
    sid: attData.studentId,
  };
}

export async function moveToCompletedScheduleInTransaction({
  db,
  tx,
  today,
  attData,
}) {
  const {
    slotKey,
    subject,
    sid,
  } = getCompletedScheduleContext(attData);

  const slotRef = doc(
    db,
    "dailySchedule",
    today,
    "slots",
    slotKey
  );

  const slotSnap =
    await tx.get(slotRef);

  const checkedInMap =
    slotSnap.data()?.subjects?.[subject]?.checkedIn || {};

  const checkedInData =
    checkedInMap[sid];

  if (
    !checkedInData ||
    !checkedInData.nickname ||
    !checkedInData.time
  ) {

    const missing = [];

    if (!checkedInData) {
      missing.push("checkedInData");
    } else {
      if (!checkedInData.nickname) {
        missing.push("nickname");
      }

      if (!checkedInData.time) {
        missing.push("time");
      }
    }

    throw new Error(
      `CHECKIN_DATA_INVALID : ${missing.join(",")}`
    );
  }

  tx.set(
    slotRef,
    {
      subjects: {
        [subject]: {
          checkedIn: {
            [sid]: deleteField(),
          },
          completed: {
            [sid]: {
              ...checkedInData,
            },
          },
        },
      },
    },
    {
      merge: true,
    }
  );

  return {
    slotKey,
    subject,
    sid,
  };
}

export async function moveToCompletedSchedule({ db, today, attData }) {
  const tag = "moveToCompletedSchedule";

  const {
    slotKey,
    subject,
    sid,
  } = getCompletedScheduleContext(attData);

  try {

    await runTransaction(db, async (tx) => {
      await moveToCompletedScheduleInTransaction({
        db,
        tx,
        today,
        attData,
      });

    });

    debugLog(tag, "SUCCESS", {
      slotKey,
      subject,
      sid,
    });

  } catch (error) {

    console.error(
      "🔥 MOVE_COMPLETED_ERROR",
      error
    );

    if (
      error?.message?.startsWith(
        "CHECKIN_DATA_INVALID"
      )
    ) {

      await logError(db, {
        tag: "CHECKIN_DATA_CORRUPTED",
        message: error.message,
        error,
        extra: {
          today,
          slotKey,
          subject,
          studentId: sid,
          attendance: attData,
          appVersion: APP_VERSION,
        },
      });

    }

    await logError(db, {
      tag,
      message: "MOVE_TO_COMPLETED_FAIL",
      error,
      extra: {
        slotKey,
        subject,
        sid,
        today,
      },
    });

    throw error;
  }
}

// =======================
// 🔵 PLAN → CHECKIN
// =======================
export async function moveToCheckinScheduleInTransaction({
  db,
  tx,
  today,
  studentId,
  studentData,
  scheduleData = null,
  weekday = getTodayWeekday(),
  plannedSlot: plannedSlotOverride = null,
  realSlot,
  timeText,
}) {
  const subject = studentData.subject;
  const realSlotRef =
    doc(db, "dailySchedule", today, "slots", realSlot);

  const plannedSlot =
    plannedSlotOverride ||
    studentData?.weeklyPlans?.[weekday]?.timeSlot ||
    null;

  let plannedData = {
    ...(scheduleData || {}),
  };

  let invalidCheckinDataLog = null;

  if (plannedSlot) {

    const endLoadPlanned =
      measure("LOAD_PLANNED");

    const plannedRef =
      doc(
        db,
        "dailySchedule",
        today,
        "slots",
        plannedSlot
      );

    const plannedSnap =
      await tx.get(plannedRef);

    endLoadPlanned.end();

    if (plannedSnap.exists()) {

      const firestorePlannedData =
        plannedSnap.data()?.subjects?.[subject]?.planned?.[studentId] || {};

      plannedData = {
        ...plannedData,
        ...firestorePlannedData,
      };

      debugLog(
        "moveToCheckinSchedule",
        "PLANNED_DATA",
        plannedData
      );

      const endDeletePlanned =
        measure("DELETE_PLANNED");

      if (
        Object.keys(plannedData).length
      ) {

        tx.update(plannedRef, {
          [`subjects.${subject}.planned.${studentId}`]:
            deleteField(),
        });

      }

      endDeletePlanned.end();
    }
  }

  const finalCheckinData = {
    nickname: studentData.nickname || "",
    firstName: studentData.firstName || "",
    lastName: studentData.lastName || "",
    ...(plannedData || {}),
    time: timeText,
  };

  if (
    !finalCheckinData.nickname ||
    !finalCheckinData.time
  ) {

    invalidCheckinDataLog = {
      studentId,
      subject,
      plannedSlot,
      realSlot,

      studentData,
      plannedData,
      finalCheckinData,

      keys: Object.keys(finalCheckinData),
      keyCount:
        Object.keys(finalCheckinData).length,
    };

  }

  const endSetCheckin =
    measure("SET_CHECKIN");

  tx.set(
    realSlotRef,
    {
      subjects: {
        [subject]: {
          checkedIn: {
            [studentId]:
              finalCheckinData,
          },
        },
      },
    },
    {
      merge: true,
    }
  );

  endSetCheckin.end();

  return {
    plannedSlot,
    plannedData,
    finalCheckinData,
    invalidCheckinDataLog,
    extras:
      plannedData.extras || [],
  };
}

export async function moveToCheckinSchedule({
  db,
  today,
  studentId,
  studentData,
  scheduleData = null,
  weekday = getTodayWeekday(),
  plannedSlot: plannedSlotOverride = null,
  realSlot,
  timeText,
}) {
  const tag = "moveToCheckinSchedule";

  const step = "MOVE_CHECKIN_SCHEDULE";
  let endTotalMoveCheckin = null;

  const subject = studentData.subject;

  debugLog(tag, "START", {
    studentId,
    subject,
    realSlot,
  });

  try {

    endTotalMoveCheckin =
      measure("TOTAL_MOVE_CHECKIN");

    let invalidCheckinDataLog = null;
    let moveResult = null;

    await runTransaction(db, async (tx) => {

      moveResult =
        await moveToCheckinScheduleInTransaction({
          db,
          tx,
          today,
          studentId,
          studentData,
          scheduleData,
          weekday,
          plannedSlot:
            plannedSlotOverride,
          realSlot,
          timeText,
        });

      invalidCheckinDataLog =
        moveResult.invalidCheckinDataLog;

    });

    if (invalidCheckinDataLog) {
      await logError(db, {
        tag,
        message: "INVALID_CHECKIN_DATA",
        extra: invalidCheckinDataLog,
      });
    }

    endTotalMoveCheckin?.end();

    debugLog(
      tag,
      "SUCCESS",
      studentId
    );

    return {
      extras:
        moveResult?.extras || [],
    };

  } catch (error) {

    endTotalMoveCheckin?.end();

    await logError(db, {
      tag,
      message: "MOVE_CHECKIN_FAIL",
      error,
      extra: {
        step,
        studentId,
        subject,
        realSlot,
        today,
      },
    });

    throw error;
  }
}

// =======================
// 🔵 DELETE PLAN
// =======================
export async function removePlannedStudent({
  db,
  date,
  slot,
  subject,
  studentId,
}) {
  const slotRef = doc(db, "dailySchedule", date, "slots", slot);

  await updateDoc(slotRef, {
    [`subjects.${subject}.planned.${studentId}`]: deleteField(),
  });
}

export async function updateScheduleExtras({
  db, today, studentId, subject, slotKey, extra = null, removeType = null,
}) {
  const ref = doc(db, "dailySchedule", today, "slots", slotKey);
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const data = snap.data()?.subjects?.[subject];
    const section = ["planned", "checkedIn", "completed", "takeHome"]
      .find(key => data?.[key]?.[studentId]);
    if (!section) throw new Error("SCHEDULE_STUDENT_NOT_FOUND");

    const extras = [...(data[section][studentId].extras || [])];
    if (extra) extras.push(extra);
    if (removeType) {
      for (let i = extras.length - 1; i >= 0; i--) {
        if (extras[i].type === removeType) {
          extras.splice(i, 1);
          break;
        }
      }
    }
    tx.update(ref, { [`subjects.${subject}.${section}.${studentId}.extras`]: extras });
  });
}
