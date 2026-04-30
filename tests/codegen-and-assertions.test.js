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
  'assertions.js',
  'strategies.js',
  'locator-engine.js',
];

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
  for (const f of CORE_FILES) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(src, ctx, { filename: f });
  }
  return { dom, sh: ctx.__SH, document: dom.window.document };
}

test('playwrightTest emits a runnable test scaffold from steps', () => {
  const { sh } = makeSandbox(`<body></body>`);
  const steps = [
    { type: 'goto', url: 'https://app.example/login' },
    { type: 'fill', locator: { strategy: 'label', value: 'Email' }, value: 'a@b.c' },
    { type: 'fill', locator: { strategy: 'label', value: 'Password' }, value: 'secret' },
    { type: 'click', locator: { strategy: 'role', role: 'button', name: 'Sign in' } },
    { type: 'expectVisible', locator: { strategy: 'text', value: 'Welcome' } },
  ];
  const code = sh.codegen.playwrightTest('login flow', steps);
  assert.match(code, /import \{ test, expect \} from '@playwright\/test';/);
  assert.match(code, /test\('login flow'/);
  assert.match(code, /await page\.goto\('https:\/\/app\.example\/login'\);/);
  assert.match(code, /await page\.getByLabel\('Email', \{ exact: true \}\)\.fill\('a@b\.c'\);/);
  assert.match(code, /await page\.getByRole\('button', \{ name: 'Sign in', exact: true \}\)\.click\(\);/);
  assert.match(code, /await expect\(page\.getByText\('Welcome', \{ exact: true \}\)\)\.toBeVisible\(\);/);
});

test('playwrightTest emits the full assertion vocabulary', () => {
  const { sh } = makeSandbox(`<body></body>`);
  const code = sh.codegen.playwrightTest('asserts', [
    { type: 'expectVisible',    locator: { strategy: 'testid', value: 'a' } },
    { type: 'expectHidden',     locator: { strategy: 'testid', value: 'b' } },
    { type: 'expectText',       locator: { strategy: 'testid', value: 'c' }, value: 'Hi' },
    { type: 'expectValue',      locator: { strategy: 'testid', value: 'd' }, value: 'x@y.z' },
    { type: 'expectChecked',    locator: { strategy: 'testid', value: 'e' } },
    { type: 'expectNotChecked', locator: { strategy: 'testid', value: 'f' } },
  ]);
  assert.match(code, /\.toBeVisible\(\);/);
  assert.match(code, /\.toBeHidden\(\);/);
  assert.match(code, /\.toHaveText\('Hi'\);/);
  assert.match(code, /\.toHaveValue\('x@y\.z'\);/);
  assert.match(code, /\.toBeChecked\(\);/);
  assert.match(code, /\.not\.toBeChecked\(\);/);
});

test('playwrightTest annotates skipped steps instead of dropping them', () => {
  const { sh } = makeSandbox(`<body></body>`);
  const code = sh.codegen.playwrightTest('flow', [
    { type: 'click', locator: null },
    { type: 'whatever', locator: { strategy: 'css', value: '.x' } },
  ]);
  assert.match(code, /\[skipped click: no stable locator\]/);
  assert.match(code, /\[unknown step type: whatever\]/);
});

test('fallback chain joins top candidates with .or()', () => {
  const { sh } = makeSandbox(`<body></body>`);
  const top3 = [
    { strategy: 'testid', value: 'save-btn' },
    { strategy: 'role', role: 'button', name: 'Save' },
    { strategy: 'css', value: '.btn-save' },
  ];
  const code = sh.codegen.playwrightFallbackChain(top3, 'click()');
  assert.match(code, /page\.getByTestId\('save-btn'\)/);
  assert.match(code, /\.or\(page\.getByRole\('button', \{ name: 'Save', exact: true \}\)\)/);
  assert.match(code, /\.or\(page\.locator\('\.btn-save'\)\)/);
  assert.match(code, /\.click\(\);/);
  assert.match(code, /Self-healing chain/);
});

test('fallback chain with one candidate emits a single direct call (no .or)', () => {
  const { sh } = makeSandbox(`<body></body>`);
  const code = sh.codegen.playwrightFallbackChain(
    [{ strategy: 'testid', value: 'only' }], 'click()'
  );
  assert.equal(code, `await page.getByTestId('only').click();`);
});

test('assertions snapshot reads visibility, text, value, attributes', () => {
  const { sh, document } = makeSandbox(`
    <a id="link" href="/foo" title="Tip">Click me</a>
    <input id="email" type="email" value="a@b.c" />
    <input id="agree" type="checkbox" checked />
  `);
  const link = sh.assertions.snapshot(document.getElementById('link'));
  assert.equal(link.text, 'Click me');
  assert.equal(link.attrs.href, '/foo');
  assert.equal(link.attrs.title, 'Tip');

  const email = sh.assertions.snapshot(document.getElementById('email'));
  assert.equal(email.value, 'a@b.c');

  const agree = sh.assertions.snapshot(document.getElementById('agree'));
  assert.equal(agree.checked, true);
});

test('assertions suggestPlaywright fills locator + values into snippets', () => {
  const { sh, document } = makeSandbox(`
    <button id="b">Save changes</button>
  `);
  const el = document.getElementById('b');
  const snap = sh.assertions.snapshot(el);
  const out = sh.assertions.suggestPlaywright(`page.getByRole('button', { name: 'Save changes' })`, snap);
  const names = out.map((a) => a.name);
  assert.ok(names.includes('toBeVisible') || names.includes('toBeHidden'));
  assert.ok(names.includes('toHaveText'));
  const text = out.find((a) => a.name === 'toHaveText');
  assert.match(text.code, /\.toHaveText\('Save changes'\);/);
});

test('action emitters render the right verb per framework', () => {
  const { sh } = makeSandbox(`<body></body>`);
  const m = { strategy: 'testid', value: 'save' };
  // Playwright
  assert.equal(sh.codegen.playwrightAction('testid', m, 'click'),       `await page.getByTestId('save').click();`);
  assert.equal(sh.codegen.playwrightAction('testid', m, 'fill', 'hi'),  `await page.getByTestId('save').fill('hi');`);
  assert.equal(sh.codegen.playwrightAction('testid', m, 'press', 'Tab'),`await page.getByTestId('save').press('Tab');`);
  assert.equal(sh.codegen.playwrightAction('testid', m, 'hover'),       `await page.getByTestId('save').hover();`);
  assert.equal(sh.codegen.playwrightAction('testid', m, 'check'),       `await page.getByTestId('save').check();`);
  assert.equal(sh.codegen.playwrightAction('testid', m, 'scrollIntoView'), `await page.getByTestId('save').scrollIntoViewIfNeeded();`);
  // Cypress
  assert.match(sh.codegen.cypressAction('testid', m, 'fill', 'hi'),     /\.clear\(\)\.type\('hi'\);/);
  assert.match(sh.codegen.cypressAction('testid', m, 'press', 'Enter'), /\.type\('\{enter\}'\);/);
  // Selenium
  assert.match(sh.codegen.seleniumAction('testid', m, 'fill', 'hi'),    /el\.clear\(\)\nel\.send_keys\('hi'\)/);
  assert.match(sh.codegen.seleniumAction('testid', m, 'press', 'Enter'),/send_keys\(Keys\.ENTER\)/);
});

test('fallback chain reflects the chosen action', () => {
  const { sh } = makeSandbox(`<body></body>`);
  const top = [
    { strategy: 'testid', value: 'email' },
    { strategy: 'label', value: 'Email' },
  ];
  const fillChain = sh.codegen.playwrightFallbackChain(top, 'fill', 'a@b.c');
  assert.match(fillChain, /\.fill\('a@b\.c'\);/);
  const press = sh.codegen.playwrightFallbackChain(top, 'press', 'Tab');
  assert.match(press, /\.press\('Tab'\);/);
});

test('locator-engine topN returns serialisable candidates capped at N', () => {
  const { sh, document } = makeSandbox(`
    <button data-testid="save" aria-label="Save the form">Save</button>
  `);
  const el = document.querySelector('button');
  const top = sh.locatorEngine.topN(el, 3);
  assert.ok(top.length <= 3);
  assert.equal(top[0].strategy, 'testid');
  // every entry must be a plain object (no functions, no DOM refs)
  for (const c of top) {
    assert.equal(typeof c, 'object');
    assert.ok(!('code' in c)); // codegen output is not part of the trimmed shape
  }
});
