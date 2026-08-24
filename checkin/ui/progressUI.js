import { 
  $,
  qs
 } from "./dom.js";

const CHECKIN_STEPS = {

  start: {
    percent: 0,
    message: "🚀 เริ่มต้น..."
  },

  //checkin steps
  checkTime: {
    percent: 10,
    message: "🔍 ตรวจสอบเวลา..."
  },

  loadStudent: {
    percent: 25,
    message: "📚 ค้นหาข้อมูลนักเรียน..."
  },

  attendance: {
    percent: 40,
    message: "📊 ตรวจสอบสถานะ..."
  },

  autoCheckout: {
    percent: 60,
    message: "⏰ เคลียร์เช็คอินค้าง..."
  },

  saveAttendance: {
    percent: 75,
    message: "💾 บันทึกข้อมูลเช็คอิน..."
  },

  weeklyPlan: {
    percent: 85,
    message: "📈 อัปเดตสถิติรายสัปดาห์..."
  },

  schedule: {
    percent: 92,
    message: "📅 อัปเดตตารางสรุป..."
  },

  saveSchedule: {
    percent: 96,
    message: "💾 Saving schedule..."
  },

  done: {
    percent: 100,
    message: "🎉 สำเร็จ!"
  },

  // build schedule steps
  checkinSchedule: {
    percent: 5,
    message: "🔍 Checking schedule...",
  },

  buildSchedule: {
    percent: 10,  
    message: "📚 Building schedule...",
  },

  finalizeSchedule: {
    percent: 95,
    message: "🧩 Finalizing...",
  },

  ready: {
    percent: 100,
    message: "✅ Ready",
  }

};

export function updateProgress(
  step
){

  const config =
    CHECKIN_STEPS[step] ||
    CHECKIN_STEPS[String(step).toLowerCase()];

  if(!config){
    return;
  }

  setProgress(
    config.percent
  );

  setMessage(
    config.message
  );

}

export function updateBuildProgress(
  percent,
  message
){

  setProgress(percent);
  setMessage(message);

}

function setMessage(text){

  const label =
    $("progressText");

  if(label){
    label.innerText = text;
  }

}

//Progress-Bar
function setProgress(percent){

  percent =
    Math.max(
      0,
      Math.min(100, percent)
    );

  const bar =
    $("progressFill");

  const wrapper =
    $("progress-bar");

  if(bar){
    bar.style.width =
      percent + "%";
  }

  if(wrapper){

    wrapper.classList.toggle(
      "loading",
      percent < 100
    );
  }
}

export function hideProgressUI(){

  const progressBar = qs(".progress-bar");

  if(progressBar){
    progressBar.style.display =
      "none";
  }

  $("progressText").style.display = "none";
}

export function showProgressUI(){

  const progressBar = qs(".progress-bar");

  if(progressBar){
    progressBar.style.display =
      "";
  }

  $("progressText").style.display =
    "";
    
}
