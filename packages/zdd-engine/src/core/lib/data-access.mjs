// Data access, the shapes every data-access adapter shares (decision 0037):
// the record, and the rule that a function's data access is its own and that
// of every same-file function it uses. Generic: no adapter, no language, no
// database here — an adapter cuts its own functions and names its own calls.

import { slugify } from "./slug.mjs";

// Close a per-function set over the same-file references (`entries`: each
// { name, refers }, refers the same-file names it uses): name -> its own
// set united with every function's it reaches, transitively, each function
// once. Strongly connected functions (mutual recursion) share one result
// (Tarjan's algorithm, iterative), so a long chain or a cycle stays linear in
// the number of functions plus references.
export function closeOver(entries, own) {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const succOf = (n) => [...byName.get(n).refers].filter((r) => byName.has(r));
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const result = new Map();
  let next = 0;
  const visit = (n) => {
    index.set(n, next);
    low.set(n, next++);
    stack.push(n);
    onStack.add(n);
  };
  for (const start of byName.keys()) {
    if (index.has(start)) continue;
    visit(start);
    const work = [[start, succOf(start), 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, succ] = frame;
      if (frame[2] < succ.length) {
        const w = succ[frame[2]++];
        if (!index.has(w)) {
          visit(w);
          work.push([w, succOf(w), 0]);
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        continue;
      }
      work.pop();
      if (work.length) {
        const u = work[work.length - 1][0];
        low.set(u, Math.min(low.get(u), low.get(v)));
      }
      if (low.get(v) !== index.get(v)) continue;
      // v roots a component: its members share one set; every successor
      // outside it is already closed.
      const members = new Set();
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        members.add(w);
      } while (w !== v);
      const set = new Set();
      for (const m of members) {
        for (const x of own(byName.get(m))) set.add(x);
        for (const r of byName.get(m).refers) {
          if (members.has(r) || !result.has(r)) continue;
          for (const x of result.get(r)) set.add(x);
        }
      }
      for (const m of members) result.set(m, set);
    }
  }
  return result;
}

// A data-access record, shaped the same by every data-access adapter.
// The id is namespaced by the adapter (`data-access:<adapter>/<file>#<fn>`,
// as a table is `table:db/<name>`), so two adapters that both read one
// function mint two records; `?code:<file>#<fn>` reaches both (decision 0037).
// A source path may hold characters a metadata filename may not (a space, a
// `#`): each is written `~<hex>~`, so a valid path never aborts derive (CR-031).
const FILENAME_SAFE = /[^A-Za-z0-9._~()[\]-]/g;
// `fn` is { name, docstring }: the function's name as `?code:` names it, and
// its description (a docstring, or the comment above it).
export function dataAccessRecord(adapter, rel, fn, refs, edges) {
  return {
    kind: "data-access",
    id: `data-access:${adapter}/${rel}#${fn.name}`,
    title: `${fn.name} (${rel})`,
    description: fn.docstring,
    resource: [rel],
    refs: [...refs].sort(),
    facts: { function: fn.name, ...(edges ? { edges } : {}) },
    filename: `${adapter}--${slugify(rel)}--${fn.name}.json`.replace(FILENAME_SAFE, (c) => `~${c.codePointAt(0).toString(16)}~`),
    requireRefs: true,
  };
}
