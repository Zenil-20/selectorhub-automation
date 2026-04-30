(function () {
  'use strict';
  const SH = (globalThis.__SH = globalThis.__SH || {});
  const js = SH.jsString;

  // -------------------------------------------------------------------------
  // Locator expressions — *no actions appended*. The action layer lives below.
  //
  // CRITICAL: Playwright's getByText / getByLabel / getByRole({ name }) / etc
  // default to *case-insensitive substring* matching. Our verifier compares
  // accessible names and text *exactly*, so we MUST emit `exact: true` for
  // every text-shaped strategy or we'd be lying — verifier finds 1 match,
  // runtime finds 3. Always emit exact-mode so what we verify is what runs.
  // -------------------------------------------------------------------------

  function playwrightLocator(strategy, m) {
    switch (strategy) {
      case 'testid':      return `page.getByTestId(${js(m.value)})`;
      case 'role':        return `page.getByRole(${js(m.role)}, { name: ${js(m.name)}, exact: true })`;
      case 'label':       return `page.getByLabel(${js(m.value)}, { exact: true })`;
      case 'placeholder': return `page.getByPlaceholder(${js(m.value)}, { exact: true })`;
      case 'altText':     return `page.getByAltText(${js(m.value)}, { exact: true })`;
      case 'title':       return `page.getByTitle(${js(m.value)}, { exact: true })`;
      case 'text':        return `page.getByText(${js(m.value)}, { exact: true })`;
      case 'id':          return `page.locator(${js('#' + m.value)})`;
      case 'css':         return `page.locator(${js(m.value)})`;
      case 'xpath':       return `page.locator(${js('xpath=' + m.value)})`;
      default:            return '';
    }
  }

  function cypressLocator(strategy, m) {
    switch (strategy) {
      case 'testid':      return `cy.get(${js('[data-testid="' + m.value + '"]')})`;
      case 'role':        return `cy.findByRole(${js(m.role)}, { name: ${js(m.name)}, exact: true })`;
      case 'label':       return `cy.contains('label', ${js(m.value)})`;
      case 'placeholder': return `cy.get(${js('[placeholder="' + m.value + '"]')})`;
      case 'altText':     return `cy.get(${js('[alt="' + m.value + '"]')})`;
      case 'title':       return `cy.get(${js('[title="' + m.value + '"]')})`;
      case 'text':        return `cy.contains(${js(m.value)})`;
      case 'id':          return `cy.get(${js('#' + m.value)})`;
      case 'css':         return `cy.get(${js(m.value)})`;
      case 'xpath':       return `cy.xpath(${js(m.value)})`;
      default:            return '';
    }
  }

  function seleniumFinder(strategy, m) {
    switch (strategy) {
      case 'testid':      return `By.CSS_SELECTOR, ${js('[data-testid="' + m.value + '"]')}`;
      case 'role':        return `By.XPATH, ${js(`//*[@role="${m.role}" and normalize-space()="${m.name}"]`)}`;
      case 'label':       return `By.XPATH, ${js(`//label[normalize-space()="${m.value}"]`)}`;
      case 'placeholder': return `By.CSS_SELECTOR, ${js('[placeholder="' + m.value + '"]')}`;
      case 'altText':     return `By.CSS_SELECTOR, ${js('[alt="' + m.value + '"]')}`;
      case 'title':       return `By.CSS_SELECTOR, ${js('[title="' + m.value + '"]')}`;
      case 'text':        return `By.XPATH, ${js(`//*[normalize-space(text())="${m.value}"]`)}`;
      case 'id':          return `By.ID, ${js(m.value)}`;
      case 'css':         return `By.CSS_SELECTOR, ${js(m.value)}`;
      case 'xpath':       return `By.XPATH, ${js(m.value)}`;
      default:            return '';
    }
  }

  // -------------------------------------------------------------------------
  // Actions — mapping a generic verb (`click`, `fill`, `press`, ...) to
  // each framework's idiom. The popup chooses an action; the candidate
  // cards re-render through these.
  // -------------------------------------------------------------------------

  const ACTIONS = [
    'click', 'dblclick', 'hover', 'focus',
    'fill', 'press', 'selectOption',
    'check', 'uncheck',
    'scrollIntoView', 'screenshot',
  ];

  // Actions that need a value field in the UI.
  const ACTIONS_WITH_VALUE = new Set(['fill', 'press', 'selectOption']);

  function playwrightVerb(action, value) {
    switch (action) {
      case 'click':          return 'click()';
      case 'dblclick':       return 'dblclick()';
      case 'hover':          return 'hover()';
      case 'focus':          return 'focus()';
      case 'fill':           return `fill(${js(value || '')})`;
      case 'press':          return `press(${js(value || 'Enter')})`;
      case 'selectOption':   return `selectOption(${js(value || '')})`;
      case 'check':          return 'check()';
      case 'uncheck':        return 'uncheck()';
      case 'scrollIntoView': return 'scrollIntoViewIfNeeded()';
      case 'screenshot':     return 'screenshot()';
      default:               return 'click()';
    }
  }

  function playwrightAction(strategy, m, action = 'click', value) {
    const loc = playwrightLocator(strategy, m);
    if (!loc) return '';
    return `await ${loc}.${playwrightVerb(action, value)};`;
  }

  function cypressAction(strategy, m, action = 'click', value) {
    const loc = cypressLocator(strategy, m);
    if (!loc) return '';
    switch (action) {
      case 'click':          return `${loc}.click();`;
      case 'dblclick':       return `${loc}.dblclick();`;
      case 'hover':          return `${loc}.trigger('mouseover');`;
      case 'focus':          return `${loc}.focus();`;
      case 'fill':           return `${loc}.clear().type(${js(value || '')});`;
      case 'press':          return `${loc}.type(${js('{' + (value || 'enter').toLowerCase() + '}')});`;
      case 'selectOption':   return `${loc}.select(${js(value || '')});`;
      case 'check':          return `${loc}.check();`;
      case 'uncheck':        return `${loc}.uncheck();`;
      case 'scrollIntoView': return `${loc}.scrollIntoView();`;
      case 'screenshot':     return `${loc}.screenshot();`;
      default:               return `${loc}.click();`;
    }
  }

  function seleniumAction(strategy, m, action = 'click', value) {
    const f = seleniumFinder(strategy, m);
    if (!f) return '';
    const find = `driver.find_element(${f})`;
    switch (action) {
      case 'click':          return `${find}.click()`;
      case 'dblclick':       return `ActionChains(driver).double_click(${find}).perform()`;
      case 'hover':          return `ActionChains(driver).move_to_element(${find}).perform()`;
      case 'focus':          return `${find}.send_keys('')`;
      case 'fill':           return `el = ${find}\nel.clear()\nel.send_keys(${js(value || '')})`;
      case 'press':          return `${find}.send_keys(Keys.${(value || 'enter').toUpperCase()})`;
      case 'selectOption':   return `Select(${find}).select_by_visible_text(${js(value || '')})`;
      case 'check':          return `el = ${find}\nif not el.is_selected(): el.click()`;
      case 'uncheck':        return `el = ${find}\nif el.is_selected(): el.click()`;
      case 'scrollIntoView': return `driver.execute_script('arguments[0].scrollIntoView({block:"center"})', ${find})`;
      case 'screenshot':     return `${find}.screenshot('element.png')`;
      default:               return `${find}.click()`;
    }
  }

  // Backwards-compat single-line click emitters.
  function playwright(strategy, m) { return playwrightAction(strategy, m, 'click'); }
  function cypress(strategy, m) { return cypressAction(strategy, m, 'click'); }
  function selenium(strategy, m) { return seleniumAction(strategy, m, 'click'); }

  // -------------------------------------------------------------------------
  // Self-healing fallback chain — top-N candidates joined with Locator.or().
  // Tradeoff documented inline so the engineer is reminded that fallback
  // is silent at runtime; audit logs after a UI refactor.
  // -------------------------------------------------------------------------

  function playwrightFallbackChain(candidates, action = 'click', value) {
    if (!candidates || !candidates.length) return '';
    const exprs = candidates.map((c) => playwrightLocator(c.strategy, c)).filter(Boolean);
    if (!exprs.length) return '';
    if (exprs.length === 1) return `await ${exprs[0]}.${playwrightVerb(action, value)};`;
    const head = exprs[0];
    const tail = exprs.slice(1).map((e) => `  .or(${e})`).join('\n');
    return [
      '// Self-healing chain: tries each locator in order. The fallback is silent —',
      '// after a UI refactor, audit your test logs to see whether a primary broke.',
      `await ${head}`,
      tail,
      `  .${playwrightVerb(action, value)};`,
    ].join('\n');
  }

  // -------------------------------------------------------------------------
  // Recorder step → Playwright code.
  // -------------------------------------------------------------------------

  function playwrightStep(step) {
    if (step.type === 'goto') return `  await page.goto(${js(step.url)});`;
    if (!step.locator) return `  // [skipped ${step.type}: no stable locator]`;
    const loc = playwrightLocator(step.locator.strategy, step.locator);
    if (!loc) return `  // [skipped ${step.type}: unrecognised strategy]`;
    switch (step.type) {
      case 'click':         return `  await ${loc}.click();`;
      case 'dblclick':      return `  await ${loc}.dblclick();`;
      case 'fill':          return `  await ${loc}.fill(${js(step.value || '')});`;
      case 'select':        return `  await ${loc}.selectOption(${js(step.value || '')});`;
      case 'check':         return `  await ${loc}.check();`;
      case 'uncheck':       return `  await ${loc}.uncheck();`;
      case 'press':         return `  await ${loc}.press(${js(step.value || 'Enter')});`;
      case 'expectVisible':    return `  await expect(${loc}).toBeVisible();`;
      case 'expectHidden':     return `  await expect(${loc}).toBeHidden();`;
      case 'expectText':       return `  await expect(${loc}).toHaveText(${js(step.value || '')});`;
      case 'expectValue':      return `  await expect(${loc}).toHaveValue(${js(step.value || '')});`;
      case 'expectChecked':    return `  await expect(${loc}).toBeChecked();`;
      case 'expectNotChecked': return `  await expect(${loc}).not.toBeChecked();`;
      default:                 return `  // [unknown step type: ${step.type}]`;
    }
  }

  function playwrightTest(testName, steps) {
    const body = (steps || []).map(playwrightStep).filter(Boolean).join('\n');
    const safeName = (testName || 'recorded flow').replace(/'/g, "\\'");
    return [
      `import { test, expect } from '@playwright/test';`,
      ``,
      `test('${safeName}', async ({ page }) => {`,
      body || `  // (no steps recorded)`,
      `});`,
      ``,
    ].join('\n');
  }

  // -------------------------------------------------------------------------
  // Verification selector — used by the engine to confirm a candidate
  // resolves uniquely on the live document before showing it to the user.
  // -------------------------------------------------------------------------

  function verificationSelector(strategy, m) {
    switch (strategy) {
      case 'testid':      return { type: 'css', value: `[data-testid="${SH.cssEscape(m.value)}"]` };
      case 'placeholder': return { type: 'css', value: `[placeholder=${SH.attrValue(m.value)}]` };
      case 'altText':     return { type: 'css', value: `[alt=${SH.attrValue(m.value)}]` };
      case 'title':       return { type: 'css', value: `[title=${SH.attrValue(m.value)}]` };
      case 'id':          return { type: 'css', value: `#${SH.cssEscape(m.value)}` };
      case 'css':         return { type: 'css', value: m.value };
      case 'xpath':       return { type: 'xpath', value: m.value };
      default: return null;
    }
  }

  SH.codegen = {
    ACTIONS,
    ACTIONS_WITH_VALUE,
    playwright,
    cypress,
    selenium,
    playwrightLocator,
    cypressLocator,
    seleniumFinder,
    playwrightAction,
    cypressAction,
    seleniumAction,
    playwrightVerb,
    playwrightFallbackChain,
    playwrightStep,
    playwrightTest,
    verificationSelector,
  };
})();
