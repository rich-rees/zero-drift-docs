// Post-merge ref resolution. Extractors are composed by config and cannot see
// each other's records, so a route whose handler reads table `things` cannot
// know the table's id (`table:db/things`) — that id is minted by the adapter
// that reads the schema. The contract: an extractor emits a resolved id when it minted
// the target itself, and an UNRESOLVED ref — a string starting with `?` —
// when the target belongs to whichever extractor owns that convention. After
// all extractors have run, this pass resolves the `?` refs against the merged
// record set. Misses are dropped with a diagnostic (the same honesty the
// monolithic adapter had), self-refs are dropped silently, and a record
// flagged `requireRefs` is dropped when nothing resolved — that flag is how a
// "module" record (a file that references something) keeps its old meaning;
// refs pointing at a dropped record are stripped too (CR-009).
//
//   ?from:<name>      a table, else a bucket — for a client call whose
//                     receiver could be either, resolved by name-set
//                     membership exactly as before
//   ?table:<name>     a table by name
//   ?bucket:<name>    a bucket by name
//   ?function:<name>  a database function by name
//   ?route:<url>      the route whose path pattern matches <url>; `*` in the
//                     url is one segment the scan could not read, and it
//                     matches only a route PARAMETER (`{id}`, `[id]`, a
//                     catch-all), never a fixed word (decision 0019). A url
//                     with a `*` that matches nothing is recorded on the
//                     record as `facts.unplaced`, so lint can name it
//   ?at:<file>        every record of any kind whose resource list holds
//                     <file> — how a service names the routes, surfaces and
//                     jobs in the files that use it (2.1.0); a file that is
//                     nobody's resource is a plain drop
//   ?surface:<file>   every surface whose resource list holds <file> — how
//                     a component names the screens that import it (2.1.0);
//                     a file that is the element of several routes is all
//                     of them, silently
//   ?code:<file>#<fn> every data-access record for function <fn> in <file>
//                     (decision 0037): how a route or screen names the code
//                     it runs — its own handler, and the functions it calls —
//                     without knowing how that code reaches the database. A
//                     miss is silent: most functions touch no database
//
// Data access, after resolution (decision 0037). A `data-access` record is
// one function that touches the database, minted by a data-access adapter
// with refs to the tables, buckets and functions it reaches. A record that
// reaches one through `?code:` takes its refs and typed edges as its own
// (the route → table edge). A data-access record whose every referrer holds
// its file — a handler's own body — is ABSORBED: its refs live on the
// referrer and the record itself goes, so inline data access reads exactly
// as it did before data access was its own adapter. One that some referrer
// reaches across files (a repository function) stays in the graph as its
// own node, linked from each caller. One hop: a data-access record's own
// `?code:` refs are not followed. Then requireRefs pruning runs as before.
//
// <name> is the id's text after its `kind:` prefix, or after the namespace
// slash when the id is namespaced (`table:db/things` -> `things`); a
// namespace-qualified lookup (`?function:db/save`) matches the full text. An
// UNQUALIFIED name that several records share is ambiguous: the ref is
// dropped with a diagnostic naming the candidates — never a first-wins guess
// (CR-008). A table name minted twice is an error outright: `.from()` calls
// would be unattributable. A table minted in the default schema
// (`table:db/public.things`) is also found by its bare name (`things`), so
// `.from('things')` and `?table:public.things` both reach it (2.1.1).
//
// Route choice: every matching route is ranked by how many url segments it
// matched literally, then single-segment parameters over catch-alls (fit()
// below). So `fetch('/api/things/mine')` prefers the literal over `[id]`.
// Routes tied for the best fit are ALL kept, with a diagnostic (1.3.0):
// `/users/${id}` matches both `/users/{id}` and `/users/[id]` if a bundle
// had both. A `*` never stands on a fixed word (decision 0019): before, it
// did, ranked lower, and `/${plural}` reached `/health` through it.
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
// still required to match the url's tail (1.3.0 CR-033/034).
export function makeRouteMatcher(routePath) {
  const segs = routePath.split("/").filter(Boolean);
  const one = (s, u) => isDynamic(s) || s === "*" || (u === "*" ? false : s === u);
  return (url) => {
    const uSegs = url.split("/").filter(Boolean);
    // (pattern index, url index) pairs already known to fail: each pair is
    // tried once, so several catch-alls cost segs × url steps, never the
    // combinatorial partitions of plain backtracking (1.3.0 CR-044).
    const failed = new Set();
    const from = (i, j) => {
      const key = i * (uSegs.length + 1) + j;
      if (failed.has(key)) return false;
      for (; i < segs.length; i++, j++) {
        if (isCatchAll(segs[i])) {
          const rest = segs.length - i - 1;
          for (let take = uSegs.length - j - rest; take >= 1; take--) if (from(i + 1, j + take)) return true;
          failed.add(key);
          return false;
        }
        if (j >= uSegs.length || !one(segs[i], uSegs[j])) {
          failed.add(key);
          return false;
        }
      }
      if (j === uSegs.length) return true;
      failed.add(key);
      return false;
    };
    return from(0, 0);
  };
}

// How well a matching route fits a url, as a tuple compared in order:
// literal segments matched (more is better), then whether a catch-all did
// the matching (a single-segment parameter is more specific).
function fit(routePath, url) {
  const segs = routePath.split("/").filter(Boolean);
  const uSegs = url.split("/").filter(Boolean);
  let literal = 0;
  let catchAll = 0;
  for (let i = 0; i < segs.length && i < uSegs.length; i++) {
    if (isCatchAll(segs[i])) {
      catchAll = 1;
      break;
    }
    if (isDynamic(segs[i])) continue;
    if (segs[i] === uSegs[i]) literal++;
  }
  return [-literal, catchAll];
}
const compareFit = (a, b) => a[0] - b[0] || a[1] - b[1];

export function resolveRefs(records) {
  const diagnostics = [];
  const warnings = [];
  let codeRefs = 0;
  // name -> [ids], both the short name and the namespace-qualified text.
  const index = { table: new Map(), bucket: new Map(), function: new Map() };
  const add = (map, key, id) => {
    const list = map.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    map.set(key, list);
  };
  const minted = new Map(); // a table's exact short name -> its id
  for (const r of records) {
    const map = index[r.kind];
    if (!map) continue;
    const short = shortName(r.id);
    if (r.kind === "table") {
      if (minted.has(short) && minted.get(short) !== r.id) {
        throw new Error(`Table '${short}' minted twice (${minted.get(short)} and ${r.id}) — cannot attribute .from() calls`);
      }
      minted.set(short, r.id);
    }
    add(map, short, r.id);
    const full = afterKind(r.id);
    if (full !== short) add(map, full, r.id);
    // A table the migrations named in the default schema
    // (`public.audit_events`) answers to its bare name too, as the database
    // resolves it: a client call names the table alone (2.1.1). Another
    // schema's table never does, and a function keeps its exact names (CR-007).
    if (r.kind === "table" && short.startsWith("public.")) add(map, short.slice("public.".length), r.id);
  }
  const surfacesByFile = new Map();
  const recordsByFile = new Map();
  for (const r of records) {
    for (const f of r.resource) {
      // A service's resource is the file that declares it, not a file that
      // "uses" it: a service never resolves as another service's dependant.
      if (r.kind !== "external-service" && r.kind !== "service") {
        if (!recordsByFile.has(f)) recordsByFile.set(f, []);
        recordsByFile.get(f).push(r.id);
      }
      if (r.kind !== "surface") continue;
      if (!surfacesByFile.has(f)) surfacesByFile.set(f, []);
      surfacesByFile.get(f).push(r.id);
    }
  }
  const dataAccess = new Map(records.filter((r) => r.kind === "data-access").map((r) => [r.id, r]));
  // file#function -> the data-access ids for it: one per adapter that read it.
  const codeIndex = new Map();
  for (const d of dataAccess.values()) {
    const key = `${d.resource[0]}#${d.facts?.function}`;
    codeIndex.set(key, [...(codeIndex.get(key) ?? []), d.id].sort());
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
      if (hits.length > 1) return drop(`${label} '${target}' is ambiguous (${[...hits].sort().join(", ")}) — qualify it with its namespace`);
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
      case "surface": {
        const hits = surfacesByFile.get(target);
        return hits ? [...hits].sort() : drop(`surface at '${target}' matches no known surface`);
      }
      case "code":
        codeRefs++;
        return codeIndex.get(target) ?? null;
      case "at": {
        const hits = (recordsByFile.get(target) ?? []).filter((id) => id !== record.id);
        return hits.length ? [...hits].sort() : drop(`'${target}' is no record's resource`);
      }
      case "route": {
        // Every route tied for the best fit is kept (1.3.0): with a `*` on
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
        if (!best.length) {
          // A call the scan could not place because of a segment it could
          // not read is a fact about the record (decision 0019): lint names
          // it, where a verbose-only diagnostic would be read by nobody.
          if (target.includes("*")) {
            const list = record.facts.unplaced ?? (record.facts.unplaced = []);
            if (!list.includes(target)) list.push(target);
          }
          return drop(`fetch('${target}') matches no route${target.includes("*") ? " — a variable segment matches only a route parameter; type it as a union of literals, or declare the route" : ""}`);
        }
        if (best.length > 1) diagnostics.push(`[refs] ${where}: fetch('${target}') fits ${best.length} routes equally well (${best.join(", ")}) — all kept`);
        return best;
      }
      default:
        throw new Error(`Record ${record.id}: unknown unresolved ref kind '${kind}' in '${ref}'`);
    }
  };

  const resolveList = (list, r) => {
    const resolved = new Set();
    for (const ref of list) {
      const hit = ref.startsWith("?") ? resolveOne(ref, r) : ref;
      for (const id of Array.isArray(hit) ? hit : [hit]) if (id && id !== r.id) resolved.add(id);
    }
    return resolved;
  };
  for (const r of records) {
    const resolved = resolveList(r.refs, r);
    // Typed edges (decision 0016): `facts.edges` maps a verb to the refs it
    // covers, resolved the same way; every id it names is also a plain ref,
    // so every consumer of `refs` keeps working. Verbs and ids come out
    // sorted; an empty verb is dropped, and an empty map is removed.
    const edges = r.facts && r.facts.edges && typeof r.facts.edges === "object" && !Array.isArray(r.facts.edges) ? r.facts.edges : null;
    if (edges) {
      const out = {};
      for (const verb of Object.keys(edges).sort()) {
        const ids = resolveList(Array.isArray(edges[verb]) ? edges[verb] : [], r);
        for (const id of ids) resolved.add(id);
        if (ids.size) out[verb] = [...ids].sort();
      }
      if (Object.keys(out).length) r.facts.edges = out;
      else delete r.facts.edges;
    }
    r.refs = [...resolved].sort();
    if (r.facts.unplaced) r.facts.unplaced.sort();
  }
  // A schema, routes that name the code they run, and no adapter that reads
  // how code reaches the database: every route -> table edge is silently gone.
  // Say so on every derive (CR-013). An app with no tables is not warned.
  if (codeRefs && !dataAccess.size && index.table.size) {
    warnings.push(`${codeRefs} ref${codeRefs === 1 ? "" : "s"} name the code a route or screen runs (?code:) and the schema has tables, but no data-access adapter is configured, so no route links to a table — add the adapter for your database layer to "extractors" (see the catalogue in README, "What ZDD reads"), or your own`);
  }
  // Fold and absorb data access (decision 0037; see the head of this file).
  // The data-access records' own refs are final here: every record was
  // resolved above, and a data-access record is never folded into another.
  if (dataAccess.size) {
    const referrers = new Map(); // data-access id -> records that reach it
    for (const r of records) {
      if (r.kind === "data-access") continue;
      const reached = r.refs.filter((id) => dataAccess.has(id));
      if (!reached.length) continue;
      const refs = new Set(r.refs);
      for (const id of reached) {
        (referrers.get(id) ?? referrers.set(id, []).get(id)).push(r);
        const d = dataAccess.get(id);
        for (const t of d.refs) if (t !== r.id && !dataAccess.has(t)) refs.add(t);
        const dEdges = d.facts?.edges;
        if (!dEdges) continue;
        const edges = (r.facts.edges ??= {});
        for (const [verb, ids] of Object.entries(dEdges)) {
          const keep = ids.filter((t) => t !== r.id && !dataAccess.has(t));
          if (keep.length) edges[verb] = [...new Set([...(edges[verb] ?? []), ...keep])].sort();
        }
        if (Object.keys(edges).length) r.facts.edges = Object.fromEntries(Object.keys(edges).sort().map((v) => [v, edges[v]]));
        else delete r.facts.edges;
      }
      r.refs = [...refs].sort();
    }
    const absorbed = new Set();
    for (const [id, from] of referrers) {
      const file = dataAccess.get(id).resource[0];
      if (from.every((r) => r.resource.includes(file))) absorbed.add(id);
    }
    if (absorbed.size) {
      for (const r of records) {
        r.refs = r.refs.filter((id) => !absorbed.has(id));
        if (!r.facts?.edges) continue;
        for (const verb of Object.keys(r.facts.edges)) {
          r.facts.edges[verb] = r.facts.edges[verb].filter((id) => !absorbed.has(id));
          if (!r.facts.edges[verb].length) delete r.facts.edges[verb];
        }
        if (!Object.keys(r.facts.edges).length) delete r.facts.edges;
      }
      for (let i = records.length - 1; i >= 0; i--) if (absorbed.has(records[i].id)) records.splice(i, 1);
    }
  }
  // Prune to a fixed point: dropping a record strips the refs that pointed
  // at it, which can empty another `requireRefs` record, which must then be
  // dropped in turn (CR-065) — a single pass kept such a record with `refs: []`.
  // A queue over reverse edges: each drop is processed once, each edge
  // touched once — linear, where re-scanning every record per round was
  // quadratic on a long chain (1.3.0 CR-035).
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
  for (const r of kept) {
    if (!dropped.size) break;
    r.refs = r.refs.filter((id) => !dropped.has(id));
    if (r.facts?.edges) {
      for (const verb of Object.keys(r.facts.edges)) {
        r.facts.edges[verb] = r.facts.edges[verb].filter((id) => !dropped.has(id));
        if (!r.facts.edges[verb].length) delete r.facts.edges[verb];
      }
      if (!Object.keys(r.facts.edges).length) delete r.facts.edges;
    }
  }
  for (const r of kept) delete r.requireRefs;
  return { records: kept, diagnostics, warnings };
}
