// Corpus-membership validator — the second half of the grounding contract.
// We told the model "use only these captureIds"; we do not trust it to
// comply. Every locatorRef in the output is checked against the corpus.
// Failures are reported back as an array of strings; the caller decides
// whether to retry or surface the error.

export function validateSuggestionOutput(output, corpus) {
  if (!output || typeof output !== 'object') {
    return ['output is not an object'];
  }
  const corpusIds = new Set(corpus.map((c) => c.captureId));
  const errors = [];

  if (!Array.isArray(output.assertions)) {
    errors.push('assertions[] is missing or not an array');
  } else {
    for (let i = 0; i < output.assertions.length; i++) {
      const a = output.assertions[i];
      if (!a || typeof a !== 'object') { errors.push(`assertions[${i}] is not an object`); continue; }
      if (!corpusIds.has(a.locatorRef)) {
        errors.push(`assertions[${i}].locatorRef "${a.locatorRef}" is not in the corpus`);
      }
      if (a.type === 'toHaveAttribute' && !a.attribute) {
        errors.push(`assertions[${i}] is toHaveAttribute but has no "attribute" field`);
      }
      const valueRequired = ['toHaveText', 'toContainText', 'toHaveValue', 'toHaveAttribute', 'toHaveURL'];
      if (valueRequired.includes(a.type) && !a.value) {
        errors.push(`assertions[${i}].type=${a.type} requires a "value" field`);
      }
    }
  }

  if (!Array.isArray(output.edgeCases)) {
    errors.push('edgeCases[] is missing or not an array');
  } else {
    for (let i = 0; i < output.edgeCases.length; i++) {
      const e = output.edgeCases[i];
      if (!e || typeof e !== 'object') { errors.push(`edgeCases[${i}] is not an object`); continue; }
      const refs = e.relatedLocatorRefs || [];
      if (!Array.isArray(refs)) {
        errors.push(`edgeCases[${i}].relatedLocatorRefs must be an array`);
        continue;
      }
      for (const ref of refs) {
        if (!corpusIds.has(ref)) {
          errors.push(`edgeCases[${i}].relatedLocatorRefs contains "${ref}" which is not in the corpus`);
        }
      }
    }
  }

  return errors;
}

// Test-output validator (Phase 2 generate-test). Same grounding contract:
// every step's locatorRef must exist in the input corpus, value/url
// requirements per step type are enforced.
export function validateTestOutput(output, corpus) {
  if (!output || typeof output !== 'object') return ['output is not an object'];
  if (typeof output.testName !== 'string' || !output.testName.trim()) {
    return ['testName is required'];
  }
  const errors = [];
  if (!Array.isArray(output.steps)) {
    errors.push('steps[] is missing or not an array');
    return errors;
  }
  if (output.steps.length === 0) {
    errors.push('steps[] cannot be empty');
    return errors;
  }
  const corpusIds = new Set(corpus.map((c) => c.captureId));
  for (let i = 0; i < output.steps.length; i++) {
    const s = output.steps[i];
    if (!s || typeof s !== 'object') { errors.push(`steps[${i}] is not an object`); continue; }
    if (!s.type) { errors.push(`steps[${i}].type is required`); continue; }
    if (s.type === 'goto' || s.type === 'expectURL') {
      if (!s.url) errors.push(`steps[${i}].type=${s.type} requires "url"`);
      continue;
    }
    if (!s.locatorRef) {
      errors.push(`steps[${i}].locatorRef is required for type=${s.type}`);
      continue;
    }
    if (!corpusIds.has(s.locatorRef)) {
      errors.push(`steps[${i}].locatorRef "${s.locatorRef}" is not in the corpus`);
    }
    const valueRequired = ['fill', 'press', 'select', 'expectText', 'expectValue', 'expectAttribute'];
    if (valueRequired.includes(s.type) && !s.value) {
      errors.push(`steps[${i}].type=${s.type} requires "value"`);
    }
    if (s.type === 'expectAttribute' && !s.attribute) {
      errors.push(`steps[${i}].type=expectAttribute requires "attribute"`);
    }
  }
  return errors;
}

// Enrichment-output validator (recorder polish). Recorded steps are not
// validated here — they are presumed correct because they came from the
// engine. We only validate the *added* assertions.
export function validateEnrichmentOutput(output, corpus) {
  if (!output || typeof output !== 'object') return ['output is not an object'];
  if (typeof output.testName !== 'string' || !output.testName.trim()) {
    return ['testName is required'];
  }
  if (!Array.isArray(output.addedAssertions)) return ['addedAssertions[] is missing or not an array'];
  const corpusIds = new Set(corpus.map((c) => c.captureId));
  const errors = [];
  for (let i = 0; i < output.addedAssertions.length; i++) {
    const a = output.addedAssertions[i];
    if (!a || typeof a !== 'object') { errors.push(`addedAssertions[${i}] is not an object`); continue; }
    if (typeof a.insertAfterIndex !== 'number' || !Number.isInteger(a.insertAfterIndex)) {
      errors.push(`addedAssertions[${i}].insertAfterIndex must be an integer`);
    }
    if (a.type === 'expectURL') {
      if (!a.url && !a.value) {
        errors.push(`addedAssertions[${i}].type=expectURL requires url or value`);
      }
      continue;
    }
    if (!a.locatorRef) {
      errors.push(`addedAssertions[${i}].locatorRef is required for type=${a.type}`);
      continue;
    }
    if (!corpusIds.has(a.locatorRef)) {
      errors.push(`addedAssertions[${i}].locatorRef "${a.locatorRef}" is not in the corpus`);
    }
    const valueRequired = ['expectText', 'expectValue'];
    if (valueRequired.includes(a.type) && !a.value) {
      errors.push(`addedAssertions[${i}].type=${a.type} requires "value"`);
    }
  }
  return errors;
}
