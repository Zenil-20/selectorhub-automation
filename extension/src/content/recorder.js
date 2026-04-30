(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  // Recording is a finite-state machine in the content script that emits
  // structured steps to the service worker. The worker owns the durable
  // store; this module is intentionally stateless across page loads —
  // when the user navigates, the new content-script instance asks the
  // worker whether a recording is in progress and resumes if so.
  //
  // Two interaction modes:
  //   - normal:      events become click / fill / select / check / press steps
  //   - assertNext:  the on-page eye button is armed; the recorder behaves
  //                  like the element picker (hover highlight + tooltip),
  //                  the next click is captured as ONE assertion step, and
  //                  the recorder snaps back to normal. Click eye again or
  //                  press Esc to cancel without capturing.

  let active = false;
  let pendingFill = null;          // { el, locator, value }
  let lastClickAt = 0;
  let assertNext = false;
  let eyeEl = null;

  function isOurOverlay(el) {
    if (!el || !el.classList) return false;
    return el.classList.contains('__sh-highlight') ||
           el.classList.contains('__sh-tooltip')   ||
           el.classList.contains('__sh-banner')    ||
           el.classList.contains('__sh-eye');
  }

  function isInsideEye(el) {
    return !!(eyeEl && (el === eyeEl || eyeEl.contains(el)));
  }

  function locatorOf(el) {
    try { return SH.locatorEngine.bestSerializable(el); }
    catch (_) { return null; }
  }

  function emit(step) {
    try { chrome.runtime.sendMessage({ type: 'SH_RECORD_STEP', payload: step }); }
    catch (_) { /* worker asleep / extension reloading */ }
  }

  function flushFill() {
    if (!pendingFill) return;
    emit({ type: 'fill', locator: pendingFill.locator, value: pendingFill.value, ts: Date.now() });
    pendingFill = null;
  }

  // --------- assertion picking --------------------------------------------
  // Pick the assertion shape that says the most about the element:
  //   1. Checkbox/radio              → toBeChecked / not.toBeChecked
  //   2. Form control with value     → toHaveValue(value)
  //   3. Text-bearing leaf-ish node  → toHaveText(text)
  //   4. Anything else               → toBeVisible
  function emitAssertionFor(el) {
    const locator = locatorOf(el);
    if (!locator) return;
    const tag = el.tagName;
    const t = (el.getAttribute('type') || '').toLowerCase();

    if (tag === 'INPUT' && (t === 'checkbox' || t === 'radio')) {
      emit({ type: el.checked ? 'expectChecked' : 'expectNotChecked', locator, ts: Date.now() });
      return;
    }
    if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && el.value) {
      emit({ type: 'expectValue', locator, value: String(el.value), ts: Date.now() });
      return;
    }
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const TEXT_TAGS = /^(BUTTON|A|H1|H2|H3|H4|H5|H6|LABEL|LI|TD|TH|SPAN|P|DIV|STRONG|EM|SUMMARY)$/;
    if (text && text.length <= 80 && TEXT_TAGS.test(tag)) {
      emit({ type: 'expectText', locator, value: text, ts: Date.now() });
      return;
    }
    emit({ type: 'expectVisible', locator, ts: Date.now() });
  }

  function shouldSkipClick(el) {
    if (!el || isOurOverlay(el) || isInsideEye(el)) return true;
    if (el.tagName === 'OPTION') return true;
    if (el.tagName === 'INPUT') {
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (t === 'checkbox' || t === 'radio') return true;
    }
    return false;
  }

  // --------- pick-mode helpers (used while assertNext is true) ------------
  // Mirrors the picker's elementFromPoint trick — temporarily hide our own
  // overlays so we don't hit-test the highlight box itself.
  function elementUnderPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    if (el && !isOurOverlay(el) && !isInsideEye(el)) return el;
    if (SH.highlighter) SH.highlighter.hide();
    return document.elementFromPoint(x, y);
  }

  // --------- handlers -----------------------------------------------------
  function onMove(e) {
    if (!active || !assertNext) return;
    const el = elementUnderPoint(e.clientX, e.clientY);
    if (!el || isOurOverlay(el) || isInsideEye(el)) {
      if (SH.highlighter) SH.highlighter.hide();
      return;
    }
    const best = SH.locatorEngine.best(el);
    const label = best ? `assert · ${best.strategy} · ${best.value}` : el.tagName.toLowerCase();
    if (SH.highlighter) SH.highlighter.show(el, label);
  }

  function onClick(e) {
    if (!active) return;
    const el = e.target;
    // Eye toggles itself in its own handler; ignore here so we don't double-fire.
    if (isInsideEye(el)) return;

    if (assertNext) {
      // Suppress the page-level effect of this click — otherwise we might
      // submit a form, follow a link, or open a modal before the assertion
      // is even recorded.
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      flushFill();
      const target = elementUnderPoint(e.clientX, e.clientY) || el;
      emitAssertionFor(target);
      setAssertMode(false);
      return;
    }

    if (shouldSkipClick(el)) return;
    const now = Date.now();
    const isDouble = (now - lastClickAt) < 350;
    lastClickAt = now;
    flushFill();
    const locator = locatorOf(el);
    if (!locator) return;
    emit({ type: isDouble ? 'dblclick' : 'click', locator, ts: now });
  }

  function onMouseDown(e) {
    // Some apps (sortable lists, drag handles) act on mousedown rather than
    // click. While the eye is armed, swallow mousedown too so the assertion
    // pick can't kick off a drag or reorder.
    if (!active || !assertNext) return;
    if (isInsideEye(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function onInput(e) {
    if (!active || assertNext) return;
    const el = e.target;
    if (!el || isOurOverlay(el)) return;
    const tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
    const t = (el.getAttribute('type') || '').toLowerCase();
    if (t === 'checkbox' || t === 'radio' || t === 'file' || t === 'range') return;
    if (pendingFill && pendingFill.el !== el) flushFill();
    const locator = locatorOf(el);
    if (!locator) return;
    pendingFill = { el, locator, value: el.value };
  }

  function onChange(e) {
    if (!active || assertNext) return;
    const el = e.target;
    if (!el || isOurOverlay(el)) return;
    const locator = locatorOf(el);
    if (!locator) return;

    if (el.tagName === 'SELECT') {
      flushFill();
      const value = el.multiple
        ? Array.from(el.selectedOptions).map((o) => o.value).join(',')
        : el.value;
      emit({ type: 'select', locator, value, ts: Date.now() });
      return;
    }
    if (el.tagName === 'INPUT') {
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (t === 'checkbox') {
        flushFill();
        emit({ type: el.checked ? 'check' : 'uncheck', locator, ts: Date.now() });
        return;
      }
      if (t === 'radio' && el.checked) {
        flushFill();
        emit({ type: 'check', locator, ts: Date.now() });
        return;
      }
    }
  }

  function onBlur(e) {
    if (!active) return;
    if (pendingFill && pendingFill.el === e.target) flushFill();
  }

  function onKeyDown(e) {
    if (!active) return;
    // While the eye is armed, Esc cancels assert mode and nothing else
    // gets recorded — match the picker's UX.
    if (assertNext) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setAssertMode(false);
      }
      return;
    }
    if (e.key !== 'Enter' && e.key !== 'Escape' && e.key !== 'Tab') return;
    const el = e.target;
    if (!el || isOurOverlay(el)) return;
    flushFill();
    const locator = locatorOf(el);
    if (!locator) return;
    emit({ type: 'press', locator, value: e.key, ts: Date.now() });
  }

  // --------- eye button ---------------------------------------------------
  function setAssertMode(on) {
    assertNext = !!on;
    if (eyeEl) eyeEl.classList.toggle('armed', assertNext);
    if (!assertNext && SH.highlighter) SH.highlighter.hide();
    if (SH.highlighter) {
      SH.highlighter.showBanner(
        assertNext
          ? 'Assertion mode — click any element to capture (Esc to cancel)'
          : 'Recording — interact normally · Stop from the popup'
      );
    }
  }

  function installEye() {
    if (eyeEl) return;
    eyeEl = document.createElement('button');
    eyeEl.className = '__sh-eye';
    eyeEl.title = 'Capture next click as an assertion';
    eyeEl.type = 'button';
    eyeEl.innerHTML = (
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>' +
      '<circle cx="12" cy="12" r="3"/>' +
      '</svg>'
    );
    eyeEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      setAssertMode(!assertNext);
    }, true);
    document.documentElement.appendChild(eyeEl);
  }

  function removeEye() {
    if (eyeEl) eyeEl.remove();
    eyeEl = null;
  }

  // --------- start / stop -------------------------------------------------
  function start() {
    if (active) return;
    active = true;
    pendingFill = null;
    lastClickAt = 0;
    assertNext = false;
    if (SH.highlighter) SH.highlighter.showBanner('Recording — interact normally · Stop from the popup');
    installEye();
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('blur', onBlur, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function stop() {
    if (!active) return;
    flushFill();
    active = false;
    assertNext = false;
    if (SH.highlighter) { SH.highlighter.hide(); SH.highlighter.hideBanner(); }
    removeEye();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('blur', onBlur, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  window.addEventListener('beforeunload', () => { if (active) flushFill(); });

  SH.recorder = { start, stop, isActive: () => active };
})();
