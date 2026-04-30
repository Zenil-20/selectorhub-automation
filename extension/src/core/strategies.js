(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  const TEST_ID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];

  // Each strategy returns a "match" object — the raw locator data — or null.
  // The engine wraps the match into a candidate (with code + verification).

  function testIdMatch(el) {
    for (const attr of TEST_ID_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) return { strategy: 'testid', attribute: attr, value: v };
    }
    return null;
  }

  function roleMatch(el) {
    const role = SH.getRole(el);
    if (!role) return null;
    const name = SH.getAccessibleName(el);
    if (!name) return null;
    if (name.length > 80) return null; // overly long names are unstable
    return { strategy: 'role', role, name, value: name };
  }

  function labelMatch(el) {
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return null;
    let text = '';
    if (el.id) {
      const lbl = el.ownerDocument.querySelector(`label[for="${SH.cssEscape(el.id)}"]`);
      if (lbl) text = (lbl.textContent || '').trim();
    }
    if (!text) {
      const wrapping = el.closest('label');
      if (wrapping) {
        const clone = wrapping.cloneNode(true);
        clone.querySelectorAll('input,select,textarea').forEach((n) => n.remove());
        text = (clone.textContent || '').trim();
      }
    }
    if (!text || text.length > 80) return null;
    return { strategy: 'label', value: text };
  }

  function placeholderMatch(el) {
    const v = el.getAttribute && el.getAttribute('placeholder');
    return v && v.trim() ? { strategy: 'placeholder', value: v.trim() } : null;
  }

  function altTextMatch(el) {
    if (el.tagName !== 'IMG' && el.tagName !== 'AREA') return null;
    const v = el.getAttribute('alt');
    return v && v.trim() ? { strategy: 'altText', value: v.trim() } : null;
  }

  function titleMatch(el) {
    const v = el.getAttribute && el.getAttribute('title');
    return v && v.trim() ? { strategy: 'title', value: v.trim() } : null;
  }

  function textMatch(el) {
    // Only emit getByText for elements whose text IS their identity.
    if (!/^(BUTTON|A|H1|H2|H3|H4|H5|H6|LABEL|SUMMARY|LI|TD|TH|SPAN|P)$/.test(el.tagName)) return null;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80) return null;
    return { strategy: 'text', value: text };
  }

  function idMatch(el) {
    const id = el.id;
    if (!id) return null;
    if (SH.scoring.looksDynamic(id)) return null;
    return { strategy: 'id', value: id };
  }

  function cssMatch(el) {
    const sel = SH.cssSelector.build(el);
    return sel ? { strategy: 'css', value: sel } : null;
  }

  function xpathMatch(el) {
    const xp = SH.xpath.build(el);
    return xp ? { strategy: 'xpath', value: xp } : null;
  }

  // Order matters — this is the priority list the engine walks.
  const ALL = [
    testIdMatch,
    roleMatch,
    labelMatch,
    placeholderMatch,
    altTextMatch,
    titleMatch,
    textMatch,
    idMatch,
    cssMatch,
    xpathMatch,
  ];

  SH.strategies = { ALL };
})();
