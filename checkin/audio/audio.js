
let globalAudioCtx = null;

const ENABLE_SOUND = true;

export function triggerFeedback(type) {

  unlockAudio();

  if (navigator.vibrate) {
    if (type === 'tap') navigator.vibrate(40);      // สั่นเบาๆ ตอนกดเลข
    else if (type === 'success') navigator.vibrate([50, 30, 50]); // สั่น 2 ครั้งสั้นๆ
    else if (type === 'error') navigator.vibrate(200);   // สั่นยาวครั้งเดียว
    else if(type === 'blocked') navigator.vibrate([120,60,120]);
  }
  
  // เสียง (Sound)
  if (ENABLE_SOUND) {
    playSound(type);
  }
}

function unlockAudio(){

  if(!globalAudioCtx){

    globalAudioCtx =
      new (
        window.AudioContext ||
        window.webkitAudioContext
      )();

  }

  if(globalAudioCtx.state === "suspended"){
    globalAudioCtx.resume();
  }

}

function playSound(type) {
  
  if(!globalAudioCtx){

    globalAudioCtx =
      new (
        window.AudioContext ||
        window.webkitAudioContext
      )();

  }
  const audioCtx = globalAudioCtx;

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;

  if (type === 'success') {
    // --- เสียง "ตึ้ง!" แบบ LINE (ใสและเด้ง) ---
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine'; // เสียงนุ่มใส
    // เริ่มที่โน้ตต่ำแล้วกระโดดไปโน้ตสูงทันที (สร้างความเด้ง)
    osc.frequency.setValueAtTime(400, now); 
    osc.frequency.exponentialRampToValueAtTime(1000, now + 0.05); 

    // การคุมความดัง (Envelope) ให้มีหางเสียงนิดๆ เหมือนกระดิ่ง
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02); // ดังขึ้นเร็วๆ
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5); // ค่อยๆ หายไป

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.5);

  } else if (type === 'error') {
    // --- เสียงเตือนแบบนุ่มนวล (ไม่กระด้าง) ---
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle'; // เสียงจะหนากว่า sine นิดหน่อยแต่ไม่แผด
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.15);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
 
  } else if (type === 'tap') {
    // เสียงคลิกเบาๆ เวลาจิ้มตัวเลข
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  }else if(type === 'blocked'){

    const osc1 =
      audioCtx.createOscillator();

    const gain1 =
      audioCtx.createGain();

    // 🔹 ติ๊งสั้นๆ
    osc1.type = 'sine';

    osc1.frequency.setValueAtTime(
      600,
      now
    );

    osc1.frequency.exponentialRampToValueAtTime(
      850,
      now + 0.04
    );

    gain1.gain.setValueAtTime(
      0,
      now
    );

    gain1.gain.linearRampToValueAtTime(
      0.1,
      now + 0.01
    );

    gain1.gain.exponentialRampToValueAtTime(
      0.01,
      now + 0.08
    );

    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);

    osc1.start(now);
    osc1.stop(now + 0.08);

    // 🔹 ปิดท้าย low tone
    const osc2 =
      audioCtx.createOscillator();

    const gain2 =
      audioCtx.createGain();

    osc2.type = 'triangle';

    osc2.frequency.setValueAtTime(
      180,
      now + 0.09
    );

    osc2.frequency.linearRampToValueAtTime(
      130,
      now + 0.25
    );

    gain2.gain.setValueAtTime(
      0.12,
      now + 0.09
    );

    gain2.gain.exponentialRampToValueAtTime(
      0.01,
      now + 0.28
    );

    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);

    osc2.start(now + 0.09);
    osc2.stop(now + 0.28);
  }
}