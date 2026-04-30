// All step + assertion type vocabularies live here so prompts and validators
// share the same source of truth.
export const STEP_TYPES = [
  'goto', 'click', 'dblclick', 'hover', 'focus',
  'fill', 'press', 'select', 'check', 'uncheck',
  'expectVisible', 'expectHidden', 'expectText', 'expectValue',
  'expectChecked', 'expectNotChecked', 'expectAttribute', 'expectURL',
];
export const ASSERTION_STEPS = new Set([
  'expectVisible', 'expectHidden', 'expectText', 'expectValue',
  'expectChecked', 'expectNotChecked', 'expectAttribute', 'expectURL',
]);

// Tool-use schemas. Each is a JSON Schema attached to an Anthropic "tool";
// the model's reply MUST be a tool_use block matching this shape, so we
// never have to parse free-form prose.

// Phase-1 tool — given a focal element + a pre-loaded corpus of locators
// for the same project/route, return assertions and edge-case test ideas.
// Crucially: every locatorRef value MUST be a captureId that was passed in
// the corpus. We post-validate this; the LLM cannot invent selectors.
export const SUGGEST_ASSERTIONS_TOOL = {
  name: 'suggest_assertions',
  description:
    'Propose Playwright assertions and edge-case test ideas for the focal ' +
    'element. Every locatorRef value MUST be a captureId from the supplied ' +
    'corpus. Do not invent selectors. Do not reference captureIds that are not in the corpus.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['assertions', 'edgeCases', 'summary'],
    properties: {
      summary: {
        type: 'string',
        description: 'One-sentence description of what this element is and why a test should care about it.',
      },
      assertions: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'locatorRef', 'rationale'],
          properties: {
            type: {
              type: 'string',
              enum: [
                'toBeVisible', 'toBeHidden',
                'toHaveText', 'toContainText',
                'toHaveValue',
                'toBeChecked', 'notToBeChecked',
                'toBeEnabled', 'toBeDisabled',
                'toHaveAttribute',
                'toHaveURL',
              ],
            },
            locatorRef: {
              type: 'string',
              description: 'A captureId from the supplied corpus.',
            },
            value: { type: 'string' },
            attribute: { type: 'string' },
            rationale: {
              type: 'string',
              description: 'Why this assertion adds test value beyond visibility.',
            },
          },
        },
      },
      edgeCases: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'rationale'],
          properties: {
            title: { type: 'string' },
            steps: { type: 'array', items: { type: 'string' } },
            relatedLocatorRefs: {
              type: 'array',
              items: { type: 'string' },
              description: 'captureIds from the corpus referenced by this idea.',
            },
            rationale: { type: 'string' },
          },
        },
      },
    },
  },
};

// Phase-2 tool — turn a natural-language test intent into a complete
// Playwright test, expressed as structured steps. Every step's locatorRef
// must point into the supplied corpus.
export const EMIT_TEST_TOOL = {
  name: 'emit_test',
  description:
    'Generate a complete Playwright test from the engineer\'s intent. ' +
    'Every step\'s locatorRef MUST be a captureId from the supplied corpus — ' +
    'do not invent. If a part of the intent cannot be expressed with the ' +
    'corpus, list it in missingCapabilities and emit only the steps that can.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['testName', 'steps', 'rationale'],
    properties: {
      testName: { type: 'string', description: 'Concise active-voice test name.' },
      rationale: { type: 'string', description: 'One short sentence explaining what this test verifies.' },
      steps: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: {
            type: { type: 'string', enum: STEP_TYPES },
            locatorRef: { type: 'string', description: 'captureId from the corpus. Required for all step types except goto and expectURL.' },
            url: { type: 'string', description: 'Required for goto and expectURL.' },
            value: { type: 'string' },
            attribute: { type: 'string' },
            comment: { type: 'string', description: 'Optional inline comment for the rendered code.' },
          },
        },
      },
      missingCapabilities: {
        type: 'array',
        items: { type: 'string' },
        description: 'Things the test would need that are not in the corpus. Empty array if none.',
      },
    },
  },
};

// Phase-2b tool — given a recorder's raw step list, suggest a descriptive
// test name plus assertions to *insert* at meaningful points. The original
// recorded steps are immutable; this tool only proposes additive
// insertions, each grounded against a corpus captureId.
export const ENRICH_RECORDING_TOOL = {
  name: 'enrich_recording',
  description:
    'Polish a recorded Playwright flow by suggesting a descriptive test name ' +
    'and assertions to insert. You may NOT modify or remove any existing step. ' +
    'Every assertion\'s locatorRef MUST be a captureId from the supplied corpus.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['testName', 'addedAssertions', 'rationale'],
    properties: {
      testName: { type: 'string' },
      rationale: { type: 'string' },
      addedAssertions: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['insertAfterIndex', 'type', 'rationale'],
          properties: {
            insertAfterIndex: {
              type: 'integer',
              description: 'Index in the recorded steps array AFTER which to insert. -1 means at the very start.',
            },
            type: {
              type: 'string',
              enum: ['expectVisible', 'expectHidden', 'expectText', 'expectValue',
                     'expectChecked', 'expectNotChecked', 'expectURL'],
            },
            locatorRef: { type: 'string' },
            url: { type: 'string' },
            value: { type: 'string' },
            rationale: { type: 'string' },
          },
        },
      },
      followUpIdeas: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'rationale'],
          properties: {
            title: { type: 'string' },
            rationale: { type: 'string' },
          },
        },
      },
    },
  },
};
