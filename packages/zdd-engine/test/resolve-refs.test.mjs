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

test("route resolution: most literal segments win, ties break by id; wildcards and catch-alls", () => {
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

test("unknown unresolved kind is an error", () => {
  assert.throws(() => resolveRefs([rec("module", "module:m", ["?widget:x"])]), /unknown unresolved ref kind 'widget'/);
});
