(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  // Snapshot the parts of an element a QA engineer cares about asserting.
  // Kept synchronous and pure — runs once at pick time, the popup formats it.
  function snapshot(el) {
    const tag = el.tagName;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const isFormControl = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    let value = null;
    if (isFormControl) {
      try { value = el.value == null ? '' : String(el.value); } catch (_) { value = ''; }
    }
    let checked = null;
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (t === 'checkbox' || t === 'radio') checked = !!el.checked;
    }
    const attrs = {};
    for (const a of ['href', 'src', 'alt', 'title', 'aria-label', 'role', 'placeholder', 'type', 'name']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v != null && v !== '') attrs[a] = v;
    }
    // Boolean attributes — getAttribute returns '' when present.
    if (el.hasAttribute && el.hasAttribute('disabled')) attrs.disabled = '';
    return { tag, text, value, checked, attrs, visible: isVisible(el) };
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const view = el.ownerDocument.defaultView;
    if (!view || !view.getComputedStyle) return true;
    const cs = view.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0;
  }

  // Generate Playwright assertion snippets pre-filled from the snapshot.
  // The locator expression is passed in (e.g. "page.getByTestId('save')")
  // so the popup can re-render assertions when the user switches strategies.
  function suggestPlaywright(locatorExpr, snap) {
    const out = [];
    if (snap.visible) {
      out.push({ name: 'toBeVisible', code: `await expect(${locatorExpr}).toBeVisible();` });
    } else {
      out.push({ name: 'toBeHidden', code: `await expect(${locatorExpr}).toBeHidden();` });
    }
    if (snap.text) {
      const t = snap.text;
      if (t.length <= 80) {
        out.push({
          name: 'toHaveText',
          code: `await expect(${locatorExpr}).toHaveText(${SH.jsString(t)});`,
        });
      } else {
        out.push({
          name: 'toContainText',
          code: `await expect(${locatorExpr}).toContainText(${SH.jsString(t.slice(0, 60))});`,
        });
      }
    }
    if (snap.value !== null && snap.value !== '') {
      out.push({
        name: 'toHaveValue',
        code: `await expect(${locatorExpr}).toHaveValue(${SH.jsString(snap.value)});`,
      });
    }
    if (snap.checked === true) {
      out.push({ name: 'toBeChecked', code: `await expect(${locatorExpr}).toBeChecked();` });
    } else if (snap.checked === false) {
      out.push({ name: 'not.toBeChecked', code: `await expect(${locatorExpr}).not.toBeChecked();` });
    }
    for (const [a, v] of Object.entries(snap.attrs)) {
      // Skip noisy attributes that appear in the locator already.
      if (a === 'placeholder' || a === 'aria-label' || a === 'role' || a === 'title' || a === 'alt') continue;
      out.push({
        name: `toHaveAttribute('${a}')`,
        code: `await expect(${locatorExpr}).toHaveAttribute(${SH.jsString(a)}, ${SH.jsString(v)});`,
      });
    }
    if (snap.tag === 'INPUT' || snap.tag === 'TEXTAREA' || snap.tag === 'SELECT' || snap.tag === 'BUTTON') {
      const disabled = snap.attrs && snap.attrs.disabled !== undefined;
      if (disabled) {
        out.push({ name: 'toBeDisabled', code: `await expect(${locatorExpr}).toBeDisabled();` });
      } else {
        out.push({ name: 'toBeEnabled', code: `await expect(${locatorExpr}).toBeEnabled();` });
      }
    }
    return out;
  }

  SH.assertions = { snapshot, suggestPlaywright };
})();
