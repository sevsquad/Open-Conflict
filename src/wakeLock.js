// ════════════════════════════════════════════════════════════════
// Wake Lock — prevents computer sleep during long scans.
// Uses Screen Wake Lock API (Chrome/Edge/Safari) with silent
// video fallback (Firefox and older browsers).
// ════════════════════════════════════════════════════════════════

let wakeLock = null;
let videoEl = null;

/**
 * Request wake lock to prevent system sleep.
 * Returns true if successfully acquired.
 */
export async function acquireWakeLock() {
  // Try native Wake Lock API first
  if ("wakeLock" in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
      return true;
    } catch (e) {
      // Falls through to video fallback
    }
  }

  // Fallback: play a tiny looping video to prevent sleep
  // Browsers won't sleep while media is playing
  if (!videoEl) {
    videoEl = document.createElement("video");
    videoEl.setAttribute("playsinline", "");
    videoEl.setAttribute("muted", "");
    videoEl.setAttribute("loop", "");
    videoEl.style.position = "fixed";
    videoEl.style.left = "-9999px";
    videoEl.style.width = "1px";
    videoEl.style.height = "1px";
    // Minimal valid mp4 (1×1 pixel, 1 frame) encoded as base64 data URI
    videoEl.src = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAA" +
      "htZGF0AAAA1m1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAA" +
      "AAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAYdHJhawAAAFx0a2hkA" +
      "AAADAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
      "AABgbWRpYQAAABxtZGhkAAAAAAAAAAAAAAAAAKxEAAAAAAAhhdmMxAAAAAAAAAAAAARAAAAA=";
    document.body.appendChild(videoEl);
  }
  try {
    await videoEl.play();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Release wake lock and clean up.
 */
export async function releaseWakeLock() {
  if (wakeLock) {
    try { await wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
  }
  if (videoEl) {
    videoEl.pause();
    videoEl.remove();
    videoEl = null;
  }
}

/**
 * Check if wake lock is currently active.
 */
export function isWakeLockActive() {
  return wakeLock !== null || (videoEl !== null && !videoEl.paused);
}
