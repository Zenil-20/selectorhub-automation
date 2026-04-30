(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  // Re-entry guard — content scripts may be injected twice (manifest auto-
  // load + on-demand executeScript). We must not bind the message listener
  // more than once or each pick would fire N times.
  if (SH._wired) return;
  SH._wired = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'SH_START_PICK') {
      SH.picker.start((result) => {
        if (result.cancelled) {
          chrome.runtime.sendMessage({ type: 'SH_PICK_CANCELLED' });
          return;
        }
        chrome.runtime.sendMessage({ type: 'SH_PICK_RESULT', payload: result });
      });
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'SH_STOP_PICK') {
      SH.picker.stop();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'SH_START_RECORD') {
      SH.recorder.start();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'SH_STOP_RECORD') {
      SH.recorder.stop();
      sendResponse({ ok: true });
      return true;
    }
  });

  // Ask the worker whether a recording session is in progress so this newly
  // loaded content script (e.g. after a navigation) auto-resumes recording.
  try {
    chrome.runtime.sendMessage({ type: 'SH_QUERY_STATE' }, (state) => {
      if (chrome.runtime.lastError) return;
      if (state && state.recording) SH.recorder.start();
    });
  } catch (_) { /* worker not ready */ }

  window.addEventListener('pagehide', () => {
    SH.picker.stop();
    // Don't stop the recorder on pagehide — the recording session continues
    // across navigations; the next page-load auto-resumes from QUERY_STATE.
  });
})();
