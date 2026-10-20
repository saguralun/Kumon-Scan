import { createOutbox } from "/shared/outbox.js";
import { createReadDeadline } from "/shared/readDeadline.js";
import { getActiveStudent, processAttendance } from "/shared/index.js";
import { prepareCheckinReward } from "../reward/checkinRewardFlow.js";
import { updateStudentReward } from "../reward/rewardService.js";

export function createCheckinQueue({ db, connection, ensureReady, onChange, ...options }) {
  const initialStudents = new Map();
  const queue = createOutbox({ ...options, kind: "checkin", onChange,
    summarize: value => ({
      status: value.attendanceResult.status,
      name: value.studentData.nickname || value.studentData.firstName,
      subject: value.studentData.subject,
      reward: value.attendanceResult.savedReward?.reward || null,
      extras: value.attendanceResult.attendance?.extras || [],
      timeText: value.attendanceResult.attendance?.timeText || "",
    }),
    async execute(job) {
      await ensureReady();
      const deadline = createReadDeadline();
      let studentData = job.attempts === 0 ? initialStudents.get(job.id) : null;
      if (!studentData) {
        const loaded = await deadline.run(() => connection.runRead(() =>
          getActiveStudent(db, job.studentId, { fromServer: true }), { canRetry: () => deadline.isActive() }), "recover-student");
        if (loaded.status === "error") throw loaded.error;
        if (!loaded.data) throw new Error("STUDENT_NOT_FOUND");
        studentData = loaded.data;
      }
      initialStudents.delete(job.id);
      let release = null;
      try {
        const result = await processAttendance({
          db, studentId: job.studentId, studentData, today: job.today,
          nowtime: new Date(job.requestedAt), requestId: job.requestId,
          preserveRequestTime: true, recoverExisting: job.attempts > 0,
          readDeadline: deadline, readConnection: connection, silent: true,
          prepareReward: prepareCheckinReward,
          async onWriteStart() {
            const unlock = await connection.beginWrite();
            if (!deadline.isActive()) { unlock(); deadline.assertActive(); }
            release = unlock;
          },
        });
        if (result.status === "error") throw Object.assign(new Error("ATTENDANCE_READ_FAILED"), { code: "unavailable" });
        if (["created", "reward_pending"].includes(result.status) && !result.savedReward) {
          release ??= await connection.beginWrite();
          const proposed = prepareCheckinReward({ studentData, attendanceId: job.id, extras: result.attendance.extras });
          result.savedReward = await updateStudentReward({
            db, studentId: job.studentId, studentData, attendanceId: job.id,
            rewardId: proposed.result.reward.id, rewardRarity: proposed.result.reward.rarity,
            reward: proposed.result.reward, extras: result.attendance.extras,
            persistAttendanceReceipt: true,
          });
        }
        return { attendanceResult: result, studentData };
      } finally { release?.(); }
    },
  });
  return { ...queue,
    submit({ studentId, studentData, today, requestedAt }) {
      const id = `${studentId}_${today}`;
      if (queue.get(id)) return queue.enqueue({ id });
      initialStudents.set(id, studentData);
      try {
        return queue.enqueue({ id, studentId, today, requestedAt: requestedAt.toISOString(),
          nickname: studentData.nickname || studentData.firstName || studentId, subject: studentData.subject,
          group: JSON.stringify([studentData.firstName, studentData.lastName]),
        });
      } catch (error) { initialStudents.delete(id); throw error; }
    },
  };
}

export function waitForCheckinJob(promise, timeoutMs = 7000) {
  let timer;
  return Promise.race([
    promise.then(value => ({ value })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ pending: true }), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}
