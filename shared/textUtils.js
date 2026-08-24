// 🛡️ ป้องกัน XSS เวลาแทรกข้อความ (ชื่อนักเรียน, nickname, ฯลฯ) เข้า innerHTML
// ใช้ครอบทุกจุดที่เอาข้อมูลจาก Firestore/CSV import มาแสดงผลเป็น HTML
export function escapeHtml(value) {

  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

}
