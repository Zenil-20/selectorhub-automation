// MV3 service worker — message router, durable history, recording session,
// backend sync, and AI suggestion fetching. Short-lived: every piece of
// cross-event state lives in chrome.storage.local.

const SETTINGS_KEY = 'anchor.settings.v1';
const HISTORY_KEY  = 'anchor.history.v1';
const HISTORY_MAX  = 50;
const REC_KEY      = 'anchor.recording.v1';

const DEFAULT_SETTINGS = Object.freeze({
  serverUrl: 'http://localhost:7821',
  apiKey: '',
  syncCaptures: true,
  aiEnabled: true,
});

async function loadSettings() {
  const { [SETTINGS_KEY]: stored = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...stored };
}

// ---------- backend sync --------------------------------------------------
async function postCaptureToBackend(payload) {
  const s = await loadSettings();
  if (!s.syncCaptures || !s.apiKey || !s.serverUrl) return null;
  try {
    const r = await fetch(`${s.serverUrl.replace(/\/$/, '')}/api/captures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-key': s.apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.capture || null;
  } catch (_) { return null; }
}

async function fetchAiSuggestions(captureId, pageContext) {
  const s = await loadSettings();
  if (!s.aiEnabled || !s.apiKey || !s.serverUrl) return null;
  try {
    const r = await fetch(`${s.serverUrl.replace(/\/$/, '')}/api/llm/suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-key': s.apiKey },
      body: JSON.stringify({ captureId, pageContext }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json();
    return data;
  } catch (e) {
    return { ok: false, error: e.message || 'network error' };
  }
}

// Phase-2: natural-language intent → grounded Playwright test.
async function fetchGenerateTest({ intent, route }) {
  const s = await loadSettings();
  if (!s.apiKey || !s.serverUrl) {
    return { ok: false, error: 'Configure server URL and project API key in Settings.' };
  }
  try {
    const r = await fetch(`${s.serverUrl.replace(/\/$/, '')}/api/llm/generate-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-key': s.apiKey },
      body: JSON.stringify({ intent, route }),
      signal: AbortSignal.timeout(60000),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: e.message || 'network error' };
  }
}

// Phase-2b: recorder enrichment.
async function fetchEnrichRecording(rawSteps) {
  const s = await loadSettings();
  if (!s.apiKey || !s.serverUrl) {
    return { ok: false, error: 'Configure server URL and project API key in Settings.' };
  }
  try {
    const r = await fetch(`${s.serverUrl.replace(/\/$/, '')}/api/llm/enrich-recording`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-anchor-key': s.apiKey },
      body: JSON.stringify({ rawSteps }),
      signal: AbortSignal.timeout(60000),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: e.message || 'network error' };
  }
}

// ---------- local history ------------------------------------------------
async function pushHistory(entry) {
  const { [HISTORY_KEY]: existing = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const next = [entry, ...existing].slice(0, HISTORY_MAX);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
}

async function getHistory() {
  const { [HISTORY_KEY]: existing = [] } = await chrome.storage.local.get(HISTORY_KEY);
  return existing;
}

async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
}

// ---------- recording session --------------------------------------------
async function getRecording() {
  const { [REC_KEY]: rec } = await chrome.storage.local.get(REC_KEY);
  return rec || null;
}
async function setRecording(rec) {
  if (!rec) await chrome.storage.local.remove(REC_KEY);
  else await chrome.storage.local.set({ [REC_KEY]: rec });
}
async function startRecording(tabId, url) {
  const rec = {
    tabId, startUrl: url, startTs: Date.now(),
    steps: [{ type: 'goto', url, ts: Date.now() }],
    testName: 'recorded flow',
  };
  await setRecording(rec);
  return rec;
}
function sameLocator(a, b) {
  if (!a || !b) return false;
  return a.strategy === b.strategy && a.value === b.value && a.role === b.role && a.name === b.name;
}
async function appendStep(step) {
  const rec = await getRecording();
  if (!rec) return;
  const last = rec.steps[rec.steps.length - 1];
  if (step.type === 'fill' && last && last.type === 'fill' && sameLocator(last.locator, step.locator)) {
    last.value = step.value; last.ts = step.ts;
  } else {
    rec.steps.push(step);
  }
  await setRecording(rec);
}
async function stopRecording() {
  const rec = await getRecording();
  await setRecording(null);
  return rec;
}
async function recordNavigation(tabId, url) {
  const rec = await getRecording();
  if (!rec || rec.tabId !== tabId) return;
  const last = [...rec.steps].reverse().find((s) => s.type === 'goto');
  const lastUrl = last ? last.url : rec.startUrl;
  if (url === lastUrl) return;
  await appendStep({ type: 'goto', url, ts: Date.now() });
}
chrome.webNavigation.onCommitted.addListener((d) => { if (d.frameId === 0) recordNavigation(d.tabId, d.url); });
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => { if (d.frameId === 0) recordNavigation(d.tabId, d.url); });

// ---------- on-demand injection ------------------------------------------
const CONTENT_FILES = [
  'src/core/css-escape.js',
  'src/core/aria.js',
  'src/core/css-selector.js',
  'src/core/xpath.js',
  'src/core/scoring.js',
  'src/core/codegen.js',
  'src/core/assertions.js',
  'src/core/strategies.js',
  'src/core/locator-engine.js',
  'src/content/highlighter.js',
  'src/content/picker.js',
  'src/content/recorder.js',
  'src/content/index.js',
];
function isInjectableUrl(url) {
  if (!url) return false;
  return /^(https?|file|ftp):/.test(url);
}
function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      chrome.webNavigation.onDOMContentLoaded.removeListener(handler);
      clearTimeout(timer);
      resolve();
    };
    const handler = (d) => { if (d.tabId === tabId && d.frameId === 0) finish(); };
    chrome.webNavigation.onDOMContentLoaded.addListener(handler);
    const timer = setTimeout(finish, timeoutMs);
  });
}
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SH_PING' });
  } catch (_) {
    await injectContentScripts(tabId);
  }
}
async function injectContentScripts(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId, allFrames: true },
    files: ['src/content/overlay.css'],
  }).catch(() => {});
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: CONTENT_FILES,
  });
}

// ---------- message routing ----------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'SH_PING') { sendResponse({ ok: true }); return; }

  if (msg.type === 'SH_PICK_RESULT') {
    (async () => {
      const payload = msg.payload || {};
      // Push to backend, then merge the assigned captureId back into the
      // local entry so the popup can request AI suggestions for it.
      const backendCapture = await postCaptureToBackend({
        url: payload.url,
        description: payload.description,
        candidates: payload.candidates || [],
        snapshot: payload.snapshot,
        domExcerpt: payload.domExcerpt,
      });
      const entry = {
        id: backendCapture?.id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        captureId: backendCapture?.id || null,
        ts: Date.now(),
        url: payload.url || sender.tab?.url || '',
        description: payload.description || '',
        candidates: payload.candidates || [],
        snapshot: payload.snapshot || null,
        assertions: payload.assertions || null,
        synced: !!backendCapture,
        ai: null,
      };
      await pushHistory(entry);
      chrome.runtime.sendMessage({ type: 'SH_PICK_FORWARD', payload: entry }).catch(() => {});

      // Kick off AI suggestion fetch in the background; popup gets a separate
      // forward when it returns. Failure is silent — the heuristic UI still works.
      if (entry.captureId) {
        fetchAiSuggestions(entry.captureId, { url: entry.url }).then((aiResp) => {
          if (!aiResp || !aiResp.ok) return;
          chrome.runtime.sendMessage({
            type: 'SH_AI_FORWARD',
            payload: { entryId: entry.id, captureId: entry.captureId, ai: aiResp },
          }).catch(() => {});
          // Persist on the history entry so reopening the popup retains them.
          (async () => {
            const list = await getHistory();
            const i = list.findIndex((h) => h.id === entry.id);
            if (i >= 0) {
              list[i] = { ...list[i], ai: aiResp };
              await chrome.storage.local.set({ [HISTORY_KEY]: list });
            }
          })();
        });
      }
    })();
    return;
  }

  if (msg.type === 'SH_RECORD_STEP') {
    appendStep(msg.payload).then(() => {
      chrome.runtime.sendMessage({ type: 'SH_RECORD_FORWARD' }).catch(() => {});
    });
    return;
  }

  if (msg.type === 'SH_QUERY_STATE') {
    (async () => {
      const rec = await getRecording();
      const tabId = sender.tab?.id;
      sendResponse({
        recording: !!(rec && tabId === rec.tabId),
        stepCount: rec ? rec.steps.length : 0,
      });
    })();
    return true;
  }

  if (msg.type === 'SH_GET_HISTORY') {
    getHistory().then((h) => sendResponse({ ok: true, history: h }));
    return true;
  }
  if (msg.type === 'SH_CLEAR_HISTORY') {
    clearHistory().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'SH_GET_RECORDING') {
    getRecording().then((rec) => sendResponse({ ok: true, recording: rec }));
    return true;
  }
  if (msg.type === 'SH_GET_SETTINGS') {
    loadSettings().then((s) => sendResponse({ ok: true, settings: s }));
    return true;
  }
  if (msg.type === 'SH_REFRESH_AI') {
    (async () => {
      if (!msg.captureId) return sendResponse({ ok: false, error: 'captureId required' });
      const ai = await fetchAiSuggestions(msg.captureId, msg.pageContext);
      sendResponse(ai || { ok: false });
    })();
    return true;
  }

  if (msg.type === 'SH_GENERATE_TEST') {
    (async () => {
      if (!msg.intent) return sendResponse({ ok: false, error: 'intent required' });
      sendResponse(await fetchGenerateTest({ intent: msg.intent, route: msg.route }));
    })();
    return true;
  }

  if (msg.type === 'SH_ENRICH_RECORDING') {
    (async () => {
      if (!Array.isArray(msg.rawSteps) || !msg.rawSteps.length) {
        return sendResponse({ ok: false, error: 'rawSteps required' });
      }
      sendResponse(await fetchEnrichRecording(msg.rawSteps));
    })();
    return true;
  }

  if (msg.type === 'SH_REQUEST_PICK') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return sendResponse({ ok: false, error: 'No active tab' });
      if (!isInjectableUrl(tab.url)) {
        return sendResponse({ ok: false, error: 'Cannot run on this page (chrome://, web store, or PDF). Open a normal http(s) page.' });
      }
      try {
        await ensureContentScript(tab.id);
        await chrome.tabs.sendMessage(tab.id, { type: 'SH_START_PICK' });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || 'Could not start picker' });
      }
    })();
    return true;
  }

  if (msg.type === 'SH_REQUEST_RECORD_START') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return sendResponse({ ok: false, error: 'No active tab' });
      const targetUrl = (msg.url || tab.url || '').trim();
      if (!isInjectableUrl(targetUrl)) {
        return sendResponse({ ok: false, error: 'URL must start with http(s)://' });
      }
      try {
        await startRecording(tab.id, targetUrl);
        if (tab.url !== targetUrl) {
          const navDone = waitForTabComplete(tab.id);
          await chrome.tabs.update(tab.id, { url: targetUrl });
          await navDone;
        }
        await ensureContentScript(tab.id);
        await chrome.tabs.sendMessage(tab.id, { type: 'SH_START_RECORD' });
        sendResponse({ ok: true });
      } catch (e) {
        await setRecording(null);
        sendResponse({ ok: false, error: e.message || 'Could not start recording' });
      }
    })();
    return true;
  }

  if (msg.type === 'SH_REQUEST_RECORD_STOP') {
    (async () => {
      const rec = await stopRecording();
      if (rec) {
        try { await chrome.tabs.sendMessage(rec.tabId, { type: 'SH_STOP_RECORD' }); }
        catch (_) {}
      }
      sendResponse({ ok: true, recording: rec });
    })();
    return true;
  }
});
