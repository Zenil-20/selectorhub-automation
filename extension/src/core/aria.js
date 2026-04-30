(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  // Implicit ARIA role mapping for the elements people actually pick in tests.
  // Reference: https://www.w3.org/TR/html-aria/
  const IMPLICIT_ROLES = {
    A: (el) => (el.hasAttribute('href') ? 'link' : null),
    AREA: (el) => (el.hasAttribute('href') ? 'link' : null),
    ARTICLE: () => 'article',
    ASIDE: () => 'complementary',
    BUTTON: () => 'button',
    DATALIST: () => 'listbox',
    DETAILS: () => 'group',
    DIALOG: () => 'dialog',
    FIELDSET: () => 'group',
    FIGURE: () => 'figure',
    FORM: () => 'form',
    H1: () => 'heading', H2: () => 'heading', H3: () => 'heading',
    H4: () => 'heading', H5: () => 'heading', H6: () => 'heading',
    HEADER: () => 'banner',
    FOOTER: () => 'contentinfo',
    HR: () => 'separator',
    IMG: (el) => (el.getAttribute('alt') === '' ? 'presentation' : 'img'),
    INPUT: (el) => {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'search') return 'searchbox';
      if (t === 'email' || t === 'tel' || t === 'url' || t === 'text' || t === 'password' || t === 'number') {
        return t === 'password' ? null : 'textbox';
      }
      return 'textbox';
    },
    LI: () => 'listitem',
    MAIN: () => 'main',
    NAV: () => 'navigation',
    OL: () => 'list',
    UL: () => 'list',
    OPTION: () => 'option',
    PROGRESS: () => 'progressbar',
    SECTION: (el) => (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : null),
    SELECT: (el) => (el.hasAttribute('multiple') || (parseInt(el.getAttribute('size'), 10) > 1) ? 'listbox' : 'combobox'),
    TABLE: () => 'table',
    TBODY: () => 'rowgroup',
    THEAD: () => 'rowgroup',
    TFOOT: () => 'rowgroup',
    TD: () => 'cell',
    TH: () => 'columnheader',
    TR: () => 'row',
    TEXTAREA: () => 'textbox',
  };

  function getRole(el) {
    if (!el || el.nodeType !== 1) return null;
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    const fn = IMPLICIT_ROLES[el.tagName];
    return fn ? fn(el) : null;
  }

  // WAI-ARIA accessible name computation, simplified.
  // We resolve the four most common sources; this matches Playwright's
  // getByRole({ name }) for >95% of real test targets.
  function getAccessibleName(el) {
    if (!el || el.nodeType !== 1) return '';

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const doc = el.ownerDocument;
      const parts = labelledBy.split(/\s+/)
        .map((id) => doc.getElementById(id))
        .filter(Boolean)
        .map((node) => (node.textContent || '').trim())
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }

    // <label for=id> or wrapping <label>
    if (/^(INPUT|TEXTAREA|SELECT|METER|PROGRESS)$/.test(el.tagName)) {
      if (el.id) {
        const lbl = el.ownerDocument.querySelector(`label[for="${SH.cssEscape(el.id)}"]`);
        if (lbl) return (lbl.textContent || '').trim();
      }
      const wrapping = el.closest('label');
      if (wrapping) {
        // Strip the input's own value out of the label text.
        const clone = wrapping.cloneNode(true);
        clone.querySelectorAll('input,select,textarea').forEach((n) => n.remove());
        return (clone.textContent || '').trim();
      }
    }

    if (el.tagName === 'IMG' || el.tagName === 'AREA') {
      const alt = el.getAttribute('alt');
      if (alt) return alt.trim();
    }
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset') {
        return (el.getAttribute('value') || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '')).trim();
      }
    }
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();

    // For interactive elements where text content IS the name (button, link, heading, tab...)
    const role = getRole(el);
    const TEXT_ROLES = new Set(['button', 'link', 'heading', 'tab', 'menuitem', 'option', 'cell', 'columnheader', 'rowheader', 'treeitem']);
    if (TEXT_ROLES.has(role)) {
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) return txt;
    }
    return '';
  }

  SH.getRole = getRole;
  SH.getAccessibleName = getAccessibleName;
})();
