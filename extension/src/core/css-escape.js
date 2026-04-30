(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  // CSS.escape polyfill — older WebView and jsdom builds don't ship it.
  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    const str = String(value);
    let result = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      if (ch === 0) { result += '�'; continue; }
      if (
        (ch >= 0x0001 && ch <= 0x001F) || ch === 0x007F ||
        (i === 0 && ch >= 0x0030 && ch <= 0x0039) ||
        (i === 1 && ch >= 0x0030 && ch <= 0x0039 && str.charCodeAt(0) === 0x002D)
      ) {
        result += '\\' + ch.toString(16) + ' ';
        continue;
      }
      if (
        ch >= 0x0080 || ch === 0x002D || ch === 0x005F ||
        (ch >= 0x0030 && ch <= 0x0039) ||
        (ch >= 0x0041 && ch <= 0x005A) ||
        (ch >= 0x0061 && ch <= 0x007A)
      ) {
        result += str.charAt(i);
        continue;
      }
      result += '\\' + str.charAt(i);
    }
    return result;
  }

  // Escape a JS string literal for code generation (single-quoted).
  function jsString(value) {
    return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r') + "'";
  }

  // Escape an attribute-selector value (double-quoted).
  function attrValue(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  SH.cssEscape = cssEscape;
  SH.jsString = jsString;
  SH.attrValue = attrValue;
})();
