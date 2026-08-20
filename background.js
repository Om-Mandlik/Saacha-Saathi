// Keep track of tabs where the content script has already been initialized
const activeTabs = new Set();

// Clean up tab tracking when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});

// Clean up tab tracking if the tab navigates away from YouTube
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && !changeInfo.url.includes("youtube.com/watch")) {
    activeTabs.delete(tabId);
  }
});

// Handle web navigation events to support YouTube SPA page switches
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  // Execute only in the main frame (frameId 0), not in sub-iframes
  if (details.frameId !== 0) return;

  if (details.url && details.url.includes("youtube.com/watch")) {
    const tabId = details.tabId;

    // Optional: Avoid re-injecting if already active in this tab session
    if (activeTabs.has(tabId)) {
      console.log(`[Background] Content script already injected in tab ${tabId}. Signaling URL change.`);
      
      // Ping the content script that the video URL changed without re-executing the entire file
      chrome.tabs.sendMessage(tabId, { action: "YOUTUBE_URL_CHANGED", url: details.url }).catch(() => {
        // If message fails (script died or context invalidated), re-inject
        injectContentScript(tabId);
      });
      return;
    }

    injectContentScript(tabId);
  }
});

async function injectContentScript(tabId) {
  try {
    console.log(`[Background] Injecting content script into tab ${tabId}...`);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"]
    });
    activeTabs.add(tabId);
  } catch (err) {
    console.error(`[Background] Script injection failed for tab ${tabId}:`, err);
  }
}