// Server-side Playwright code emitter. The extension has its own codegen
// for the in-popup display of single picks; this module is the symmetric
// renderer for *generated* tests, where steps reference corpus captureIds.
//
// Two callers:
//   1. generate-test → LLM-generated steps with locatorRefs only
//   2. enrich-recording → raw recorded steps (with .locator) merged with
//      added LLM assertions (with .locatorRef into corpus)
//
// We accept both shapes — `step.locator` takes precedence, otherwise we
// resolve `step.locatorRef` against the corpus map.

function jsString(value) {
  return "'" + String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r') + "'";
}

function playwrightLocator(loc) {
  switch (loc.strategy) {
    case 'testid':      return `page.getByTestId(${jsString(loc.value)})`;
    case 'role':        return `page.getByRole(${jsString(loc.role)}, { name: ${jsString(loc.name)}, exact: true })`;
    case 'label':       return `page.getByLabel(${jsString(loc.value)}, { exact: true })`;
    case 'placeholder': return `page.getByPlaceholder(${jsString(loc.value)}, { exact: true })`;
    case 'altText':     return `page.getByAltText(${jsString(loc.value)}, { exact: true })`;
    case 'title':       return `page.getByTitle(${jsString(loc.value)}, { exact: true })`;
    case 'text':        return `page.getByText(${jsString(loc.value)}, { exact: true })`;
    case 'id':          return `page.locator(${jsString('#' + loc.value)})`;
    case 'css':         return `page.locator(${jsString(loc.value)})`;
    case 'xpath':       return `page.locator(${jsString('xpath=' + loc.value)})`;
    default:            return `page.locator('UNKNOWN_STRATEGY')`;
  }
}

function resolveLocator(step, corpusById) {
  if (step.locator) return step.locator;
  if (step.locatorRef && corpusById) {
    const cap = corpusById.get(step.locatorRef);
    if (cap) return cap.best;
  }
  return null;
}

export function renderStep(step, corpusById) {
  const cmt = step.comment ? ` // ${step.comment}` : '';
  if (step.type === 'goto') return `  await page.goto(${jsString(step.url || '')});${cmt}`;
  if (step.type === 'expectURL') return `  await expect(page).toHaveURL(${jsString(step.url || step.value || '')});${cmt}`;

  const loc = resolveLocator(step, corpusById);
  if (!loc) return `  // [skipped ${step.type}: missing locator${step.locatorRef ? ' (corpus miss: ' + step.locatorRef + ')' : ''}]`;
  const expr = playwrightLocator(loc);

  switch (step.type) {
    case 'click':            return `  await ${expr}.click();${cmt}`;
    case 'dblclick':         return `  await ${expr}.dblclick();${cmt}`;
    case 'hover':            return `  await ${expr}.hover();${cmt}`;
    case 'focus':            return `  await ${expr}.focus();${cmt}`;
    case 'fill':             return `  await ${expr}.fill(${jsString(step.value || '')});${cmt}`;
    case 'press':            return `  await ${expr}.press(${jsString(step.value || 'Enter')});${cmt}`;
    case 'select':           return `  await ${expr}.selectOption(${jsString(step.value || '')});${cmt}`;
    case 'check':            return `  await ${expr}.check();${cmt}`;
    case 'uncheck':          return `  await ${expr}.uncheck();${cmt}`;
    case 'expectVisible':    return `  await expect(${expr}).toBeVisible();${cmt}`;
    case 'expectHidden':     return `  await expect(${expr}).toBeHidden();${cmt}`;
    case 'expectText':       return `  await expect(${expr}).toHaveText(${jsString(step.value || '')});${cmt}`;
    case 'expectValue':      return `  await expect(${expr}).toHaveValue(${jsString(step.value || '')});${cmt}`;
    case 'expectChecked':    return `  await expect(${expr}).toBeChecked();${cmt}`;
    case 'expectNotChecked': return `  await expect(${expr}).not.toBeChecked();${cmt}`;
    case 'expectAttribute':  return `  await expect(${expr}).toHaveAttribute(${jsString(step.attribute || '')}, ${jsString(step.value || '')});${cmt}`;
    default:                 return `  // [unknown step type: ${step.type}]`;
  }
}

export function renderTest({ testName, steps, corpus }) {
  const corpusById = new Map((corpus || []).map((c) => [c.captureId, c]));
  const safeName = (testName || 'generated test').replace(/'/g, "\\'");
  const lines = (steps || []).map((s) => renderStep(s, corpusById));
  return [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test('${safeName}', async ({ page }) => {`,
    lines.length ? lines.join('\n') : `  // (no steps)`,
    `});`,
    ``,
  ].join('\n');
}

// Merge LLM-suggested assertions into a raw recorded step list. The model
// returns insertAfterIndex coordinates; we sort DESC and splice from back
// to front so earlier insertions don't shift later indices.
export function mergeEnrichment({ rawSteps, addedAssertions, corpus }) {
  const corpusById = new Map((corpus || []).map((c) => [c.captureId, c]));
  const merged = [...(rawSteps || [])];
  const sorted = [...(addedAssertions || [])].sort(
    (a, b) => b.insertAfterIndex - a.insertAfterIndex
  );
  for (const a of sorted) {
    const insertAt = Math.max(0, Math.min(merged.length, (a.insertAfterIndex ?? -1) + 1));
    const cap = a.locatorRef ? corpusById.get(a.locatorRef) : null;
    merged.splice(insertAt, 0, {
      type: a.type,
      value: a.value,
      url: a.url,
      locator: cap ? cap.best : null,
      locatorRef: a.locatorRef,
      comment: a.rationale ? `AI: ${a.rationale}` : undefined,
    });
  }
  return merged;
}
