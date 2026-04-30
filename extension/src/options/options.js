// Settings page — persists to chrome.storage.local under one canonical key.
// The popup and service worker read the same key. Never duplicate config.

const KEY = 'anchor.settings.v1';
const DEFAULTS = Object.freeze({
  serverUrl: 'http://localhost:7821',
  apiKey: '',
  syncCaptures: true,
  aiEnabled: true,
});

const $ = (s) => document.querySelector(s);

async function load() {
  const { [KEY]: stored = {} } = await chrome.storage.local.get(KEY);
  return { ...DEFAULTS, ...stored };
}
async function save(settings) {
  await chrome.storage.local.set({ [KEY]: settings });
}

function setStatus(msg, kind = '') {
  const el = $('#status');
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

async function init() {
  const s = await load();
  $('#server-url').value = s.serverUrl;
  $('#api-key').value = s.apiKey;
  $('#sync-captures').checked = !!s.syncCaptures;
  $('#ai-enabled').checked = !!s.aiEnabled;

  $('#save-btn').addEventListener('click', async () => {
    const next = {
      serverUrl: $('#server-url').value.trim() || DEFAULTS.serverUrl,
      apiKey: $('#api-key').value.trim(),
      syncCaptures: $('#sync-captures').checked,
      aiEnabled: $('#ai-enabled').checked,
    };
    await save(next);
    setStatus('Saved.', 'ok');
  });

  $('#test-btn').addEventListener('click', async () => {
    setStatus('Testing…');
    try {
      const url = $('#server-url').value.trim() || DEFAULTS.serverUrl;
      const r = await fetch(`${url.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      const data = await r.json();
      if (!data.ok) throw new Error('Server returned not-ok');
      const lines = [
        `service=${data.service} v${data.version}`,
        `db=${data.db ? 'ok' : 'down'}`,
        `llm=${data.llmConfigured ? 'configured (' + data.model + ')' : 'NOT configured'}`,
      ];
      setStatus(lines.join(' · '), 'ok');
    } catch (e) {
      setStatus('Cannot reach server: ' + (e.message || e), 'err');
    }
  });
}

init();
