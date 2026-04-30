(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  // Verify that a candidate match resolves to exactly the target element
  // in the live document. For strategies whose semantics aren't expressible
  // in pure CSS (role/label/text), we approximate with a tag-aware scan.
  function verify(target, match) {
    const doc = target.ownerDocument;
    const v = SH.codegen.verificationSelector(match.strategy, match);
    if (v && v.type === 'css') {
      return SH.cssSelector.isUnique(doc, v.value, target);
    }
    if (v && v.type === 'xpath') {
      return SH.xpath.evalUnique(doc, v.value, target);
    }
    if (match.strategy === 'role') {
      // Find all elements with the same role + accessible name.
      const candidates = collectByRole(doc, match.role, match.name);
      return candidates.length === 1 && candidates[0] === target;
    }
    if (match.strategy === 'label') {
      const inputs = Array.from(doc.querySelectorAll('input,select,textarea'))
        .filter((el) => sameLabel(el, match.value));
      return inputs.length === 1 && inputs[0] === target;
    }
    if (match.strategy === 'text') {
      const tag = target.tagName;
      const sameTag = Array.from(doc.getElementsByTagName(tag))
        .filter((el) => (el.textContent || '').replace(/\s+/g, ' ').trim() === match.value);
      return sameTag.length === 1 && sameTag[0] === target;
    }
    return false;
  }

  function collectByRole(doc, role, name) {
    const out = [];
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, 1 /* SHOW_ELEMENT */);
    let node = walker.currentNode;
    while (node) {
      if (SH.getRole(node) === role && SH.getAccessibleName(node) === name) {
        out.push(node);
      }
      node = walker.nextNode();
    }
    return out;
  }

  function sameLabel(el, expected) {
    if (el.id) {
      const lbl = el.ownerDocument.querySelector(`label[for="${SH.cssEscape(el.id)}"]`);
      if (lbl && (lbl.textContent || '').trim() === expected) return true;
    }
    const wrapping = el.closest && el.closest('label');
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll('input,select,textarea').forEach((n) => n.remove());
      if ((clone.textContent || '').trim() === expected) return true;
    }
    return false;
  }

  function buildCandidate(target, match) {
    const code = {
      playwright: SH.codegen.playwright(match.strategy, match),
      cypress: SH.codegen.cypress(match.strategy, match),
      selenium: SH.codegen.selenium(match.strategy, match),
    };
    let score = SH.scoring.BASE_SCORE[match.strategy] ?? 0;
    if (match.strategy === 'id' && SH.scoring.looksDynamic(match.value)) score -= 30;
    return {
      strategy: match.strategy,
      value: match.value,
      role: match.role,
      name: match.name,
      attribute: match.attribute,
      score,
      code,
    };
  }

  // Public entry point.
  // Returns a list of unique, verified candidates ordered by score (desc).
  function analyze(target) {
    if (!target || target.nodeType !== 1) return [];
    const out = [];
    for (const fn of SH.strategies.ALL) {
      let match;
      try { match = fn(target); } catch (_) { match = null; }
      if (!match) continue;
      if (!verify(target, match)) continue;
      out.push(buildCandidate(target, match));
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  // Best single candidate — convenience for the popup's "primary" display.
  function best(target) {
    const all = analyze(target);
    return all[0] || null;
  }

  // Pull a serialisable view of the top candidate. Recorder and the
  // background worker need a plain object that round-trips through
  // chrome.runtime messaging.
  function bestSerializable(target) {
    const c = best(target);
    if (!c) return null;
    return {
      strategy: c.strategy,
      value: c.value,
      role: c.role,
      name: c.name,
      attribute: c.attribute,
    };
  }

  // Take the top N candidates trimmed to the fields needed for codegen +
  // fallback chains. Defaults to 3 — beyond that adds noise without value.
  function topN(target, n = 3) {
    return analyze(target).slice(0, n).map((c) => ({
      strategy: c.strategy,
      value: c.value,
      role: c.role,
      name: c.name,
      attribute: c.attribute,
      score: c.score,
    }));
  }

  // A short fingerprint of the element used for history display.
  function describe(el) {
    if (!el) return '';
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.classList && el.classList.length ? '.' + Array.from(el.classList).slice(0, 2).join('.') : '';
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    return `<${tag}${id}${cls}>${txt ? ' ' + txt : ''}`;
  }

  SH.locatorEngine = { analyze, best, bestSerializable, topN, describe };
})();
