// Test helper (not a test file): what a route or screen record's `?code:`
// refs reach BEFORE the merge (decision 0037). Each `?code:<file>#<unit>` is
// replaced by the unresolved refs of the data-access records it names, and
// `#*` by those of every record in the file, so an adapter's test can still
// say "this screen reaches `?from:avatars`" without a schema to resolve
// against. The core's own join is tested in data-access.test.mjs.
import { derive as supabaseJs } from "../src/adapters/supabase-js/index.mjs";
import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";

export function dataAccessOf(repoRoot, options = {}) {
  return supabaseJs({ repoRoot, options, io: makeExtractorIo(repoRoot) }).records;
}

// refs -> the same list with each `?code:` ref replaced by what it reaches,
// sorted and unique. `edges` collects the typed edges reached, by verb.
export function reach(refs, dataAccess, edges = {}) {
  const out = new Set();
  for (const ref of refs) {
    if (!ref.startsWith("?code:")) {
      out.add(ref);
      continue;
    }
    const target = ref.slice("?code:".length);
    const hash = target.lastIndexOf("#");
    const file = target.slice(0, hash);
    const unit = target.slice(hash + 1);
    for (const d of dataAccess) {
      if (d.resource[0] !== file || (unit !== "*" && d.facts.function !== unit)) continue;
      for (const r of d.refs) out.add(r);
      for (const [verb, ids] of Object.entries(d.facts.edges ?? {})) for (const id of ids) (edges[verb] ??= new Set()).add(id);
    }
  }
  return [...out].sort();
}

export const withoutCode = (refs) => refs.filter((r) => !r.startsWith("?code:"));
