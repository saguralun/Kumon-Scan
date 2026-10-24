import { escapeHtml } from "/shared/textUtils.js";

const PENDING_MESSAGE = "รับรายการเช็กอินแล้ว กำลังรอยืนยันจากระบบ<br>นักเรียนคนถัดไปเช็กอินต่อได้ทันที ไม่ต้องกรอกรหัสซ้ำ<br>กรุณาเปิดหน้านี้ไว้ รายการจะหายจากคิวเมื่อยืนยันสำเร็จ";
const FAILED_MESSAGE = "ยังยืนยันรายการไม่สำเร็จ<br>กรุณาตรวจสอบรายการด้านล่าง แล้วกดปุ่มลองใหม่<br>ไม่ต้องกรอกรหัสซ้ำ";

export function createCheckinJobStatus({ getJob, showStatus }) {
  let watched = null;
  let lastStatus = null;

  function clear() {
    watched = null;
    lastStatus = null;
  }

  function refresh() {
    if (!watched) return;
    const job = getJob(watched.id);
    if (!job || job.requestId !== watched.requestId) return clear();
    if (job.status === lastStatus) return;
    lastStatus = job.status;

    if (job.status === "pending") {
      showStatus(PENDING_MESSAGE, "#946200");
    } else if (job.status === "failed") {
      showStatus(FAILED_MESSAGE, "#b42318");
    } else if (job.status === "done") {
      const reward = job.result?.reward;
      const rewardMessage = reward
        ? `บันทึกรางวัล${reward.name ? ` ${escapeHtml(reward.name)} ` : ""}ใน Collection แล้ว<br>`
        : "";
      showStatus(`ยืนยันการเช็กอินสำเร็จแล้ว<br>${rewardMessage}กรอกรหัสเดิมเพื่อเปิดดู Collection ได้ โดยไม่เช็กอินหรือสุ่มรางวัลซ้ำ`, "#267744");
    }
  }

  return {
    watch(job) {
      watched = { id: job.id, requestId: job.requestId };
      lastStatus = null;
      refresh();
    },
    refresh,
    // Typing or submitting another ID transfers ownership of the shared status area.
    clear,
  };
}
