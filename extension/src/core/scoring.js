(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  // Patterns indicating a value was machine-generated and is unlikely to survive
  // the next deploy. Used to demote `id`-based and class-based candidates.
  const HASHY = [
    /^[0-9a-f]{8,}$/i,                 // pure hex hash
    /[-_][0-9a-f]{8,}$/i,              // prefix-hash, e.g. user-9c2af1bd24e0
    /^[A-Za-z0-9_-]{24,}$/,            // long opaque tokens
    /\d{4,}/,                          // 4+ consecutive digits (counter ids)
    /^(ember|react|ng|vue|app)\d+/i,   // framework auto-ids
    /^:r[a-z0-9]+:$/i,                 // React 18 useId
    /^radix-/i,                        // Radix UI generated ids
  ];

  function looksDynamic(value) {
    if (!value) return true;
    return HASHY.some((re) => re.test(value));
  }

  // Strategy base scores — higher is better. The engine adds/subtracts based
  // on uniqueness and dynamic-ness signals.
  const BASE_SCORE = {
    testid: 100,
    role: 90,
    label: 85,
    placeholder: 75,
    altText: 72,
    title: 65,
    text: 60,
    id: 55,
    css: 35,
    xpath: 15,
  };

  SH.scoring = { looksDynamic, BASE_SCORE };
})();
