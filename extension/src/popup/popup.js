// Popup script — presentation only. The service worker is the source of
// truth for history, recording sessions, and pick results.

const $ = (sel) => document.querySelector(sel);

const state = {
  framework: 'playwright',
  action: 'click',
  actionValue: '',
  current: null,
  recording: null,
  finishedTest: null,        // raw recorder Playwright source
  rawSteps: null,            // raw recorder steps, retained for enrichment
  enrichedTest: null,        // AI-enriched Playwright source
  enrichedFollowups: null,   // followUpIdeas
  enrichedMeta: null,        // { model, costUsd, latencyMs }
  showingEnriched: true,
  enriching: false,
  aiLoading: false,
  // intent (test-from-intent) panel state
  intent: '',
  intentLoading: false,
  intentResult: null,        // { code, output, audit } | null
  intentError: null,
};

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

const SH = () => globalThis.__SH;

// ---------- action helpers -----------------------------------------------
function defaultActionFor(snapshot) {
  if (!snapshot) return 'click';
  const tag = snapshot.tag;
  const t = (snapshot.attrs?.type || '').toLowerCase();
  if (tag === 'INPUT') {
    if (t === 'checkbox' || t === 'radio') return 'check';
    if (['file', 'submit', 'button', 'reset', 'image'].includes(t)) return 'click';
    return 'fill';
  }
  if (tag === 'TEXTAREA') return 'fill';
  if (tag === 'SELECT') return 'selectOption';
  return 'click';
}

function defaultValueFor(action, snapshot) {
  if (!snapshot) return '';
  if (action === 'fill' && snapshot.value) return snapshot.value;
  if (action === 'press') return 'Enter';
  return '';
}

function actionNeedsValue(action) {
  return SH().codegen.ACTIONS_WITH_VALUE.has(action);
}

function composeCode(framework, candidate, action, value) {
  const cg = SH().codegen;
  if (framework === 'playwright') return cg.playwrightAction(candidate.strategy, candidate, action, value);
  if (framework === 'cypress')    return cg.cypressAction(candidate.strategy, candidate, action, value);
  if (framework === 'selenium')   return cg.seleniumAction(candidate.strategy, candidate, action, value);
  return '';
}

// ---------- pick result rendering ----------------------------------------
function renderPick() {
  const list = $('#candidates');
  list.innerHTML = '';
  if (!state.current || !state.current.candidates?.length) {
    $('#empty').classList.remove('hidden');
    $('#result').classList.add('hidden');
    return;
  }
  $('#empty').classList.add('hidden');
  $('#result').classList.remove('hidden');

  $('#result-desc').textContent = state.current.description || '';
  $('#result-url').textContent = state.current.url || '';

  // Action value field visibility
  const valueInput = $('#action-value');
  if (actionNeedsValue(state.action)) {
    valueInput.classList.remove('hidden');
    if (state.action === 'press' && !state.actionValue) valueInput.value = 'Enter';
  } else {
    valueInput.classList.add('hidden');
  }

  // Self-healing chain (Playwright-only — semantics are what makes it possible).
  if (state.framework === 'playwright') {
    const top3 = state.current.candidates.slice(0, 3).map((c) => ({
      strategy: c.strategy, value: c.value, role: c.role, name: c.name, attribute: c.attribute,
    }));
    const chain = SH().codegen.playwrightFallbackChain(top3, state.action, state.actionValue);
    $('#chain-code').textContent = chain || '(only one candidate — chain not needed)';
    $('#chain-copy').onclick = () => copyToClipboard($('#chain-copy'), chain);
    $('#chain-code').parentElement.classList.remove('hidden');
  } else {
    $('#chain-code').parentElement.classList.add('hidden');
  }

  // Locator candidates list — code recomputed per (framework, action, value).
  for (const c of state.current.candidates) {
    const li = document.createElement('li');
    li.className = 'cand';
    const code = composeCode(state.framework, c, state.action, state.actionValue);
    li.innerHTML = `
      <div class="head">
        <span class="strategy"></span>
        <span class="score"></span>
      </div>
      <div class="code"></div>
      <div style="margin-top:6px; text-align:right;">
        <button class="copy small">Copy</button>
      </div>`;
    li.querySelector('.strategy').textContent = labelFor(c);
    li.querySelector('.score').textContent = `score ${c.score}`;
    li.querySelector('.code').textContent = code;
    const btn = li.querySelector('.copy');
    btn.addEventListener('click', () => copyToClipboard(btn, code));
    list.appendChild(li);
  }

  renderAi();

  // Assertions panel — pinned to the best Playwright locator. Hidden when the
  // active framework tab is not Playwright (assertion APIs differ wildly).
  const aList = $('#assertions');
  aList.innerHTML = '';
  const assertions = state.current.assertions?.playwright || [];
  if (state.framework !== 'playwright') {
    $('#assertions-block').classList.add('hidden');
  } else {
    $('#assertions-block').classList.remove('hidden');
    if (!assertions.length) {
      const li = document.createElement('li');
      li.className = 'muted small-text';
      li.textContent = 'No assertions could be inferred for this element.';
      aList.appendChild(li);
    } else {
      for (const a of assertions) {
        const li = document.createElement('li');
        li.className = 'assertion';
        li.innerHTML = `
          <div class="head">
            <span class="name"></span>
            <button class="copy small">Copy</button>
          </div>
          <div class="code"></div>`;
        li.querySelector('.name').textContent = a.name;
        li.querySelector('.code').textContent = a.code;
        const btn = li.querySelector('.copy');
        btn.addEventListener('click', () => copyToClipboard(btn, a.code));
        aList.appendChild(li);
      }
    }
  }
}

function labelFor(c) {
  if (c.strategy === 'role') return `role: ${c.role}`;
  return c.strategy;
}

// ---------- AI suggestions panel -----------------------------------------
// We pull the suggestion shape straight from the backend's /llm/suggest
// response. Every locatorRef is guaranteed in-corpus by the server-side
// validator — the popup never needs to defend against hallucinated ids.
function findCandidateForRef(captureIds, ref) {
  // The backend stores captures keyed by captureId; on the popup side, the
  // *focal* element is the only capture we have full code for. Render the
  // assertion as a literal Playwright snippet by looking up the locator
  // from the focal candidates if the ref points at the focal capture; for
  // any other ref we just label it with the ref id.
  return null;
}

function aiAssertionToCode(a, focalCandidates) {
  // Resolve the locatorRef. If it's the focal capture, pick the best matching
  // candidate; otherwise show the locatorRef so the engineer can find the
  // capture in History. Either way we always emit *some* working code path.
  const SH = globalThis.__SH;
  const best = focalCandidates[0];
  const locExpr = best ? SH.codegen.playwrightLocator(best.strategy, best) : `/* locatorRef:${a.locatorRef} */`;
  switch (a.type) {
    case 'toBeVisible':     return `await expect(${locExpr}).toBeVisible();`;
    case 'toBeHidden':      return `await expect(${locExpr}).toBeHidden();`;
    case 'toHaveText':      return `await expect(${locExpr}).toHaveText(${SH.jsString(a.value || '')});`;
    case 'toContainText':   return `await expect(${locExpr}).toContainText(${SH.jsString(a.value || '')});`;
    case 'toHaveValue':     return `await expect(${locExpr}).toHaveValue(${SH.jsString(a.value || '')});`;
    case 'toBeChecked':     return `await expect(${locExpr}).toBeChecked();`;
    case 'notToBeChecked':  return `await expect(${locExpr}).not.toBeChecked();`;
    case 'toBeEnabled':     return `await expect(${locExpr}).toBeEnabled();`;
    case 'toBeDisabled':    return `await expect(${locExpr}).toBeDisabled();`;
    case 'toHaveAttribute': return `await expect(${locExpr}).toHaveAttribute(${SH.jsString(a.attribute || '')}, ${SH.jsString(a.value || '')});`;
    case 'toHaveURL':       return `await expect(page).toHaveURL(${SH.jsString(a.value || '')});`;
    default:                return `// ${a.type}`;
  }
}

function renderAi() {
  const block = $('#ai-block');
  const content = $('#ai-content');
  const status = $('#ai-status');
  if (!state.current) { block.classList.add('hidden'); return; }
  if (state.framework !== 'playwright') { block.classList.add('hidden'); return; }

  block.classList.remove('hidden');
  content.innerHTML = '';

  if (state.aiLoading) {
    content.innerHTML = '<div class="ai-loading">Asking the model… (grounded against your project corpus)</div>';
    status.textContent = '';
    return;
  }

  const ai = state.current.ai;
  if (!ai) {
    if (!state.current.captureId) {
      content.innerHTML = '<div class="ai-empty">Configure the backend in Settings to enable AI suggestions.</div>';
    } else {
      content.innerHTML = '<div class="ai-empty">No AI suggestions yet — they arrive a moment after a pick.</div>';
    }
    status.textContent = '';
    return;
  }
  if (!ai.ok) {
    content.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'ai-error';
    err.textContent = ai.error || 'Failed to fetch AI suggestions.';
    content.appendChild(err);
    status.textContent = '';
    return;
  }
  const out = ai.output || {};
  const audit = ai.audit || {};

  if (out.summary) {
    const s = document.createElement('div');
    s.className = 'ai-summary';
    s.textContent = out.summary;
    content.appendChild(s);
  }

  if (Array.isArray(out.assertions) && out.assertions.length) {
    const head = document.createElement('div');
    head.className = 'ai-section-title';
    head.textContent = 'Suggested assertions';
    content.appendChild(head);
    const ul = document.createElement('ul');
    ul.className = 'assertions';
    for (const a of out.assertions) {
      const li = document.createElement('li');
      li.className = 'assertion';
      const code = aiAssertionToCode(a, state.current.candidates || []);
      li.innerHTML = `
        <div class="head">
          <span class="name"></span>
          <button class="copy small">Copy</button>
        </div>
        <div class="code"></div>
        <div class="rationale muted small-text" style="margin-top:4px;"></div>`;
      li.querySelector('.name').textContent = a.type;
      li.querySelector('.code').textContent = code;
      li.querySelector('.rationale').textContent = a.rationale || '';
      const btn = li.querySelector('.copy');
      btn.addEventListener('click', () => copyToClipboard(btn, code));
      ul.appendChild(li);
    }
    content.appendChild(ul);
  }

  if (Array.isArray(out.edgeCases) && out.edgeCases.length) {
    const head = document.createElement('div');
    head.className = 'ai-section-title';
    head.textContent = 'Edge-case test ideas';
    content.appendChild(head);
    for (const e of out.edgeCases) {
      const div = document.createElement('div');
      div.className = 'edge-case';
      const t = document.createElement('div'); t.className = 'title'; t.textContent = e.title || '';
      const r = document.createElement('div'); r.className = 'rationale'; r.textContent = e.rationale || '';
      div.appendChild(t); div.appendChild(r);
      if (Array.isArray(e.steps) && e.steps.length) {
        const ol = document.createElement('ol');
        ol.className = 'steps';
        for (const s of e.steps) {
          const li = document.createElement('li'); li.textContent = s; ol.appendChild(li);
        }
        div.appendChild(ol);
      }
      content.appendChild(div);
    }
  }

  if (audit.model) {
    const meta = document.createElement('div');
    meta.className = 'ai-meta';
    const cost = typeof audit.costUsd === 'number' ? `$${audit.costUsd.toFixed(4)}` : '—';
    const corpus = typeof audit.corpusSize === 'number' ? `${audit.corpusSize} captures` : '';
    meta.textContent = `${audit.model} · ${cost} · ${audit.latencyMs ?? '—'}ms · grounded against ${corpus}`;
    content.appendChild(meta);
  }
}

async function copyToClipboard(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = 'Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1200);
  } catch (_) { btn.textContent = 'Failed'; }
}

// ---------- recording rendering ------------------------------------------
function renderRecordingState() {
  const recBtn = $('#record-btn');
  if (state.recording) {
    $('#rec-state').classList.remove('hidden');
    $('#rec-count').textContent = `${state.recording.steps?.length || 0} steps`;
    recBtn.textContent = 'Recording…';
    recBtn.disabled = true;
  } else {
    $('#rec-state').classList.add('hidden');
    recBtn.textContent = 'Record';
    recBtn.disabled = false;
  }
}

function renderRecordedTest() {
  if (!state.finishedTest && !state.enrichedTest) {
    $('#rec-output').classList.add('hidden');
    return;
  }
  $('#rec-output').classList.remove('hidden');

  const haveEnriched = !!state.enrichedTest;
  $('#rec-toggle').classList.toggle('hidden', !haveEnriched);
  $('#rec-followups').classList.toggle('hidden', !(haveEnriched && state.enrichedFollowups?.length));
  $('#rec-enrich').classList.toggle('hidden', haveEnriched);

  if (state.enriching) {
    $('#rec-code').textContent = '// Asking the model to enrich your recording…';
    $('#rec-title').textContent = 'Enriching with AI…';
    return;
  }

  $('#rec-title').textContent = haveEnriched
    ? (state.showingEnriched ? 'AI-enriched test' : 'Raw recorded test')
    : 'Recorded Playwright test';

  const code = haveEnriched && state.showingEnriched ? state.enrichedTest : state.finishedTest;
  $('#rec-code').textContent = code || '// (empty)';

  if (haveEnriched && state.enrichedMeta) {
    const { model, costUsd, latencyMs, corpusSize } = state.enrichedMeta;
    const c = typeof costUsd === 'number' ? `$${costUsd.toFixed(4)}` : '—';
    $('#rec-meta').textContent = `${model} · ${c} · ${latencyMs ?? '—'}ms · grounded against ${corpusSize ?? '?'} captures`;
  } else {
    $('#rec-meta').textContent = '';
  }

  // Followups list
  const list = $('#rec-followup-list');
  list.innerHTML = '';
  for (const f of state.enrichedFollowups || []) {
    const li = document.createElement('li');
    li.innerHTML = `<strong></strong> — <span></span>`;
    li.querySelector('strong').textContent = f.title || '';
    li.querySelector('span').textContent = f.rationale || '';
    list.appendChild(li);
  }

  // Toggle visual state
  document.querySelectorAll('#rec-toggle .toggle').forEach((t) => {
    const isActive = (t.dataset.which === 'enriched') === state.showingEnriched;
    t.classList.toggle('active', isActive);
  });
}

async function refreshRecording() {
  const res = await send({ type: 'SH_GET_RECORDING' });
  state.recording = res?.recording || null;
  renderRecordingState();
}

// ---------- history rendering --------------------------------------------
async function renderHistory() {
  const { history = [] } = (await send({ type: 'SH_GET_HISTORY' })) || {};
  const list = $('#history-list');
  list.innerHTML = '';
  for (const h of history) {
    const li = document.createElement('li');
    li.textContent = h.description || '(unnamed)';
    li.title = `${h.url}\n${new Date(h.ts).toLocaleString()}`;
    li.addEventListener('click', () => {
      state.current = {
        id: h.id, captureId: h.captureId, ai: h.ai || null,
        description: h.description, url: h.url,
        candidates: h.candidates, snapshot: h.snapshot, assertions: h.assertions,
      };
      state.aiLoading = false;
      adoptDefaultsFromSnapshot();
      renderPick();
    });
    list.appendChild(li);
  }
}

function adoptDefaultsFromSnapshot() {
  state.action = defaultActionFor(state.current?.snapshot);
  state.actionValue = defaultValueFor(state.action, state.current?.snapshot);
  $('#action-select').value = state.action;
  $('#action-value').value = state.actionValue;
}

// ---------- wire up ------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  $('#settings-btn').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL('src/options/options.html'));
  });

  $('#pick-btn').addEventListener('click', async () => {
    const res = await send({ type: 'SH_REQUEST_PICK' });
    if (!res?.ok) {
      $('#empty').classList.remove('hidden');
      $('#empty').textContent = res?.error || 'Could not start picker on this tab.';
      return;
    }
    window.close();
  });

  $('#record-btn').addEventListener('click', async () => {
    state.finishedTest = null;
    renderRecordedTest();
    // Pre-fill the URL prompt with the current tab's URL.
    let currentUrl = '';
    try {
      const [tab] = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });
      currentUrl = tab?.url || '';
    } catch (_) { /* fall through */ }
    $('#start-url-input').value = currentUrl;
    $('#start-url-prompt').classList.remove('hidden');
    setTimeout(() => $('#start-url-input').focus(), 0);
  });

  $('#start-url-cancel').addEventListener('click', () => {
    $('#start-url-prompt').classList.add('hidden');
  });

  async function submitStartUrl() {
    const url = $('#start-url-input').value.trim();
    if (!url) return;
    $('#start-url-prompt').classList.add('hidden');
    const res = await send({ type: 'SH_REQUEST_RECORD_START', url });
    if (!res?.ok) {
      $('#empty').classList.remove('hidden');
      $('#empty').textContent = res?.error || 'Could not start recording.';
      return;
    }
    await refreshRecording();
    setTimeout(() => window.close(), 250);
  }
  $('#start-url-go').addEventListener('click', submitStartUrl);
  $('#start-url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitStartUrl(); }
    if (e.key === 'Escape') $('#start-url-prompt').classList.add('hidden');
  });

  $('#rec-stop').addEventListener('click', async () => {
    const res = await send({ type: 'SH_REQUEST_RECORD_STOP' });
    state.recording = null;
    renderRecordingState();
    const rec = res?.recording;
    state.enrichedTest = null;
    state.enrichedFollowups = null;
    state.enrichedMeta = null;
    state.showingEnriched = true;
    if (rec && rec.steps?.length) {
      state.rawSteps = rec.steps;
      state.finishedTest = SH().codegen.playwrightTest(rec.testName || 'recorded flow', rec.steps);
    } else {
      state.rawSteps = null;
      state.finishedTest = '// No steps were recorded.';
    }
    renderRecordedTest();
  });

  $('#rec-enrich').addEventListener('click', async () => {
    if (!state.rawSteps?.length || state.enriching) return;
    state.enriching = true;
    renderRecordedTest();
    const res = await send({ type: 'SH_ENRICH_RECORDING', rawSteps: state.rawSteps });
    state.enriching = false;
    if (!res?.ok) {
      // Surface as a comment block — keep the raw test visible.
      const reason = res?.error || 'unknown error';
      state.enrichedTest = null;
      state.enrichedMeta = null;
      $('#rec-code').textContent = state.finishedTest;
      $('#rec-title').textContent = 'Recorded Playwright test (enrichment failed)';
      $('#rec-meta').textContent = `enrich failed: ${reason}`;
      return;
    }
    state.enrichedTest = res.code;
    state.enrichedFollowups = res.output?.followUpIdeas || [];
    state.enrichedMeta = {
      model: res.audit?.model,
      costUsd: res.audit?.costUsd,
      latencyMs: res.audit?.latencyMs,
      corpusSize: res.audit?.corpusSize,
    };
    state.showingEnriched = true;
    renderRecordedTest();
  });

  document.querySelectorAll('#rec-toggle .toggle').forEach((t) => {
    t.addEventListener('click', () => {
      state.showingEnriched = t.dataset.which === 'enriched';
      renderRecordedTest();
    });
  });

  $('#rec-copy').addEventListener('click', () => {
    if (state.finishedTest) copyToClipboard($('#rec-copy'), state.finishedTest);
  });
  $('#rec-discard').addEventListener('click', () => {
    state.finishedTest = null;
    renderRecordedTest();
  });

  // ---- intent → test generator -----------------------------------------
  const renderIntent = () => {
    const out = $('#intent-output');
    const status = $('#intent-status');
    const missing = $('#intent-missing');
    if (state.intentLoading) {
      status.textContent = 'Generating test… (grounded against your corpus)';
      out.classList.add('hidden');
      missing.classList.add('hidden');
      return;
    }
    if (state.intentError) {
      status.textContent = state.intentError;
      out.classList.add('hidden');
      missing.classList.add('hidden');
      return;
    }
    status.textContent = '';
    if (!state.intentResult) { out.classList.add('hidden'); missing.classList.add('hidden'); return; }
    out.classList.remove('hidden');
    $('#intent-code').textContent = state.intentResult.code;
    const a = state.intentResult.audit || {};
    const c = typeof a.costUsd === 'number' ? `$${a.costUsd.toFixed(4)}` : '—';
    $('#intent-meta').textContent = `${a.model || '—'} · ${c} · ${a.latencyMs ?? '—'}ms · grounded against ${a.corpusSize ?? '?'} captures`;
    const miss = state.intentResult.output?.missingCapabilities || [];
    if (miss.length) {
      missing.classList.remove('hidden');
      missing.textContent = 'The model flagged these capabilities as missing from your corpus — pick them once and regenerate: ' + miss.join('; ');
    } else { missing.classList.add('hidden'); }
  };

  $('#intent-input').addEventListener('input', (e) => { state.intent = e.target.value; });

  $('#intent-go').addEventListener('click', async () => {
    const intent = state.intent.trim();
    if (!intent) { state.intentError = 'Type a test intent first.'; renderIntent(); return; }
    state.intentLoading = true; state.intentError = null; state.intentResult = null;
    renderIntent();
    let route;
    try {
      const [tab] = await new Promise((resolve) =>
        chrome.tabs.query({ active: true, currentWindow: true }, resolve));
      if (tab?.url) route = new URL(tab.url).pathname;
    } catch (_) {}
    const res = await send({ type: 'SH_GENERATE_TEST', intent, route });
    state.intentLoading = false;
    if (!res?.ok) {
      state.intentError = res?.error || 'Generation failed.';
    } else {
      state.intentResult = res;
    }
    renderIntent();
  });

  $('#intent-copy').addEventListener('click', () => {
    if (state.intentResult?.code) copyToClipboard($('#intent-copy'), state.intentResult.code);
  });

  $('#clear-btn').addEventListener('click', async () => {
    await send({ type: 'SH_CLEAR_HISTORY' });
    renderHistory();
  });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.framework = tab.dataset.fw;
      renderPick();
    });
  }

  $('#action-select').addEventListener('change', (e) => {
    state.action = e.target.value;
    if (state.action === 'press' && !$('#action-value').value) {
      state.actionValue = 'Enter';
      $('#action-value').value = 'Enter';
    }
    renderPick();
  });
  $('#action-value').addEventListener('input', (e) => {
    state.actionValue = e.target.value;
    renderPick();
  });

  // Hydrate from background state.
  await refreshRecording();
  const { history = [] } = (await send({ type: 'SH_GET_HISTORY' })) || {};
  if (history[0]) {
    state.current = {
      id: history[0].id, captureId: history[0].captureId, ai: history[0].ai || null,
      description: history[0].description, url: history[0].url,
      candidates: history[0].candidates, snapshot: history[0].snapshot,
      assertions: history[0].assertions,
    };
    adoptDefaultsFromSnapshot();
  }
  renderPick();
  renderHistory();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'SH_PICK_FORWARD') {
      state.current = msg.payload;
      // If the capture was synced to backend, an AI suggestion fetch is already
      // in flight from the service worker — show a loading state until it returns.
      state.aiLoading = !!msg.payload?.captureId;
      adoptDefaultsFromSnapshot();
      renderPick();
      renderHistory();
    }
    if (msg?.type === 'SH_AI_FORWARD') {
      if (state.current && state.current.id === msg.payload.entryId) {
        state.aiLoading = false;
        state.current.ai = msg.payload.ai;
        renderAi();
      }
      // History row may have updated as well; refresh.
      renderHistory();
    }
    if (msg?.type === 'SH_RECORD_FORWARD') {
      refreshRecording();
    }
  });
});
