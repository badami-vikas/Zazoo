// MV3 service worker — minimal message relay.
// The popup talks directly to the content script via chrome.tabs.sendMessage;
// this background script only handles extension install/update bookkeeping.

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    console.log('[Bridge Recon] Extension installed.');
  }
});
