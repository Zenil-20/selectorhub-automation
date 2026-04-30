(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  // Heuristic: stable-looking class names. Filters out hash/util/state classes
  // commonly emitted by CSS-in-JS or framework bundlers.
  const UNSTABLE_CLASS = /(^|[-_])(\d|[a-f0-9]{5,}$|css-[a-z0-9]+|sc-[a-z0-9]+|jsx-\d+|MuiBox-root|chakra-)/i;
  const STATE_CLASS = /(^|-)(active|hover|focus|disabled|selected|checked|open|hidden|visible|loading|error|success)$/i;

  function stableClasses(el) {
    if (!el.classList || !el.classList.length) return [];
    return Array.from(el.classList).filter(
      (c) => c && !UNSTABLE_CLASS.test(c) && !STATE_CLASS.test(c) && c.length <= 40
    );
  }

  function isUnique(doc, selector, target) {
    try {
      const matches = doc.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === target;
    } catch (_) {
      return false;
    }
  }

  function tagSelector(el) {
    return el.tagName.toLowerCase();
  }

  // Build a candidate selector for a single node, in increasing specificity.
  function nodeCandidates(el) {
    const tag = tagSelector(el);
    const out = [tag];
    const classes = stableClasses(el);
    if (classes.length) {
      out.push(tag + classes.map((c) => '.' + SH.cssEscape(c)).join(''));
    }
    // Stable attributes worth scoping with.
    const ATTRS = ['name', 'type', 'role', 'aria-label', 'placeholder', 'href'];
    for (const attr of ATTRS) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (v && v.length <= 80) {
        out.push(`${tag}[${attr}=${SH.attrValue(v)}]`);
      }
    }
    return out;
  }

  function nthOfType(el) {
    let i = 1;
    let sib = el.previousElementSibling;
    while (sib) {
      if (sib.tagName === el.tagName) i++;
      sib = sib.previousElementSibling;
    }
    return i;
  }

  // Generate a minimum-unique CSS selector by walking up the tree, accumulating
  // the shortest selector that resolves uniquely to `target`.
  function buildUniqueSelector(target) {
    if (!target || target.nodeType !== 1) return null;
    const doc = target.ownerDocument;

    // Fast path: a single distinctive attribute on the node alone.
    for (const cand of nodeCandidates(target)) {
      if (isUnique(doc, cand, target)) return cand;
    }

    // Walk up, prepending ancestor segments until unique.
    const parts = [];
    let cur = target;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 8) {
      const candidates = nodeCandidates(cur);
      // Prefer the most specific (last) candidate that narrows the parent path.
      let chosen = candidates[candidates.length - 1];
      // For positional disambiguation, append :nth-of-type when siblings collide.
      const parent = cur.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (sameTagSiblings.length > 1 && chosen === tagSelector(cur)) {
          chosen = `${chosen}:nth-of-type(${nthOfType(cur)})`;
        }
      }
      parts.unshift(chosen);
      const selector = parts.join(' > ');
      if (isUnique(doc, selector, target)) return selector;
      cur = cur.parentElement;
      depth++;
    }
    // Last resort — full path with nth-of-type at every level.
    return absoluteCss(target);
  }

  function absoluteCss(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML') {
      parts.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${nthOfType(cur)})`);
      cur = cur.parentElement;
    }
    parts.unshift('html');
    return parts.join(' > ');
  }

  SH.cssSelector = {
    build: buildUniqueSelector,
    isUnique,
    stableClasses,
  };
})();
