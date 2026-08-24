import {
	doc, getDoc, updateDoc, getDocs, documentId,
	query, collection, orderBy, where,
	startAt, endAt, limit, startAfter,
	serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { 
	getTodayWeekday,
	parseTimeToMinutes,
	minutesToTime,
	formatToSlotKey,
	debugLog,
	logError
} from "/shared/index.js";

export async function getActiveStudent(db, studentId) {

	const tag = "getActiveStudent";

	try {

		const studentRef = 
		doc(
			db, 
			"students", 
			studentId
		);

		const snap = 
			await getDoc(studentRef);

		if (!snap.exists()) {

			debugLog(
				tag, 
				"❌ student not found:",
				{
					studentId
				}
			);

			return { status: "not_found" };

		}

		const data = snap.data();

		if (data.active !== true) {
			debugLog(
				tag, 
				"⚠️ student inactive:",
				{
					studentId
				}
			);

			return { status: "inactive", data };

		}

		debugLog(
			tag, 
			"✅ student loaded:",
			{
				data
			}
		);

		return { status: "active", data };

	} catch (err) {
		
		await logError(
			db, 
			{
				tag: "getActiveStudent",
				message: "Error loading student",
				error: err,
				extra: { studentId }
			}
		);

		debugLog(
			"getActiveStudent", 
			"❌ error loading student:", 
			err
		);

		return { 
			status: "error", 
			message: "Failed to load student", 
			details: err?.message || String(err) 
		};

	}
}

// อัพเดท WeeklyPlan สำหรับเด็กที่ checkin สำเร็จ ต้องมี realslot
export async function studentUpdateWeeklyPlan({
	db,
	studentId,
	studentData,
	weekday = getTodayWeekday(),
	checkInText
}) {

	const tag = "studentUpdateWeeklyPlan";

	try {
		debugLog(
			tag, 
			"START", 
			{ 
				studentId, 
				weekday, 
				checkInText 
			}
		);

		const studentRef = 
			doc(
				db,
				"students",
				studentId
			);

		const plan =
			studentData.weeklyPlans?.[weekday];

    const currentMinutes = 
			parseTimeToMinutes(checkInText);
		
		if (!plan) {
			// ปัดเศษให้เป็น Slot ทุกๆ 30 นาที (เช่น 12:03 -> 12:00)
      const snappedMinutes = 
				Math.floor(currentMinutes / 30) * 30;
      const timeSlot = 
				minutesToTime(snappedMinutes);

			debugLog(
				tag, 
				"CREATE_NEW_PLAN"
			);

			await updateDoc(studentRef, {
				[`weeklyPlans.${weekday}`]: {
					timeSlot,
					timeAverage: checkInText,
					planStrength: 2,
					missStreak: 0,
					zeroStrengthWeeks: 0,
					totalSessions: 1
				 	}
				});

			debugLog(
				tag, 
				"CREATE_SUCCESS"
			);

			return;

		}

		// =======================
		// 🔵 2. UPDATE PLAN (Already have)
		// =======================

		debugLog(
			tag, 
			"EXISTING_PLAN", 
			plan
		);

		// หาค่าเฉลี่ยเดิม
		const oldAvgMinutes = plan.timeAverage
			? parseTimeToMinutes(plan.timeAverage)
			: parseTimeToMinutes(plan.timeSlot);

		// คำนวณค่าเฉลี่ยใหม่ (Weight 3:1)	
		const rawAvgMinutes = 
			Math.round(
				(oldAvgMinutes * 3 + currentMinutes) / 4
			);

		// ปัดเศษค่าเฉลี่ยเพื่อหา Slot ใหม่
		const snappedMinutes = 
			Math.floor(rawAvgMinutes / 30) * 30;

		const newAvgText = 
			minutesToTime(rawAvgMinutes);
		const slotText = 
			minutesToTime(snappedMinutes);

		// 🔹 strength
		const currentStrength = 
			plan.planStrength || 0;
		const newStrength = 
			Math.min((plan.planStrength || 0) + 2, 10);

		debugLog(
			tag, 
			"CALC_AVG_STRENGTH", 
			{
				oldAvgMinutes,
				rawAvgMinutes,
				snappedMinutes,
				currentStrength,
				newStrength
			}
		);

		// 🔹 update
		debugLog(
			tag, 
			"START_UPDATE", 
			{
				slotText,
				newAvgText,
				newStrength
			}
		);

		const updatePayload = {
			missStreak: 0,
			totalSessions: (plan.totalSessions || 0) + 1,
			timeAverage: newAvgText,
			timeSlot: slotText,
			planStrength: newStrength,
			zeroStrengthWeeks: 0,
		};

		await updateDoc(studentRef,{
			[`weeklyPlans.${weekday}`]: {
  			...plan,
				...updatePayload
			}
		});

		debugLog(
			tag, 
			"UPDATE_ALL_SUCCESS", 
			{ 
				studentRefPath: studentRef.path 
			}
		);

	} catch (error) {

		await logError(
			db, 
			{
				tag: "studentUpdateWeeklyPlan",
				message: "UPDATE_FAIL",
				error,
				extra: {
					studentId,
					weekday,
					checkInText
				}
			}
		);

	}

}

export async function searchStudents(
	db, 
	searchText, 
	searchType, 
	options = {}
) {
  const { pageSize = 10, lastVisible = null } = options;

  const text = searchText.toLowerCase();
  let constraints = [];

  if (searchType === "id") {
    constraints.push(orderBy(documentId()));
    constraints.push(startAt(text));
    constraints.push(endAt(text + "\uf8ff"));
  } else {
    // 🔥 ใช้ searchName แทน firstName/lastName
    constraints.push(where("searchTokens", "array-contains", searchText.toLowerCase()));
  }

  if (lastVisible) constraints.push(startAfter(lastVisible));
  constraints.push(limit(pageSize));

  const q = query(collection(db, "students"), ...constraints);
  return await getDocs(q);
}

export function buildSearchTokens({ 
	firstName = "", 
	lastName = "", 
	nickname = "" 
}) {
    const text = `${firstName} ${lastName} ${nickname}`
        .toLowerCase()
        .trim();

    const words = text.split(/\s+/);
    const tokens = [];

    words.forEach(word => {
        for (let i = 1; i <= word.length; i++) {
            tokens.push(word.substring(0, i));
        }
    });

    return tokens;
}