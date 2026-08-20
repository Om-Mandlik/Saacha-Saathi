//Global State & Configuration 
// Avoid redeclaration errors upon script re-injection
window.SAACHA_SAATHI = window.SAACHA_SAATHI || {
  BACKEND_URL: "http://localhost:5000/api/check",
  lastSentText: "",
  intervalId: null,
  activePopupTimer: null,
  debounceTimer: null,
};

// Clear existing interval if script is re-injected
if (window.SAACHA_SAATHI.intervalId) {
  clearInterval(window.SAACHA_SAATHI.intervalId);
}

console.log("🚀 [Saacha Saathi] Content script initialized.");

//Main Scraping & Debounce Logic 
function scrapeCaptions() {
  const captionWindow = document.querySelector('.ytp-caption-window-container');
  
  if (!captionWindow) {
    return; // Subtitles disabled or hidden
  }

  const captionSegments = document.querySelectorAll('.ytp-caption-segment');
  if (captionSegments.length === 0) return;

  const currentText = Array.from(captionSegments)
    .map(el => el.innerText)
    .join(" ")
    .replace(/\s+/g, ' ')
    .trim();

  // Ignore short fragments (under 15 chars) or duplicate texts
  if (currentText.length < 15 || currentText === window.SAACHA_SAATHI.lastSentText) {
    return;
  }

  // Debounce backend request by 1 second to wait for live YouTube captions to stabilize
  clearTimeout(window.SAACHA_SAATHI.debounceTimer);
  window.SAACHA_SAATHI.debounceTimer = setTimeout(() => {
    window.SAACHA_SAATHI.lastSentText = currentText;
    sendToBackend(currentText);
  }, 1000);
}

//Backend Communication 
async function sendToBackend(text) {
  console.log(`📦 [Saacha Saathi] Analyzing: "${text}"`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s network timeout

    const response = await fetch(window.SAACHA_SAATHI.BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.misinformation) {
      console.warn("🚨 [Saacha Saathi] Misinformation flag triggered!", data);
      showFactCheckPopup(data.claim, data.correction);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn("⚠️ [Saacha Saathi] Request timed out.");
    } else {
      console.error("🔴 [Saacha Saathi] Backend connection failure:", err.message);
    }
  }
}

//Dynamic UI Popup Component
function showFactCheckPopup(claim, correction) {
  // Remove existing popup and clear auto-dismiss timers
  const oldPopup = document.getElementById('saacha-saathi-popup');
  if (oldPopup) oldPopup.remove();
  if (window.SAACHA_SAATHI.activePopupTimer) {
    clearTimeout(window.SAACHA_SAATHI.activePopupTimer);
  }

  const popup = document.createElement('div');
  popup.id = 'saacha-saathi-popup';

  popup.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 24px;
    z-index: 2147483647;
    background: #18181b;
    color: #f4f4f5;
    padding: 14px 16px;
    border-radius: 10px;
    border-left: 4px solid #ef4444;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    max-width: 340px;
    pointer-events: auto;
    transition: opacity 0.2s ease-in-out;
  `;

  // Safely insert content using textContent to prevent HTML injection XSS
  const header = document.createElement('div');
  header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-weight: 600; color: #ef4444;";
  header.textContent = "⚠️ Fact Check Alert";

  const closeBtn = document.createElement('span');
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "cursor: pointer; opacity: 0.7; font-size: 14px;";
  closeBtn.onclick = () => popup.remove();
  header.appendChild(closeBtn);

  const claimEl = document.createElement('div');
  claimEl.style.marginBottom = "6px";
  claimEl.innerHTML = `<strong>Claim:</strong> `;
  const claimText = document.createElement('span');
  claimText.textContent = `"${claim}"`;
  claimEl.appendChild(claimText);

  const correctionEl = document.createElement('div');
  correctionEl.innerHTML = `<strong>Correction:</strong> `;
  const correctionText = document.createElement('span');
  correctionText.textContent = correction;
  correctionEl.appendChild(correctionText);

  popup.appendChild(header);
  popup.appendChild(claimEl);
  popup.appendChild(correctionEl);

  document.body.appendChild(popup);

  // Dismiss popup after 8 seconds
  window.SAACHA_SAATHI.activePopupTimer = setTimeout(() => {
    if (popup && popup.parentElement) {
      popup.remove();
    }
  }, 8000);
}

//Start Polling 
window.SAACHA_SAATHI.intervalId = setInterval(scrapeCaptions, 1500);

// Listen for URL changes sent by background.js when navigating YouTube SPA
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "YOUTUBE_URL_CHANGED") {
    console.log("🔄 [Saacha Saathi] Video changed. Resetting state...");
    if (window.SAACHA_SAATHI) {
      window.SAACHA_SAATHI.lastSentText = ""; // Clear last processed subtitle
    }
  }
});