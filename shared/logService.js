import {
	collection,
	addDoc,
	serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const SYSTEM_LOG_ENABLED = true;
const LOG_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_RECENT_LOGS = 200;
const recentLogs = new Map();
const reportedErrors = new WeakSet();

const SKIPPED_ERROR_CODES = new Set([
  "unavailable",
  "deadline-exceeded",
  "aborted",
  "cancelled",
  "network-request-failed",
]);

const SKIPPED_MESSAGES = new Set([
  "already-completed",
  "ATTENDANCE_ALREADY_EXISTS",
  "DAILY_SCHEDULE_EXISTS_ABORT_BUILD",
  "SCHEDULE_COUNT_MISMATCH",
]);

export async function logError(
	db,
	{
		tag = "UNKNOWN",
		message = "ERROR",
		error = null,
		extra = {}
	}
) {
	if (!SYSTEM_LOG_ENABLED) return;

	const errorMessage = error?.message || (error == null ? message : String(error));
	const errorCode = String(error?.code || "").replace(/^firestore\//, "");
	if (
		SKIPPED_ERROR_CODES.has(errorCode) ||
		SKIPPED_MESSAGES.has(errorMessage) ||
		SKIPPED_MESSAGES.has(message)
	) return;

	const errorObject = error !== null && (typeof error === "object" || typeof error === "function");
	if (errorObject && reportedErrors.has(error)) return;

	const attendance = extra.attendance || {};
	const key = JSON.stringify([
		error == null ? tag : "error",
		errorCode,
		errorMessage,
		extra.attendanceId || "",
		extra.studentId || extra.studentID || extra.sid || attendance.studentId || "",
		extra.today || extra.date || attendance.date || "",
		extra.slotKey || extra.slot || attendance.slotKey || "",
		extra.subject || attendance.subject || "",
	]);
	const now = Date.now();
	for (const [oldKey, time] of recentLogs) {
		if (now - time >= LOG_DUPLICATE_WINDOW_MS) recentLogs.delete(oldKey);
	}
	if (recentLogs.has(key)) return;
	if (recentLogs.size >= MAX_RECENT_LOGS) {
		recentLogs.delete(recentLogs.keys().next().value);
	}

	// Reserve before the write so nested catches cannot submit the same failure.
	recentLogs.set(key, now);
	if (errorObject) reportedErrors.add(error);

	try {
		
		await addDoc(collection(db, "systemLogs"), {
			tag, // ⭐ สำคัญมาก (รู้ว่า error มาจากไหน)
			message,

			errorMessage,
			stack: error?.stack || null,

			time: serverTimestamp(),

			device: typeof navigator !== "undefined"
				? navigator.userAgent
				: "server",

			...extra
		});

	} catch (e) {
		if (recentLogs.get(key) === now) recentLogs.delete(key);
		if (errorObject) reportedErrors.delete(error);

		console.error("🔥 logError failed:", {
			originalError: error,
			logError: e

		});

	}
}

// console.log (time) Service

window.DEBUG_TIMER = true;

export function measure(label) {

	if (!window.DEBUG_TIMER) {
    return {
      end() {
        return 0;
      }
    };
  }

  const start =
    performance.now();

  return {
    end() {

      const ms = (
        performance.now() - start
      ).toFixed(0);

      console.log(
        `⏱ ${label}: ${ms} ms`
      );

      return Number(ms);
    }
  };
}
