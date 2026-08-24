import {
  measure,
  formatFirestoreTime
} from "/shared/index.js";

import {
  studentUpdateWeeklyPlan
} from "/shared/studentService.js";

import {
  escapeHtml
} from "/shared/textUtils.js";

import * as progressUI from "../checkin/ui/progressUI.js";

export function handleStudentResult({
  dataResult,
  statusUI
}) {

  switch (dataResult.status) {

    case "not_found":

      statusUI.showError(
        "❌ ไม่พบรายชื่อนักเรียน"
      );

      return {
        canContinue: false
      };

    case "inactive":

      statusUI.showError(
        "⚠️ นักเรียนไม่เปิดใช้งาน",
        "orange"
      );

      return {
        canContinue: false
      };

    case "error":

      statusUI.showError(
        "❌ ระบบมีปัญหา กรุณาลองใหม่"
      );

      return {
        canContinue: false
      };

    case "active":

      return {
        canContinue: true,
        studentData: dataResult.data
      };
  }
}

export function handleAttendanceResult({
  attendanceResult,
  studentData,
  statusUI,
  audio
}) {
  switch (attendanceResult.status) {

    case "completed": {
      const attData =
        attendanceResult.data;

      statusUI.showSuccess(
        `${escapeHtml(studentData.firstName)}
        ${escapeHtml(studentData.lastName)}
        (${escapeHtml(studentData.nickname)})<br>
        ✅ วันนี้เรียนเสร็จแล้ว
        (${attData.totalMinutes} นาที)`
      );

      audio.triggerFeedback(
        "blocked"
      );

      return false;
    }

    case "active": {
      const attData =
        attendanceResult.data;

      const checkInText =
        formatFirestoreTime(
          attData.checkInTime
        );

      statusUI.showError(
        `${escapeHtml(studentData.firstName)}
        ${escapeHtml(studentData.lastName)}
        (${escapeHtml(studentData.nickname)})<br>
        ⏳ กำลังเรียนอยู่
        (เริ่ม ${checkInText})`,
        "orange"
      );

      return false;
    }

    case "error":
      statusUI.showError(
        "❌ ระบบมีปัญหา กรุณาลองใหม่"
      );
      return false;

    case "created":
      return true;
  }
}

export async function processCheckinSuccess({
  db,
  today,
  studentId,
  studentData,
  attendance
}) {
  
  const {
    timeText,
    realSlot
  } = attendance;

  const endUpdateWeeklyPlan = 
    measure("UPDATE_WEEKLY_PLAN");

  // Step 7: อัปเดตสถิติรายสัปดาห์ (Weekly Plan)
  progressUI.updateProgress(
    "weeklyPlan"
  );

  await studentUpdateWeeklyPlan({
    db,
    studentId,
    studentData,
    checkInText: timeText,
  });

  endUpdateWeeklyPlan.end();

  return {
    timeText,
    realSlot,
    extras:
      attendance.extras || []
  };
}
