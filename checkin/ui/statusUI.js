import confetti from "https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/+esm";
// --- 1. Firebase Core & Firestore ---

import { triggerFeedback } from "../audio/audio.js";
import { $ } from "./dom.js";

export function showStatus(
  message,
  color = "transparent"
){

  const el = $("status");

  el.style.color = color;
  el.innerHTML = message || "&nbsp;";
}

export function showError(message, color = "red"){

  showStatus(message, color);

  triggerFeedback("error");

}

export function showSuccess(message){

  showStatus(message, "green");

  triggerFeedback("success");
  
  playConfetti();

}

function playConfetti(){

  const duration = 2 * 1000;

  const animationEnd =
    Date.now() + duration;

  const defaults = {
    startVelocity: 30,
    spread: 360,
    ticks: 60,
    zIndex: 9999
  };

  function randomInRange(min, max){

    return Math.random() *
      (max - min) + min;

  }

  const interval = setInterval(()=>{

    const timeLeft =
      animationEnd - Date.now();

    if(timeLeft <= 0){

      clearInterval(interval);
      return;

    }

    const particleCount =
      50 * (timeLeft / duration);

    confetti({
      ...defaults,
      particleCount,
      origin:{
        x: randomInRange(0.1, 0.3),
        y: Math.random() - 0.2
      }
    });

    confetti({
      ...defaults,
      particleCount,
      origin:{
        x: randomInRange(0.7, 0.9),
        y: Math.random() - 0.2
      }
    });

  },250);

}