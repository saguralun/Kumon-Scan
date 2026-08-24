import {
  logError,
  debugLog,
} from "/shared/index.js";

import {
  loadTodaySettingCache
} from "../modules/storage.js";

import * as statusUI from "../ui/statusUI.js";

// 🔹 ตรวจสอบวันเวลา เปิด-ปิด ก่อน
export async function checkTodayAndTime() {

  const todaySetting = loadTodaySettingCache();


  if (!todaySetting) {
      statusUI.showError("ข้อมูลวันเรียนสูญหาย กรุณารีเฟรช");
      return false;
  }

  //ตรวจสอบว่าวันเปิดไหม
  if (todaySetting.enabled !== true) {

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