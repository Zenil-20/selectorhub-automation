(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});

  let box = null;
  let tip = null;
  let banner = null;

  function ensure() {
    if (!box) {
      box = document.createElement('div');
      box.className = '__sh-highlight';
      box.style.display = 'none';
      document.documentElement.appendChild(box);
    }
    if (!tip) {
      tip = document.createElement('div');
      tip.className = '__sh-tooltip';
      tip.style.display = 'none';
      document.documentElement.appendChild(tip);
    }
  }

  function show(el, label) {
    if (!el || el.nodeType !== 1) return hide();
    ensure();
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return hide();
    box.style.display = 'block';
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;

    if (label) {
      tip.style.display = 'block';
      tip.textContent = label;
      const tipTop = r.top - 24 < 0 ? r.bottom + 4 : r.top - 24;
      tip.style.left = `${Math.max(4, r.left)}px`;
      tip.style.top = `${tipTop}px`;
    } else {
      tip.style.display = 'none';
    }
  }

  function hide() {
    if (box) box.style.display = 'none';
    if (tip) tip.style.display = 'none';
  }

  function showBanner(text) {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = '__sh-banner';
      document.documentElement.appendChild(banner);
    }
    banner.textContent = text;
    banner.style.display = 'block';
  }

  function hideBanner() {
    if (banner) banner.style.display = 'none';
  }

  SH.highlighter = { show, hide, showBanner, hideBanner };
})();
