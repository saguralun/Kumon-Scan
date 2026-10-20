import {
	doc,
  getDoc,
  getDocFromServer,
  Timestamp,
	serverTimestamp,
	collection,
	where,
	query,     
	getDocs,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { 
	formatToSlotKey,
	formatFirestoreTime,
	debugLog,
	logError,
  measure,
  getTodayWeekday,
	getDiffMinutes,
  moveToCompletedScheduleInTransaction,
  moveToCheckinScheduleInTransaction 
} from "/shared/index.js";

import * as progressUI from "../checkin/ui/progressUI.js";
import { buildWeeklyPlanAfterCheckin } from "./studentService.js";

// 👉 function กลางสำหรับ check-in
export async function createAttendance({
	db,
	studentId,
	studentData,
	today,
	nowtime = new Date()
}) {

  const result = await createAttendanceAndCheckinSchedule({
    db, studentId, studentData, today, nowtime, rewardEligible: false,
  });
  if (result.status !== "created") throw new Error("ATTENDANCE_ALREADY_EXISTS");
  return result.attendance;
}

async function createAttendanceAndCheckinSchedule({
	db,
	studentId,
	studentData,
	today,
	nowtime = new Date(),
  scheduleData = null,
  plannedSlot = null,
  rewardEligible = true,
  prepareReward = null,
  requestId = null,
  preserveRequestTime = false,
}) {
	const tag =
		"createAttendanceAndCheckinSchedule";

	const weekday =
    getTodayWeekday(nowtime);
	const checkInServerTime =
    serverTimestamp();
	const timeText =
    formatFirestoreTime(nowtime);
	const realSlot =
    formatToSlotKey(nowtime);

	const attendanceId =
    `${studentId}_${today}`;
	const attendanceRef =
    doc(
      db,
      "attendance",
      attendanceId
    );

	const writeTimer =
    measure("CREATE_ATTENDANCE_AND_CHECKIN_SCHEDULE");

	let moveResult = {
		extras: []
	};
	let invalidCheckinDataLog = null;

	try {
    const result = await runTransaction(db, async (tx) => {
			const attendanceSnap =
        await tx.get(attendanceRef);

			if (attendanceSnap.exists()) {
        return { status: attendanceSnap.data().status, data: attendanceSnap.data() };
			}

      const studentRef = doc(db, "students", studentId);
      const studentSnap = await tx.get(studentRef);
      if (!studentSnap.exists() || studentSnap.data().active !== true) {
        throw new Error("STUDENT_NOT_ACTIVE");
      }
      const freshStudent = studentSnap.data();
      const weeklyPlan = buildWeeklyPlanAfterCheckin(freshStudent.weeklyPlans?.[weekday], timeText);

			moveResult =
        await moveToCheckinScheduleInTransaction({
          db,
          tx,
          today,
          studentId,
          studentData: freshStudent,
          scheduleData,
          plannedSlot,
          weekday,
          realSlot,
          timeText,
        });

			invalidCheckinDataLog =
        moveResult.invalidCheckinDataLog;

      let preparedReward = null;
      if (rewardEligible && prepareReward) {
        try {
          preparedReward = prepareReward({
            studentData: freshStudent, attendanceId, extras: moveResult.extras || [],
          });
        } catch (error) {
          // A reward configuration problem must not prevent attendance being saved.
          console.warn("Reward remains pending after check-in", error);
        }
      }
      const rewardUpdates = preparedReward?.updates || {};
      tx.update(studentRef, {
        ...rewardUpdates,
        [`weeklyPlans.${weekday}`]: weeklyPlan,
        lastAttendanceDate: freshStudent.lastAttendanceDate > today ? freshStudent.lastAttendanceDate : today,
      });
			tx.set(attendanceRef, {
				studentId: studentId,
				firstName: freshStudent.firstName || "",
				lastName: freshStudent.lastName || "",
				nickname: freshStudent.nickname || "",
				subject: freshStudent.subject,
				date: today,
				weekday: weekday,
				slotKey: realSlot,
				checkInTime: preserveRequestTime ? Timestamp.fromDate(nowtime) : checkInServerTime,
        ...(preserveRequestTime ? { recordedAt: checkInServerTime } : {}),
        ...(requestId ? { requestId } : {}),
				status: "active",
        rewardEligible,
        extras: moveResult.extras || [],
        rewardState: !rewardEligible ? "none" : preparedReward ? "granted" : "pending",
        ...(preparedReward ? { rewardReceipt: {
          reward: preparedReward.result.reward, isNewItem: preparedReward.result.isNewItem,
        } } : {}),
			});
      return { status: "created", freshStudent, weeklyPlan, rewardUpdates, savedReward: preparedReward?.result || null };
		});

    if (result.status !== "created") return result;
    Object.assign(studentData, result.freshStudent, result.rewardUpdates, {
      weeklyPlans: { ...result.freshStudent.weeklyPlans, [weekday]: result.weeklyPlan },
      lastAttendanceDate: result.freshStudent.lastAttendanceDate > today ? result.freshStudent.lastAttendanceDate : today,
    });

		if (invalidCheckinDataLog) {
			void logError(db, {
				tag,
				message: "INVALID_CHECKIN_DATA",
				extra: invalidCheckinDataLog,
			}).catch(console.error);
		}

		return {
      status: "created",
      savedReward: result.savedReward,
      attendance: {
			attendanceId,
			timeText,
			realSlot,
			extras:
        moveResult.extras || []
      }
		};

	} catch (error) {

		void logError(db, {
			tag,
			message:
        "CREATE_ATTENDANCE_AND_CHECKIN_SCHEDULE_FAIL",
			error,
			extra: {
				studentId,
				subject:
          studentData.subject,
				today,
				attendanceId,
				realSlot,
			},
		}).catch(console.error);

		throw error;

	} finally {

		writeTimer.end();

	}
}

async function getAttendanceStatus(
  db,
  studentId,
  date,
  fromServer = false,
){
  const tag =
    "getAttendanceStatus";

  try{

    const attendanceId =
      `${studentId}_${date}`;

    const attendanceRef =
      doc(
        db,
        "attendance",
        attendanceId
      );

    const snap =
      await (fromServer ? getDocFromServer : getDoc)(
        attendanceRef
      );

    if(!snap.exists()){

      debugLog(
        tag,
        "NOT_FOUND",
        {
          studentId,
          date
        }
      );

      return {
        status:"not_found"
      };
    }

    const data =
      snap.data();

    debugLog(
      tag,
      "FOUND",
      {
        status:data.status,
        studentId,
        date
      }
    );

    return {
      status:data.status,
      data
    };

  }catch(error){

    void logError(db,{
      tag,
      message:
        "failed to get attendance status",
      error,
      extra:{
        studentId,
        date
      }
    }).catch(console.error);

    return {
      status:"error",
      error
    };
  }
}

export async function processAttendance({
  db,
  studentId,
  studentData,
  today,
  nowtime = new Date(),
  scheduleData = null,
  plannedSlot = null,
  rewardEligible = true,
  autoCheckoutPrevious = true,
  readDeadline = null,
  onWriteStart = () => {},
  prepareReward = null,
  readConnection = null,
  requestId = null,
  preserveRequestTime = false,
  recoverExisting = false,
  silent = false,
}) {

  if (!silent) progressUI.updateProgress(
    "attendance"
  );

  const tag = "processAttendance";
  const endCheckAttendance = 
    measure("CHECK_ATTENDANCE");

  async function startWrite() {
    readDeadline?.assertActive();
    await (readDeadline ? readDeadline.run(onWriteStart, "before-save") : onWriteStart());
    readDeadline?.assertActive();
  }

  if (!autoCheckoutPrevious) {
    await startWrite();
    return createAttendanceAndCheckinSchedule({
      db, studentId, studentData, today, nowtime, scheduleData, plannedSlot, rewardEligible, prepareReward, requestId, preserveRequestTime,
    });
  }

  const readStatus = () => getAttendanceStatus(db, studentId, today, recoverExisting);
  const readOptions = { canRetry: () => !readDeadline || readDeadline.isActive() };
  const loadStatus = () => readConnection ? readConnection.runRead(readStatus, readOptions) : readStatus();
  const attendanceResult = await (readDeadline
    ? readDeadline.run(loadStatus, "attendance-status") : loadStatus());

  const existing = attendanceResult.data;
  if (requestId && existing?.requestId === requestId) {
    return restoreQueuedAttendance(existing, studentData, studentId, today);
  }
  if (rewardEligible && existing?.rewardState !== "granted" && existing?.rewardEligible === true &&
      ["active", "completed"].includes(existing.status) &&
      studentData.rewardReceipt?.attendanceId !== `${studentId}_${today}`) {
    return {
      status: "reward_pending",
      data: existing,
      attendance: {
        attendanceId: `${studentId}_${today}`,
        timeText: formatFirestoreTime(existing.checkInTime),
        realSlot: existing.slotKey,
        extras: existing.extras || [],
      },
    };
  }
      
  switch (attendanceResult.status) {

    case "completed":
      return {
        status: "completed",
        data: attendanceResult.data
      };

    case "active":
      return {
        status: "active",
        data: attendanceResult.data
      };

    case "error":
      return {
        status: "error"
      };

    case "not_found":
      break;

  }

  endCheckAttendance.end();
  if (studentData.active !== true) throw new Error("STUDENT_NOT_ACTIVE");

  const queryTimer =
    measure("AUTO_CHECKOUT_QUERY");

  const activeQuery = 
    query(
      collection(db, "attendance"),
      where("date", "==", today),
      where("status", "==", "active"),
      where("firstName", "==", studentData.firstName),
      where("lastName", "==", studentData.lastName),
    );

  const readPrevious = () => getDocs(activeQuery);
  const loadPrevious = () => readConnection ? readConnection.runRead(readPrevious, readOptions) : readPrevious();
  const activeAttendanceSnap = await (readDeadline
    ? readDeadline.run(loadPrevious, "previous-attendance") : loadPrevious());

  queryTimer.end();

  console.log(
    "AUTO_CHECKOUT_DOCS",
    activeAttendanceSnap.size
  );

  const endAutoCheckout = 
    measure("AUTO_CHECKOUT");

  const now = preserveRequestTime ? nowtime : new Date();
  await startWrite();

  if (!activeAttendanceSnap.empty) {

    const docSnap =
      activeAttendanceSnap.docs[0];

    const completeTimer =
      measure("AUTO_COMPLETE_ATTENDANCE_AND_SCHEDULE");

    const attData =
      docSnap.data();
    if (preserveRequestTime && attData.checkInTime?.toDate?.() > now) {
      throw new Error("CHECKIN_ORDER_REQUIRES_REVIEW");
    }
    
    const diffMinutes =
      getDiffMinutes(
        attData.checkInTime,
        now
      );

    debugLog(
      tag,
      "AUTO_CHECKOUT_CALC",
      {
        diffMinutes
      }
    );

    // Step 5: Auto Checkout
    if (!silent) progressUI.updateProgress(
      "autoCheckout"
    );

    await completeAttendanceAndSchedule({
      db,
      attendanceId:
        docSnap.id,
      today,
      attData,
      totalMinutes:
        diffMinutes,
      autoCheckout: true,
      requestedAt: preserveRequestTime ? nowtime : null,
    });

    debugLog(
      tag,
      "AUTO_CHECKOUT_DONE"
    );

    completeTimer.end();

  }

  endAutoCheckout.end();

  // Step 6: บันทึก Attendance ใหม่
  if (!silent) progressUI.updateProgress(
    "saveAttendance"
  );

  const endCreateAttendance = 
    measure("CREATE_ATTENDANCE");

  const newAttendance = await createAttendanceAndCheckinSchedule({
    db,
    studentId,
    studentData,
    today,
    nowtime,
    scheduleData,
    plannedSlot,
    rewardEligible,
    prepareReward,
    requestId,
    preserveRequestTime,
  });

  endCreateAttendance.end();

  if (requestId && newAttendance.data?.requestId === requestId) {
    return restoreQueuedAttendance(newAttendance.data, studentData, studentId, today);
  }
  return newAttendance;
}

function restoreQueuedAttendance(data, studentData, studentId, today) {
  return {
    status: "created", restored: true,
    attendance: {
      attendanceId: `${studentId}_${today}`, timeText: formatFirestoreTime(data.checkInTime),
      realSlot: data.slotKey, extras: data.extras || [],
    },
    savedReward: data.rewardState === "granted" && data.rewardReceipt ? {
      ...data.rewardReceipt, inventory: studentData.inventory || {},
      rewardStats: studentData.rewardStats || {}, alreadyClaimed: true,
    } : null,
  };
}

function buildAttendanceCompletionPayload({
  totalMinutes,
  autoCheckout = false,
  requestedAt = null,
}) {
  const payload = {
    status: "completed",
    checkOutTime:
      requestedAt ? Timestamp.fromDate(requestedAt) : serverTimestamp(),
    totalMinutes,
  };

  if (autoCheckout) {
    payload.autoCheckout = true;
  }

  return payload;

}

async function completeAttendanceAndSchedule({
  db,
  attendanceId,
  today,
  attData,
  totalMinutes,
  autoCheckout = false,
  requestedAt = null,
}) {
  const tag =
    "completeAttendanceAndSchedule";

  const attendanceRef =
    doc(
      db,
      "attendance",
      attendanceId
    );

  const payload =
    buildAttendanceCompletionPayload({
      totalMinutes,
      autoCheckout,
      requestedAt,
    });

  try {
    await runTransaction(db, async (tx) => {
      const attendanceSnap = await tx.get(attendanceRef);
      if (!attendanceSnap.exists()) throw new Error("ATTENDANCE_NOT_FOUND");

      const currentAttendance = attendanceSnap.data();
      // Retrying an acknowledged checkout must not change its original times.
      if (currentAttendance.status === "completed") return;
      if (currentAttendance.status !== "active") {
        throw new Error("ATTENDANCE_NOT_ACTIVE");
      }

      await moveToCompletedScheduleInTransaction({
        db,
        tx,
        today,
        attData: currentAttendance
      });

      tx.update(
        attendanceRef,
        payload
      );
    });
  } catch (error) {
    if (isRetryableCheckoutError(error)) throw error;

    if (
      error?.message?.startsWith(
        "CHECKIN_DATA_INVALID"
      )
    ) {
      void logError(db, {
        tag: "CHECKIN_DATA_CORRUPTED",
        message: error.message,
        error,
        extra: {
          today,
          attendanceId,
          attendance: attData,
        },
      }).catch(console.error);
    }

    void logError(db, {
      tag,
      message:
        "COMPLETE_ATTENDANCE_AND_SCHEDULE_FAIL",
      error,
      extra: {
        today,
        attendanceId,
        totalMinutes,
        autoCheckout,
        attendance: attData,
      },
    }).catch(console.error);

    throw error;
  }
}

export function isRetryableCheckoutError(error) {
  const code = String(error?.code || "").replace(/^firestore\//, "");
  return [
    "unavailable",
    "deadline-exceeded",
    "aborted",
    "internal",
    "resource-exhausted",
    "unknown",
    "network-request-failed",
  ].includes(code);
}

export async function checkoutAttendance({
  db,
  attendanceData,
  nowtime = new Date()
}) {

  const now =
    nowtime;

  const checkIn =
    attendanceData.checkInTime.toDate();

  const totalMinutes =
    Math.max(0, Math.floor(
      (now - checkIn) / 60000
    ));

  await completeAttendanceAndSchedule({
    db,
    attendanceId:
      attendanceData.id,
    today:
      attendanceData.date,
    attData:
      attendanceData,
    totalMinutes,
    requestedAt: nowtime,
  });

  return {
    totalMinutes
  };

}
