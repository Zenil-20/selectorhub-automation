(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  function xpathIndex(el) {
    let i = 1;
    let sib = el.previousSibling;
    while (sib) {
      if (sib.nodeType === 1 && sib.tagName === el.tagName) i++;
      sib = sib.previousSibling;
    }
    return i;
  }

  function buildXPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id && /^[A-Za-z][\w:-]*$/.test(el.id) && uniqueById(el)) {
      return `//*[@id="${el.id}"]`;
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML') {
      parts.unshift(`${cur.tagName.toLowerCase()}[${xpathIndex(cur)}]`);
      cur = cur.parentNode;
    }
    return '/html/' + parts.join('/');
  }

  function uniqueById(el) {
    try {
      return el.ownerDocument.querySelectorAll(`#${SH.cssEscape(el.id)}`).length === 1;
    } catch (_) { return false; }
  }

  function evalUnique(doc, xpath, target) {
    try {
      const result = doc.evaluate(xpath, doc, null, 7 /* ORDERED_NODE_SNAPSHOT_TYPE */, null);
      return result.snapshotLength === 1 && result.snapshotItem(0) === target;
    } catch (_) {
      return false;
    }
  }

  SH.xpath = { build: buildXPath, evalUnique };
})();
