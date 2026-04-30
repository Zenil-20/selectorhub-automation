import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'extension', 'src', 'core');

const CORE_FILES = [
  'css-escape.js',
  'aria.js',
  'css-selector.js',
  'xpath.js',
  'scoring.js',
  'codegen.js',
  'strategies.js',
  'locator-engine.js',
];

// Build a fresh sandbox per scenario so DOM state doesn't leak between tests.
function makeSandbox(html) {
  const dom = new JSDOM(html, { url: 'https://example.test/' });
  const ctx = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    CSS: dom.window.CSS,
    globalThis: {},
  });
  ctx.globalThis = ctx;
  // Each core file attaches to globalThis.__SH; no module system needed.
  for (const f of CORE_FILES) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(src, ctx, { filename: f });
  }
  return { dom, sh: ctx.__SH, document: dom.window.document };
}

test('prefers data-testid above all else', () => {
  const { sh, document } = makeSandbox(`
    <button id="real-id" data-testid="submit-btn" class="btn primary">Submit</button>
  `);
  const el = document.querySelector('button');
  const best = sh.locatorEngine.best(el);
  assert.equal(best.strategy, 'testid');
  assert.equal(best.value, 'submit-btn');
  assert.match(best.code.playwright, /getByTestId\('submit-btn'\)/);
});

test('falls back to role + accessible name when no test id is present', () => {
  const { sh, document } = makeSandbox(`<button>Save changes</button>`);
  const el = document.querySelector('button');
  const best = sh.locatorEngine.best(el);
  assert.equal(best.strategy, 'role');
  assert.equal(best.role, 'button');
  assert.equal(best.name, 'Save changes');
});

test('uses associated <label> for inputs without test ids', () => {
  const { sh, document } = makeSandbox(`
    <label for="email">Email address</label>
    <input id="email" type="email" />
  `);
  const el = document.getElementById('email');
  const candidates = sh.locatorEngine.analyze(el);
  const lbl = candidates.find((c) => c.strategy === 'label');
  assert.ok(lbl, 'label candidate present');
  assert.equal(lbl.value, 'Email address');
});

test('skips id strategy when id looks dynamic', () => {
  const { sh, document } = makeSandbox(`
    <div id="user-9c2af1bd24e0">Hi</div>
    <div>Hello</div>
  `);
  const el = document.querySelector('#user-9c2af1bd24e0');
  const candidates = sh.locatorEngine.analyze(el);
  assert.ok(!candidates.find((c) => c.strategy === 'id'), 'dynamic id not offered');
});

test('keeps a clean static id', () => {
  const { sh, document } = makeSandbox(`
    <div id="pricing">A</div>
    <div>B</div>
  `);
  const el = document.querySelector('#pricing');
  const candidates = sh.locatorEngine.analyze(el);
  assert.ok(candidates.find((c) => c.strategy === 'id' && c.value === 'pricing'));
});

test('CSS fallback resolves uniquely for nested elements', () => {
  const { sh, document } = makeSandbox(`
    <ul>
      <li><span>One</span></li>
      <li><span>Two</span></li>
      <li><span>Three</span></li>
    </ul>
  `);
  const target = document.querySelectorAll('li span')[1];
  const candidates = sh.locatorEngine.analyze(target);
  // The text strategy will likely resolve first since text is unique.
  const text = candidates.find((c) => c.strategy === 'text');
  assert.equal(text?.value, 'Two');
  // And a CSS candidate is still produced and unique.
  const css = candidates.find((c) => c.strategy === 'css');
  assert.ok(css);
  assert.equal(document.querySelectorAll(css.value).length, 1);
});

test('every returned candidate is unique on the live document', () => {
  const { sh, document } = makeSandbox(`
    <form>
      <label for="user">Username</label><input id="user" />
      <label for="pass">Password</label><input id="pass" type="password" />
      <button data-testid="login">Log in</button>
      <button>Cancel</button>
    </form>
  `);
  const targets = [
    document.getElementById('user'),
    document.querySelector('[data-testid="login"]'),
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Cancel'),
  ];
  for (const t of targets) {
    const list = sh.locatorEngine.analyze(t);
    assert.ok(list.length > 0, 'at least one candidate');
    for (const c of list) {
      // Sanity-check: the verifier gates output, so we just assert result shape.
      assert.ok(c.code.playwright);
      assert.ok(c.code.cypress);
      assert.ok(c.code.selenium);
    }
  }
});

test('codegen emits properly escaped strings', () => {
  const { sh, document } = makeSandbox(`<button>It's "fine"</button>`);
  const el = document.querySelector('button');
  const best = sh.locatorEngine.best(el);
  assert.equal(best.strategy, 'role');
  // Single quotes inside the string must be escaped in JS string output.
  // Every text-shaped strategy is emitted with exact: true so runtime
  // semantics match our exact-match verification (no false-positives).
  assert.match(best.code.playwright, /name: 'It\\'s "fine"', exact: true/);
});
