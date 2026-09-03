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
// "module" record (a file that references something) keeps its old meaning.
//
//   ?from:<name>      a table, else a bucket — the supabase-client `.from()`
//                     / `.table()` receiver ambiguity, resolved by name-set
//                     membership exactly as before
//   ?table:<name>     a table by name
//   ?bucket:<name>    a bucket by name
//   ?function:<name>  a database function by name
//   ?route:<url>      the route whose path pattern matches <url>; `*` in the
//                     url is one wildcard segment; the most specific pattern
//                     (most literal segments) wins, ties by id
//
// Determinism: resolution is a pure function of the merged record set. Name
// indexes are first-wins in merge order (extractor order from config, records
// as the extractor emitted them); a table name minted twice is an error, not
// a guess — `.from()` calls would be unattributable.

const nameOf = (id) => id.slice(id.indexOf("/") + 1);

// `[x]` / `{x}` / `*` eat one segment; `[...x]` / `{x:path}` eat 1+ trailing.
export function makeRouteMatcher(routePath) {
  const segs = routePath.split("/").filter(Boolean);
  const isCatchAll = (s) => /^\[\.\.\..+\]$/.test(s) || /^\{[^}]+:path\}$/.test(s);
  const isDynamic = (s) => /^\[.+\]$/.test(s) || /^\{.+\}$/.test(s);
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

export function resolveRefs(records) {
  const diagnostics = [];
  const byName = { table: new Map(), bucket: new Map(), function: new Map() };
  for (const r of records) {
    const index = byName[r.kind];
    if (!index) continue;
    const name = nameOf(r.id);
    if (r.kind === "table" && index.has(name) && index.get(name) !== r.id) {
      throw new Error(`Table '${name}' minted twice (${index.get(name)} and ${r.id}) — cannot attribute .from() calls`);
    }
    if (!index.has(name)) index.set(name, r.id);
  }
  const literalCount = (id) => id.split("/").filter((s) => s && !/^[\[{*]/.test(s)).length;
  const routes = records
    .filter((r) => r.kind === "route")
    .map((r) => ({ id: r.id, match: makeRouteMatcher(r.id.slice("route:".length)), literals: literalCount(r.id) }))
    .sort((a, b) => b.literals - a.literals || (a.id < b.id ? -1 : 1));

  const resolveOne = (ref, record) => {
    const where = record.resource[0] ?? record.id;
    const drop = (what) => {
      diagnostics.push(`[refs] ${where}: ${what} — dropped`);
      return null;
    };
    const colon = ref.indexOf(":");
    const kind = ref.slice(1, colon);
    const target = ref.slice(colon + 1);
    switch (kind) {
      case "from":
        return byName.table.get(target) ?? byName.bucket.get(target) ?? drop(`from('${target}') matches no known table or bucket`);
      case "table":
      case "bucket":
      case "function":
        return byName[kind].get(target) ?? drop(`${kind} '${target}' matches no known ${kind}`);
      case "route": {
        const hit = routes.find((rt) => rt.match(target));
        return hit ? hit.id : drop(`fetch('${target}') matches no route`);
      }
      default:
        throw new Error(`Record ${record.id}: unknown unresolved ref kind '${kind}' in '${ref}'`);
    }
  };

  const kept = [];
  for (const r of records) {
    const resolved = new Set();
    for (const ref of r.refs) {
      const id = ref.startsWith("?") ? resolveOne(ref, r) : ref;
      if (id && id !== r.id) resolved.add(id);
    }
    r.refs = [...resolved].sort();
    if (r.requireRefs && !r.refs.length) continue;
    delete r.requireRefs;
    kept.push(r);
  }
  return { records: kept, diagnostics };
}
