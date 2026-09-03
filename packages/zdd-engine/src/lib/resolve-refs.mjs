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
// Route choice: every matching route is scored by how many url segments it
// matched literally (not through `*` or a dynamic segment); highest wins,
// ties by id. So `fetch('/api/things/*')` prefers `[id]` over a literal
// sibling, and `fetch('/api/things/mine')` prefers the literal.
//
// Determinism: resolution is a pure function of the merged record set.

const afterKind = (id) => id.slice(id.indexOf(":") + 1);
const shortName = (id) => {
  const rest = afterKind(id);
  return rest.slice(rest.indexOf("/") + 1);
};

const isCatchAll = (s) => /^\[\.\.\..+\]$/.test(s) || /^\{[^}]+:path\}$/.test(s);
const isDynamic = (s) => /^\[.+\]$/.test(s) || /^\{.+\}$/.test(s);

// `[x]` / `{x}` / `*` eat one segment; `[...x]` / `{x:path}` eat 1+ trailing.
export function makeRouteMatcher(routePath) {
  const segs = routePath.split("/").filter(Boolean);
  return (url) => {
    const uSegs = url.split("/").filter(Boolean);
    let i = 0;
    for (; i < segs.length; i++) {
      const s = segs[i];
      if (isCatchAll(s)) return uSegs.length - i >= 1;
      if (uSegs.length <= i) return false;
      if (isDynamic(s)) continue;
      if (s !== uSegs[i] && uSegs[i] !== "*") return false;
    }
    return uSegs.length === segs.length;
  };
}

function literalMatches(routePath, url) {
  const segs = routePath.split("/").filter(Boolean);
  const uSegs = url.split("/").filter(Boolean);
  let n = 0;
  for (let i = 0; i < segs.length && i < uSegs.length; i++) {
    if (!isDynamic(segs[i]) && segs[i] === uSegs[i]) n++;
  }
  return n;
}

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
        let best = null;
        let bestScore = -1;
        for (const rt of routes) {
          if (!rt.match(target)) continue;
          const score = literalMatches(rt.path, target);
          if (score > bestScore) {
            best = rt;
            bestScore = score;
          }
        }
        return best ? best.id : drop(`fetch('${target}') matches no route`);
      }
      default:
        throw new Error(`Record ${record.id}: unknown unresolved ref kind '${kind}' in '${ref}'`);
    }
  };

  const kept = [];
  const dropped = new Set();
  for (const r of records) {
    const resolved = new Set();
    for (const ref of r.refs) {
      const id = ref.startsWith("?") ? resolveOne(ref, r) : ref;
      if (id && id !== r.id) resolved.add(id);
    }
    r.refs = [...resolved].sort();
    if (r.requireRefs && !r.refs.length) {
      dropped.add(r.id);
      continue;
    }
    delete r.requireRefs;
    kept.push(r);
  }
  if (dropped.size) for (const r of kept) r.refs = r.refs.filter((id) => !dropped.has(id));
  return { records: kept, diagnostics };
}
