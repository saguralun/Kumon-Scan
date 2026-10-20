import {
  doc,
  updateDoc,
  serverTimestamp,
  getDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const MILLISECONDS_PER_MINUTE = 60000;
export const MAX_SERVER_TIME_AGE_MINUTES = 60;

// 📅 1. วันที่ปัจจุบันในรูปแบบ YYYYMMDD (เช่น "20260407")
export function getTodayThai() {
		const now = getNow();
		const y = now.getFullYear();
		const m = String(now.getMonth() + 1).padStart(2, "0");
		const d = String(now.getDate()).padStart(2, "0");
		return `${y}${m}${d}`;
}

// 🗓️ 2. วันในสัปดาห์ (0=อาทิตย์, 1=จันทร์, ...)
export function getTodayWeekday(date = getNow()){
  return date.getDay();
}

// 🔑 3. เปลี่ยนชื่อให้สื่อความหมายว่า "แปลงเวลาเป็น Slot Key"
export function formatToSlotKey(dateObj) {
  // ถ้าไม่ส่งค่ามา ให้ใช้เวลาปัจจุบัน (Fallback)
  const date = dateObj || new Date(); 
  
  const hour = String(date.getHours()).padStart(2, "0");
  const minuteSlot = date.getMinutes() < 30 ? "00" : "30";
  
  return `${hour}:${minuteSlot}`;
}

// ⏱️ 4. คำนวณนาทีที่ผ่านไปจาก Timestamp (เปรียบเทียบกับ "ตอนนี้")
export function getDiffMinutes(timestamp, now = getNow()) {
    if (!timestamp) return 0;
    let date;

    if (typeof timestamp.toDate === "function") date = timestamp.toDate();
    else if (timestamp instanceof Date) date = timestamp;
    else return 0;

    return Math.floor((now - date) / 60000);
}

// 📝 5. แปลงเวลาจาก Timestamp เป็น String "HH:mm" (เช่น "10:15")
export function formatFirestoreTime(timestamp) {
	if (!timestamp) return "--:--";

	let date;
	if (typeof timestamp.toDate === "function")	date = timestamp.toDate();
	else if (timestamp instanceof Date) date = timestamp;
	else return "--:--";

	// ใช้ padStart เพื่อให้แน่ใจว่าเป็น 2 หลักเสมอ (เช่น 09:05)
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${hours}:${minutes}`;
}

// 🔢 6. ฟังก์ชันช่วยจัดการตัวเลขเวลา (ถ้ายังต้องใช้ใน sorting)
export function parseTimeToMinutes(timeStr) {
	const [h, m] = timeStr.split(":").map(Number);
	return h * 60 + m;
}

// 🔢 7. Utility: แปลงจำนวนนาทีรวม กลับเป็น String "HH:mm"
export function minutesToTime(mins) {
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

// 🕒 8. getNow เวอร์ชั่น "Test Mode"
export function getNow() {
  // 1. เช็คว่ามีการตั้งค่า TEST_DATE ไว้ใน window (Global) หรือไม่
  if (typeof window !== "undefined" && window.TEST_DATE) {
    return new Date(window.TEST_DATE);
  }
  
  // 2. ถ้าไม่มี (ภาวะปกติ) ให้ใช้เวลาจริงจากเครื่อง 100%
  return new Date();
} 

export function excelDateToJSDate(serial) {
    if (!serial) return "";

    const excelEpoch = new Date(1899, 11, 30); // สำคัญมาก
    const result = new Date(excelEpoch.getTime() + serial * 86400000);

    const yyyy = result.getFullYear();
    const mm = String(result.getMonth() + 1).padStart(2, "0");
    const dd = String(result.getDate()).padStart(2, "0");

    return `${yyyy}-${mm}-${dd}`;
}

export function getTimeDiffMinutes(serverTime) {

  if (!serverTime)
    return null;

  const server =
    serverTime.toDate();

  const client =
    new Date();

  return Math.abs(
    server.getTime() -
    client.getTime()
  ) / MILLISECONDS_PER_MINUTE;

}

export async function refreshServerTime(db) {

  const ref =
    doc(
      db,
      "system",
      "config"
    );

  await updateDoc(ref, {
    serverTime: serverTimestamp()
  });

  const snap =
    await getDoc(ref);

  return snap.data().serverTime;

}
