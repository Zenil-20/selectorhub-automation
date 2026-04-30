(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  let active = false;
  let onPickedCb = null;

  function isOurOverlay(el) {
    return el && el.classList && (
      el.classList.contains('__sh-highlight') ||
      el.classList.contains('__sh-tooltip') ||
      el.classList.contains('__sh-banner')
    );
  }

  function elementFromPoint(x, y) {
    // Skip our own overlay elements which sit at z=max.
    const el = document.elementFromPoint(x, y);
    if (!isOurOverlay(el)) return el;
    // Hide overlays, retry, restore.
    SH.highlighter.hide();
    const real = document.elementFromPoint(x, y);
    return real;
  }

  function onMove(e) {
    if (!active) return;
    const el = elementFromPoint(e.clientX, e.clientY);
    if (!el || isOurOverlay(el)) return;
    const best = SH.locatorEngine.best(el);
    SH.highlighter.show(el, best ? `${best.strategy} · ${best.value}` : el.tagName.toLowerCase());
  }

  function onClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    const el = elementFromPoint(e.clientX, e.clientY);
    if (!el || isOurOverlay(el)) return;
    const candidates = SH.locatorEngine.analyze(el);
    const snapshot = SH.assertions ? SH.assertions.snapshot(el) : null;
    const domExcerpt = buildDomExcerpt(el);

    // Pre-compute Playwright assertion snippets keyed to the *best* locator.
    // The fallback chain is computed in the popup so it can re-render when
    // the user changes the action verb.
    let assertions = { playwright: [] };
    if (candidates.length && snapshot) {
      const best = candidates[0];
      const locExpr = SH.codegen.playwrightLocator(best.strategy, best);
      assertions.playwright = SH.assertions.suggestPlaywright(locExpr, snapshot);
    }

    stop();
    if (onPickedCb) onPickedCb({
      candidates,
      snapshot,
      assertions,
      domExcerpt,
      description: SH.locatorEngine.describe(el),
      url: location.href,
    });
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      stop();
      if (onPickedCb) onPickedCb({ cancelled: true });
    }
  }

  function start(cb) {
    if (active) return;
    active = true;
    onPickedCb = cb;
    SH.highlighter.showBanner('Click any element to capture · Esc to cancel');
    // Capture phase so we beat page handlers.
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function stop() {
    active = false;
    SH.highlighter.hide();
    SH.highlighter.hideBanner();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
  }

  // A bounded DOM excerpt for LLM context — the element, its parent, and
  // any siblings that fit within the size budget. Truncated server-side too,
  // but capping here saves the network round-trip for huge subtrees.
  const EXCERPT_BUDGET = 4000;
  function buildDomExcerpt(el) {
    if (!el || !el.outerHTML) return null;
    const own = el.outerHTML;
    if (own.length >= EXCERPT_BUDGET) return own.slice(0, EXCERPT_BUDGET);
    const parent = el.parentElement;
    if (!parent) return own;
    // Wrap the element's outerHTML inside its parent's open/close tags so
    // the model sees the immediate ancestor's structure.
    const parentTag = parent.tagName.toLowerCase();
    const attrs = Array.from(parent.attributes || [])
      .map((a) => `${a.name}="${String(a.value).replace(/"/g, '&quot;')}"`)
      .join(' ');
    const open = `<${parentTag}${attrs ? ' ' + attrs : ''}>`;
    const close = `</${parentTag}>`;
    const wrapped = `${open}\n  ${own}\n${close}`;
    return wrapped.length <= EXCERPT_BUDGET ? wrapped : own;
  }

  SH.picker = { start, stop, isActive: () => active };
})();
