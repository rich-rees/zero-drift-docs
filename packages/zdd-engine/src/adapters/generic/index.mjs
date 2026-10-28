// generic extractor — emits nothing. The minimal worked example of the
// extractor contract, and the way a stack with no extractor adopts ZDD on day
// one: metadata stays empty, the semantic map carries the whole picture, and
// `derive --check` passes by construction. Add a real extractor later.
export const FACTS_KEY_ORDER = {};

export function derive() {
  return { records: [], diagnostics: [] };
}

// Detection (decision 0039): the fallback. Source in a language with no
// adapter that fits is still existing code: map-only ZDD until an adapter is
// built for it. `sourceFile` and `existing` are what make a repo existing
// code rather than greenfield (a manifest with no source yet counts).
export const DETECTION = {
  parts: [],
  order: 99,
  fallback: true,
  sourceFile: /\.(ts|tsx|js|jsx|py|sql|go|rb|rs|java|cs)$/,
  existing: ["package.json"],
};

export function detect() {
  return { proposal: { evidence: ["source present but no known convention found — map-only ZDD; scaffold an extractor for it with the `extractor` skill once bootstrap is done"], options: {} } };
}

// The adapter contract this adapter was written for, and how to comment
// out a line of each kind of file it reads: what the standard suite needs
// (decision 0040). `{}`: nothing it reads takes a line comment.
export const CONTRACT = 1;
export const COMMENT = {};
