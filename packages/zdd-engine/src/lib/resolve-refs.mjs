// Post-merge ref resolution. Extractors are composed by config and cannot see
// each other's records, so a Next.js route that calls `.from('things')` cannot
// know the table's id (`table:db/things`) — that id is minted by the supabase
// extractor. The contract: an extractor emits a resolved id when it minted
// the target itself, and an UNRESOLVED ref — a string starting with `?` —
// when the target belongs to whichever extractor owns that convention. After
// all extractors have run, this pass resolves the `?` refs against the merged
// record set. Misses are dropped with a diagnostic (the same honesty the
// monolithic adapter had), self-refs are dropped silently, and a record
// flagged `requireRefs` is dropped when nothing resolved — that flag is how a
// "module" record (a file that references something) keeps its old meaning;
// refs pointing at a dropped record are stripped too (CR-009).
//
//   ?from:<name>      a table, else a bucket — the supabase-client `.from()`
//                     / `.table()` receiver ambiguity, resolved by name-set
//                     membership exactly as before
//   ?table:<name>     a table by name
//   ?bucket:<name>    a bucket by name
//   ?function:<name>  a database function by name
//   ?route:<url>      the route whose path pattern matches <url>; `*` in the
//                     url is one wildcard segment
//
// <name> is the id's text after its `kind:` prefix, or after the namespace
// slash when the id is namespaced (`table:db/things` -> `things`); a
// namespace-qualified lookup (`?function:db/save`) matches the full text. An
// UNQUALIFIED name that several records share is ambiguous: the ref is
// dropped with a diagnostic naming the candidates — never a first-wins guess
// (CR-008). A table name minted twice is an error outright: `.from()` calls
// would be unattributable.
//
// Route choice: every matching route is ranked by how many url segments it
// matched literally, then by how few `*`s it had to take on a literal route
// segment (a guess), then single-segment parameters over catch-alls (fit()
// below). So `fetch('/api/things/*')` prefers `[id]` or `{id}` over a
// literal sibling, and `fetch('/api/things/mine')` prefers the literal.
// Routes tied for the best fit are ALL kept, with a diagnostic (CAS-65):
// `/users/${id}/${action}` refs every `/users/{id}/<verb>` it could be.
//
// Determinism: resolution is a pure function of the merged record set.

const afterKind = (id) => id.slice(id.indexOf(":") + 1);
const shortName = (id) => {
  const rest = afterKind(id);
  return rest.slice(rest.indexOf("/") + 1);
};

const isCatchAll = (s) => /^\[\.\.\..+\]$/.test(s) || /^\{[^}]+:path\}$/.test(s);
const isDynamic = (s) => /^\[.+\]$/.test(s) || /^\{.+\}$/.test(s);

// `[x]` / `{x}` / `*` eat one segment on either side; `[...x]` / `{x:path}`
// eat one or more — anywhere in the pattern, with the segments after it
// still required to match the url's tail (CAS-65 CR-033/034).
export function makeRouteMatcher(routePath) {
  const segs = routePath.split("/").filter(Boolean);
  const one = (s, u) => isDynamic(s) || s === "*" || u === "*" || s === u;
  const from = (i, uSegs, j) => {
    for (; i < segs.length; i++, j++) {
      if (isCatchAll(segs[i])) {
        const rest = segs.length - i - 1;
        // The catch-all takes 1..(remaining - rest) segments; with at most
        // a handful of segments per route the search is tiny.
        for (let take = uSegs.length - j - rest; take >= 1; take--) if (from(i + 1, uSegs, j + take)) return true;
        return false;
      }
      if (j >= uSegs.length || !one(segs[i], uSegs[j])) return false;
    }
    return j === uSegs.length;
  };
  return (url) => from(0, url.split("/").filter(Boolean), 0);
}

// How well a matching route fits a url, as a tuple compared in order:
// literal segments matched (more is better), then GUESSES — a `*` in the url
// standing on a literal route segment, a value the scan could not see (fewer
// is better; a `*` on a parameter is the natural fit), then whether a
// catch-all did the matching (a single-segment parameter is more specific).
function fit(routePath, url) {
  const segs = routePath.split("/").filter(Boolean);
  const uSegs = url.split("/").filter(Boolean);
  let literal = 0;
  let guesses = 0;
  let catchAll = 0;
  for (let i = 0; i < segs.length && i < uSegs.length; i++) {
    if (isCatchAll(segs[i])) {
      catchAll = 1;
      break;
    }
    if (isDynamic(segs[i])) continue;
    if (uSegs[i] === "*") guesses++;
    else if (segs[i] === uSegs[i]) literal++;
  }
  return [-literal, guesses, catchAll];
}
const compareFit = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function resolveRefs(records) {
  const diagnostics = [];
  // name -> [ids], both the short name and the namespace-qualified text.
  const index = { table: new Map(), bucket: new Map(), function: new Map() };
  const add = (map, key, id) => {
    const list = map.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    map.set(key, list);
  };
  for (const r of records) {
    const map = index[r.kind];
    if (!map) continue;
    const short = shortName(r.id);
    if (r.kind === "table" && map.has(short) && !map.get(short).includes(r.id)) {
      throw new Error(`Table '${short}' minted twice (${map.get(short)[0]} and ${r.id}) — cannot attribute .from() calls`);
    }
    add(map, short, r.id);
    const full = afterKind(r.id);
    if (full !== short) add(map, full, r.id);
  }
  const routes = records
    .filter((r) => r.kind === "route")
    .map((r) => ({ id: r.id, path: afterKind(r.id), match: makeRouteMatcher(afterKind(r.id)) }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const resolveOne = (ref, record) => {
    const where = record.resource[0] ?? record.id;
    const drop = (what) => {
      diagnostics.push(`[refs] ${where}: ${what} — dropped`);
      return null;
    };
    const colon = ref.indexOf(":");
    const kind = ref.slice(1, colon);
    const target = ref.slice(colon + 1);
    const lookup = (k, label) => {
      const hits = index[k].get(target);
      if (!hits) return undefined;
      if (hits.length > 1) return drop(`${label} '${target}' is ambiguous (${hits.join(", ")}) — qualify it with its namespace`);
      return hits[0];
    };
    switch (kind) {
      case "from": {
        const t = lookup("table", "from");
        if (t !== undefined) return t;
        const b = lookup("bucket", "from");
        return b !== undefined ? b : drop(`from('${target}') matches no known table or bucket`);
      }
      case "table":
      case "bucket":
      case "function": {
        const hit = lookup(kind, kind);
        return hit !== undefined ? hit : drop(`${kind} '${target}' matches no known ${kind}`);
      }
      case "route": {
        // Every route tied for the best fit is kept (CAS-65): with a `*` on
        // literal segments the scan cannot tell `/users/*/deactivate` from
        // `/users/*/reactivate`, and keeping one would hide the others from
        // anyone judging what a change touches. A fan-out is a diagnostic.
        let best = [];
        let bestFit = null;
        for (const rt of routes) {
          if (!rt.match(target)) continue;
          const f = fit(rt.path, target);
          const c = bestFit === null ? -1 : compareFit(f, bestFit);
          if (c < 0) {
            best = [rt.id];
            bestFit = f;
          } else if (c === 0) best.push(rt.id);
        }
        if (!best.length) return drop(`fetch('${target}') matches no route`);
        if (best.length > 1) diagnostics.push(`[refs] ${where}: fetch('${target}') fits ${best.length} routes equally well (${best.join(", ")}) — all kept`);
        return best;
      }
      default:
        throw new Error(`Record ${record.id}: unknown unresolved ref kind '${kind}' in '${ref}'`);
    }
  };

  for (const r of records) {
    const resolved = new Set();
    for (const ref of r.refs) {
      const hit = ref.startsWith("?") ? resolveOne(ref, r) : ref;
      for (const id of Array.isArray(hit) ? hit : [hit]) if (id && id !== r.id) resolved.add(id);
    }
    r.refs = [...resolved].sort();
  }
  // Prune to a fixed point: dropping a record strips the refs that pointed
  // at it, which can empty another `requireRefs` record, which must then be
  // dropped in turn (CR-065) — a single pass kept such a record with `refs: []`.
  // A queue over reverse edges: each drop is processed once, each edge
  // touched once — linear, where re-scanning every record per round was
  // quadratic on a long chain (CAS-65 CR-035).
  const byId = new Map(records.map((r) => [r.id, r]));
  const inbound = new Map(); // id -> ids of records that ref it
  for (const r of records) {
    for (const id of r.refs) {
      if (!inbound.has(id)) inbound.set(id, []);
      inbound.get(id).push(r.id);
    }
  }
  const live = new Map(records.map((r) => [r.id, new Set(r.refs)]));
  const dropped = new Set();
  const queue = records.filter((r) => r.requireRefs && !r.refs.length).map((r) => r.id);
  while (queue.length) {
    const id = queue.pop();
    if (dropped.has(id)) continue;
    dropped.add(id);
    for (const from of inbound.get(id) ?? []) {
      if (dropped.has(from)) continue;
      const refs = live.get(from);
      refs.delete(id);
      if (!refs.size && byId.get(from).requireRefs) queue.push(from);
    }
  }
  const kept = records.filter((r) => !dropped.has(r.id));
  for (const r of kept) if (dropped.size) r.refs = r.refs.filter((id) => !dropped.has(id));
  for (const r of kept) delete r.requireRefs;
  return { records: kept, diagnostics };
}
