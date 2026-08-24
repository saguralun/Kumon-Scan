import {
	collection,
	addDoc,
	serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export async function logError(
	db,
	{
		tag = "UNKNOWN",
		message = "ERROR",
		error = null,
		extra = {}
	}
) {
	try {
		
		await addDoc(collection(db, "systemLogs"), {
			tag, // ⭐ สำคัญมาก (รู้ว่า error มาจากไหน)
			message,

			errorMessage: error?.message || String(error),
			stack: error?.stack || null,

			time: serverTimestamp(),

			device: typeof navigator !== "undefined"
				? navigator.userAgent
				: "server",

			...extra
		});

	} catch (e) {

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