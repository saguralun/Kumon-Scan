import {
  loadTodaySettingCache
} from "../modules/storage.js";

import * as statusUI from "../ui/statusUI.js";

// 🔹 ตรวจสอบวันเวลา เปิด-ปิด ก่อน
export async function checkTodayAndTime(todaySetting = loadTodaySettingCache()) {


  if (!isValidTodaySetting(todaySetting)) {
      statusUI.showError("ยังโหลดข้อมูลวันเรียนไม่สำเร็จ กรุณาลองใหม่");
      return false;
  }

  //ตรวจสอบว่าวันเปิดไหม
  if (todaySetting.enabled === false) {

    statusUI.showError("❌ วันนี้ไม่เปิดการเรียนการสอน");
    return false;

  }

  //ตรวจสอบว่าอยู่ในเวลาเปิดไหม
  const checkTime =
    isWithinTime(todaySetting.open, todaySetting.close);

  if (!checkTime) {
    statusUI.showError("⏰ ยังไม่อยู่ในช่วงเวลาเปิดทำการ");
    return false;
  }

  return true; // ผ่านทั้งสองอย่าง

}

export function isValidTodaySetting(setting) {
  if (!setting || typeof setting.enabled !== "boolean") return false;
  if (!setting.enabled) return true;
  const timePattern = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;
  return typeof setting.open === "string" && typeof setting.close === "string" &&
    timePattern.test(setting.open) && timePattern.test(setting.close);
}

// 🔹 ตรวจสอบเวลาอยู่ในช่วงที่เปิด
export function isWithinTime(openTime, closeTime) {

  const now = new Date();

  const [openH, openM] = openTime.split(":").map(Number);
  const [closeH, closeM] = closeTime.split(":").map(Number);

  const open = new Date();
  open.setHours(openH, openM, 0, 0);

  const close = new Date();
  close.setHours(closeH, closeM, 0, 0);

  return now >= open && now <= close;

}
