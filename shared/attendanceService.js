import {
	doc,
  getDoc,
	setDoc,
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

// 👉 function กลางสำหรับ check-in
export async function createAttendance({
	db,
	studentId,
	studentData,
	today,
	nowtime = new Date()
}) {

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
    measure("SET_ATTENDANCE_DOC");

	await setDoc(attendanceRef, {
		studentId: studentId,
		firstName: studentData.firstName,
		lastName: studentData.lastName,
		nickname: studentData.nickname,
		subject: studentData.subject,
		date: today,
		weekday: weekday,
		slotKey: realSlot,
		checkInTime: checkInServerTime,
		status: "active"
	});

  writeTimer.end();

	return {
		attendanceId,
		timeText,
		realSlot
	};
}

async function createAttendanceAndCheckinSchedule({
	db,
	studentId,
	studentData,
	today,
	nowtime = new Date()
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
		await runTransaction(db, async (tx) => {
			const attendanceSnap =
        await tx.get(attendanceRef);

			if (attendanceSnap.exists()) {
				throw new Error(
					"ATTENDANCE_ALREADY_EXISTS"
				);
			}

			moveResult =
        await moveToCheckinScheduleInTransaction({
          db,
          tx,
          today,
          studentId,
          studentData,
          weekday,
          realSlot,
          timeText,
        });

			invalidCheckinDataLog =
        moveResult.invalidCheckinDataLog;

			tx.set(attendanceRef, {
				studentId: studentId,
				firstName: studentData.firstName,
				lastName: studentData.lastName,
				nickname: studentData.nickname,
				subject: studentData.subject,
				date: today,
				weekday: weekday,
				slotKey: realSlot,
				checkInTime: checkInServerTime,
				status: "active"
			});
		});

		if (invalidCheckinDataLog) {
			await logError(db, {
				tag,
				message: "INVALID_CHECKIN_DATA",
				extra: invalidCheckinDataLog,
			});
		}

		return {
			attendanceId,
			timeText,
			realSlot,
			extras:
        moveResult.extras || []
		};

	} catch (error) {

		await logError(db, {
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
		});

		throw error;

	} finally {

		writeTimer.end();

	}
}

async function getAttendanceStatus(
  db,
  studentId,
  date
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
      await getDoc(
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

    await logError(db,{
      tag,
      message:
        "failed to get attendance status",
      error,
      extra:{
        studentId,
        date
      }
    });

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
  nowtime = new Date()
}) {

  progressUI.updateProgress(
    "attendance"
  );

  const tag = "processAttendance";
  const endCheckAttendance = 
    measure("CHECK_ATTENDANCE");

  const attendanceResult = 
    await getAttendanceStatus(
      db, 
      studentId, 
      today
    );
      
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

  const activeAttendanceSnap =
    await getDocs(activeQuery);

  queryTimer.end();

  console.log(
    "AUTO_CHECKOUT_DOCS",
    activeAttendanceSnap.size
  );

  const endAutoCheckout = 
    measure("AUTO_CHECKOUT");

  const now = new Date();

  if (!activeAttendanceSnap.empty) {

    const docSnap =
      activeAttendanceSnap.docs[0];

    const completeTimer =
      measure("AUTO_COMPLETE_ATTENDANCE_AND_SCHEDULE");

    const attData =
      docSnap.data();
    
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
    progressUI.updateProgress(
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
      autoCheckout: true
    });

    debugLog(
      tag,
      "AUTO_CHECKOUT_DONE"
    );

    completeTimer.end();

  }

  endAutoCheckout.end();

  // Step 6: บันทึก Attendance ใหม่
  progressUI.updateProgress(
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
  });

  endCreateAttendance.end();

  return {
    status:"created",
    attendance:newAttendance
  };
}

function buildAttendanceCompletionPayload({
  totalMinutes,
  autoCheckout = false
}) {
  const payload = {
    status: "completed",
    checkOutTime:
      serverTimestamp(),
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
  autoCheckout = false
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
      autoCheckout
    });

  try {
    await runTransaction(db, async (tx) => {
      await moveToCompletedScheduleInTransaction({
        db,
        tx,
        today,
        attData
      });

      tx.update(
        attendanceRef,
        payload
      );
    });
  } catch (error) {
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
          attendanceId,
          attendance: attData,
        },
      });
    }

    await logError(db, {
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
    });

    throw error;
  }
}

export async function checkoutAttendance({
  db,
  attendanceData
}) {

  const now =
    new Date();

  const checkIn =
    attendanceData.checkInTime.toDate();

  const totalMinutes =
    Math.floor(
      (now - checkIn) / 60000
    );

  await completeAttendanceAndSchedule({
    db,
    attendanceId:
      attendanceData.id,
    today:
      attendanceData.date,
    attData:
      attendanceData,
    totalMinutes
  });

  return {
    totalMinutes
  };

}
