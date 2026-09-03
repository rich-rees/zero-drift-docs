// generic extractor — emits nothing. The minimal worked example of the
// extractor contract, and the way a stack with no extractor adopts ZDD on day
// one: metadata stays empty, the semantic map carries the whole picture, and
// `derive --check` passes by construction. Add a real extractor later.
export const FACTS_KEY_ORDER = {};

export function derive() {
  return { records: [], diagnostics: [] };
}
