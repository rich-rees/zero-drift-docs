// Post-merge ref resolution (src/lib/resolve-refs.mjs): every protocol kind,
// misses, self-refs, dedupe, requireRefs, ambiguity, route specificity.
// Review CR-008 / CR-009 / CR-015 / CR-023 (DIO-309 campaign).
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRefs } from "../src/lib/resolve-refs.mjs";

const rec = (kind, id, refs = [], extra = {}) => ({ kind, id, title: id, description: "", resource: [`${kind}.x`], refs, facts: {}, filename: "x.json", ...extra });

test("resolves every protocol kind; from prefers table over bucket; misses drop with a diagnostic", () => {
  const { records, diagnostics } = resolveRefs([
    rec("table", "table:db/things"),
    rec("bucket", "bucket:db/uploads"),
    rec("bucket", "bucket:db/things"),
    rec("function", "function:db/save"),
    rec("route", "route:/api/things"),
    rec("module", "module:a.ts", ["?from:things", "?from:uploads", "?table:things", "?bucket:uploads", "?function:save", "?route:/api/things", "?from:nope", "?function:nope", "?route:/api/nope"]),
  ]);
  const mod = records.find((r) => r.id === "module:a.ts");
  assert.deepEqual(mod.refs, ["bucket:db/uploads", "function:db/save", "route:/api/things", "table:db/things"]);
  assert.equal(diagnostics.length, 3);
  assert.match(diagnostics[0], /from\('nope'\) matches no known table or bucket — dropped/);
  assert.match(diagnostics[1], /function 'nope'/);
  assert.match(diagnostics[2], /fetch\('\/api\/nope'\) matches no route/);
});

test("self-refs drop silently; resolved and unresolved forms of one target dedupe; output is sorted", () => {
  const { records, diagnostics } = resolveRefs([
    rec("table", "table:db/b"),
    rec("table", "table:db/a", ["?table:a", "table:db/b", "?table:b", "?from:b"]),
  ]);
  assert.deepEqual(records.find((r) => r.id === "table:db/a").refs, ["table:db/b"]);
  assert.deepEqual(diagnostics, []);
});

test("requireRefs: dropped when nothing resolves, kept otherwise, and inbound refs to a dropped record are stripped (CR-009)", () => {
  const { records } = resolveRefs([
    rec("table", "table:db/t"),
    rec("module", "module:dead.ts", ["?from:nope"], { requireRefs: true }),
    rec("module", "module:live.ts", ["?from:t"], { requireRefs: true }),
    rec("route", "route:/x", ["module:dead.ts", "module:live.ts"]),
  ]);
  const ids = records.map((r) => r.id);
  assert.ok(!ids.includes("module:dead.ts"));
  assert.ok(ids.includes("module:live.ts"));
  assert.deepEqual(records.find((r) => r.id === "route:/x").refs, ["module:live.ts"]);
  assert.ok(!("requireRefs" in records.find((r) => r.id === "module:live.ts")));
});

test("CR-065: requireRefs pruning runs to a fixed point — a record kept only by a ref to a dropped record is dropped too, transitively", () => {
  // c -> b -> a -> (nothing resolvable). Single-pass pruning kept b and c
  // with empty refs; each round must re-check what the previous round emptied.
  const { records } = resolveRefs([
    rec("table", "table:db/t"),
    rec("module", "module:a.ts", ["?from:nope"], { requireRefs: true }),
    rec("module", "module:b.ts", ["module:a.ts"], { requireRefs: true }),
    rec("module", "module:c.ts", ["module:b.ts"], { requireRefs: true }),
    rec("module", "module:live.ts", ["module:c.ts", "?from:t"], { requireRefs: true }),
    rec("route", "route:/x", ["module:a.ts", "module:b.ts", "module:c.ts", "module:live.ts"]),
  ]);
  assert.deepEqual(records.map((r) => r.id).sort(), ["module:live.ts", "route:/x", "table:db/t"]);
  assert.deepEqual(records.find((r) => r.id === "module:live.ts").refs, ["table:db/t"]);
  assert.deepEqual(records.find((r) => r.id === "route:/x").refs, ["module:live.ts"]);
  for (const r of records) assert.ok(!("requireRefs" in r), `${r.id} flag removed`);
});

test("ambiguous function/bucket names drop with a diagnostic naming the candidates; namespace-qualified refs resolve (CR-008)", () => {
  const { records, diagnostics } = resolveRefs([
    rec("function", "function:env/set_updated_at"),
    rec("function", "function:media/set_updated_at"),
    rec("bucket", "bucket:env/assets"),
    rec("bucket", "bucket:media/assets"),
    rec("module", "module:m.ts", ["?function:set_updated_at", "?from:assets", "?function:media/set_updated_at", "?bucket:env/assets"]),
  ]);
  assert.deepEqual(records.find((r) => r.id === "module:m.ts").refs, ["bucket:env/assets", "function:media/set_updated_at"]);
  assert.equal(diagnostics.length, 2);
  assert.match(diagnostics[0], /ambiguous.*function:env\/set_updated_at.*function:media\/set_updated_at/);
  assert.match(diagnostics[1], /ambiguous/);
});

test("duplicate table names are an error, not a guess", () => {
  assert.throws(() => resolveRefs([rec("table", "table:a/t"), rec("table", "table:b/t")]), /Table 't' minted twice/);
});

test("ids without a namespace slash still resolve by name (CR-015)", () => {
  const { records } = resolveRefs([rec("table", "table:users"), rec("module", "module:m", ["?from:users", "?table:users"])]);
  assert.deepEqual(records.find((r) => r.id === "module:m").refs, ["table:users"]);
});

test("route resolution: most literal segments win; a wildcard prefers a parameter to a literal; catch-alls", () => {
  const { records } = resolveRefs([
    rec("route", "route:/api/things/[id]"),
    rec("route", "route:/api/things/mine"),
    rec("route", "route:/api/files/[...path]"),
    rec("route", "route:/jobs/{id}"),
    rec("route", "route:/b/[x]"),
    rec("route", "route:/a/[x]"),
    rec("module", "module:m", ["?route:/api/things/mine", "?route:/api/things/*", "?route:/api/files/a/b", "?route:/jobs/*"]),
    rec("module", "module:n", ["?route:/a/*"]),
  ]);
  assert.deepEqual(records.find((r) => r.id === "module:m").refs, ["route:/api/files/[...path]", "route:/api/things/[id]", "route:/api/things/mine", "route:/jobs/{id}"]);
  assert.deepEqual(records.find((r) => r.id === "module:n").refs, ["route:/a/[x]"]);
});

test("CAS-65: a wildcard facing a parameter beats one facing a literal, whatever the parameter spelling sorts like", () => {
  const { records } = resolveRefs([
    rec("route", "route:/things/mine"),
    rec("route", "route:/things/{id}"), // `{` sorts after letters: id order used to pick `mine`
    rec("route", "route:/stuff/mine"),
    rec("route", "route:/stuff/[id]"),
    rec("route", "route:/files/[id]"),
    rec("route", "route:/files/[...path]"),
    rec("module", "module:m", ["?route:/things/*", "?route:/stuff/*", "?route:/files/*"]),
  ]);
  assert.deepEqual(records.find((r) => r.id === "module:m").refs, ["route:/files/[id]", "route:/stuff/[id]", "route:/things/{id}"]);
});

test("decision 0019 (supersedes CAS-65's fan-out in part): a `*` never stands on a fixed word — `/users/*/*` reaches no `/users/{id}/<verb>` route; the call is recorded as unplaced, with a diagnostic naming the fix; a `*` on a parameter still resolves", () => {
  const { records, diagnostics } = resolveRefs([
    rec("route", "route:/users/{user_id}"),
    rec("route", "route:/users/{user_id}/deactivate"),
    rec("route", "route:/users/{user_id}/reactivate"),
    rec("route", "route:/users/{user_id}/resend-invitation"),
    rec("route", "route:/users/invite"),
    rec("route", "route:/health"),
    rec("surface", "surface:/admin/users", ["?route:/users/*/*", "?route:/users/invite", "?route:/users/*", "?route:/*"]),
  ]);
  const s = records.find((r) => r.id === "surface:/admin/users");
  assert.deepEqual(s.refs, ["route:/users/invite", "route:/users/{user_id}"]);
  assert.deepEqual(s.facts.unplaced, ["/*", "/users/*/*"], "sorted; `/*` no longer reaches /health, `/users/*/*` no longer reaches every verb");
  assert.equal(diagnostics.length, 2);
  assert.match(diagnostics[0], /fetch\('\/users\/\*\/\*'\) matches no route — a variable segment matches only a route parameter; type it as a union of literals, or declare the route — dropped/);
  assert.match(diagnostics[1], /fetch\('\/\*'\) matches no route/);
  // A literal miss is a plain drop, not an unplaced call — unchanged bytes for every adopter.
  const r2 = resolveRefs([rec("route", "route:/a"), rec("surface", "surface:/x", ["?route:/nope"])]);
  assert.equal(r2.records.find((r) => r.id === "surface:/x").facts.unplaced, undefined);
});

test("CAS-65: a tie among PARAMETER routes still fans out with a diagnostic", () => {
  const { records, diagnostics } = resolveRefs([
    rec("route", "route:/things/{id}"),
    rec("route", "route:/things/[id]"),
    rec("module", "module:m", ["?route:/things/*"]),
  ]);
  assert.deepEqual(records.find((r) => r.id === "module:m").refs, ["route:/things/[id]", "route:/things/{id}"]);
  assert.match(diagnostics[0], /fits 2 routes equally well/);
});

test("CAS-65 CR-033/034: a route-side `*` is one segment; a catch-all in the middle must still match the segments after it", async () => {
  const { makeRouteMatcher } = await import("../src/lib/resolve-refs.mjs");
  assert.equal(makeRouteMatcher("/files/*")("/files/a"), true);
  assert.equal(makeRouteMatcher("/files/*")("/files/a/b"), false);
  const mid = makeRouteMatcher("/a/{p:path}/admin");
  assert.equal(mid("/a/x"), false, "the suffix is required");
  assert.equal(mid("/a/x/admin"), true);
  assert.equal(mid("/a/x/y/admin"), true);
  assert.equal(mid("/a/admin"), false, "a catch-all eats at least one segment");
  assert.equal(makeRouteMatcher("/api/files/[...path]")("/api/files/a/b"), true, "a trailing catch-all is unchanged");
});

test("CAS-65 CR-044: many catch-alls against a non-matching url stay polynomial", async () => {
  const { makeRouteMatcher } = await import("../src/lib/resolve-refs.mjs");
  // Consecutive catch-alls then a literal that never matches: plain
  // backtracking tries every way to split the url among them.
  const pattern = "/" + Array.from({ length: 12 }, (_, i) => `[...p${i}]`).join("/") + "/z";
  const url = "/" + Array.from({ length: 30 }, (_, i) => `s${i}`).join("/");
  const started = Date.now();
  assert.equal(makeRouteMatcher(pattern)(url), false);
  assert.ok(Date.now() - started < 1000, `matching took ${Date.now() - started} ms`);
  assert.equal(makeRouteMatcher("/[...a]/x/[...b]/y")("/1/2/x/3/y"), true, "still matches when it should");
});

test("CAS-65 CR-035: requireRefs pruning is linear — a long chain whose tail drops unwinds in one pass, same result as before", () => {
  const N = 20000;
  const records = [rec("module", "module:0", ["?from:nope"], { requireRefs: true })];
  for (let i = 1; i < N; i++) records.push(rec("module", `module:${i}`, [`module:${i - 1}`], { requireRefs: true }));
  records.push(rec("module", "module:keeper", [`module:${N - 1}`, "?route:/x"]));
  records.push(rec("route", "route:/x"));
  const started = process.hrtime.bigint();
  const { records: kept } = resolveRefs(records);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.deepEqual(kept.map((r) => r.id).sort(), ["module:keeper", "route:/x"]);
  assert.deepEqual(kept.find((r) => r.id === "module:keeper").refs, ["route:/x"]);
  assert.ok(ms < 2000, `pruning took ${ms} ms`);
});

test("unknown unresolved kind is an error", () => {
  assert.throws(() => resolveRefs([rec("module", "module:m", ["?widget:x"])]), /unknown unresolved ref kind 'widget'/);
});
