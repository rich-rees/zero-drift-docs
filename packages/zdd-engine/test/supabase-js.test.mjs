// supabase-js (decision 0037, ZDD-3 slice 2b): the Supabase JavaScript client's
// calls are their own adapter's, one data-access record per code unit (a
// top-level declaration by name, the module's own top-level code as
// `<module>`), closed over the same-file declarations a unit mentions. The
// route and screen adapters name the code they run (`?code:<file>#<unit>`,
// `#*` for a whole file) and the core folds what it reaches: inline data
// access is absorbed, a one-hop module's stays its own node, and a verb the
// referrer gives the link (`reads`) carries to the refs the record leaves
// untyped. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { derive as supabaseJs, scanDataCalls, scanSubscriptions } from "../src/adapters/supabase-js/index.mjs";
import { derive as supabase } from "../src/adapters/supabase/index.mjs";
import { derive as reactRouter } from "../src/adapters/react-router/index.mjs";
import { derive as components } from "../src/adapters/components/index.mjs";
import { codeUnits, topLevel, narrowModule, MODULE_UNIT } from "../src/adapters/js/source.mjs";
import { closeOver } from "../src/core/lib/data-access.mjs";
import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";
import { resolveRefs } from "../src/core/lib/resolve-refs.mjs";

const scratch = (t, files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-sbjs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};
const run = (root, options = {}) => supabaseJs({ repoRoot: root, options, io: makeExtractorIo(root) });
const MIGRATION = "create table jobs (id uuid primary key);\ncreate table audit_events (id uuid primary key);\ncreate table authors (id uuid primary key);\n";
const db = (root) => supabase({ repoRoot: root, options: { migrationNamespaces: [{ name: "db", dir: "migrations" }] } }).records;

test("code units: a declaration by its local name, `export default function Foo` as Foo, an anonymous default as default, other top-level code as <module>; imports, types and export lists are none", () => {
  const text = [
    'import { x } from "./x";',
    "export type T = { a: string };",
    "export function load() { return 1; }",
    "export default function Page() { return null; }",
    "const helper = () => 2;",
    "boot();",
    "export { helper as h };",
    "",
  ].join("\n");
  assert.deepEqual(codeUnits(topLevel(text)), [null, null, "load", "Page", "helper", MODULE_UNIT, null]);
  assert.deepEqual(codeUnits(topLevel("export default () => 1;\n")), ["default"]);
});

test("one record per unit that makes a call, closed over the same-file declarations it mentions; a call in a comment or a string is none; a constant resolves .from(NAME)", (t) => {
  const root = scratch(t, {
    "src/data.ts": [
      "// The job list, newest first.",
      "export async function listJobs() {",
      "  return base().order('created_at');",
      "}",
      "function base() {",
      "  return supabase.from('jobs').select('*');",
      "}",
      "const BUCKET = 'avatars';",
      "export const avatar = (p) => supabase.storage.from(BUCKET).getPublicUrl(p);",
      "export function audit() {",
      "  // supabase.from('ghost_in_a_comment')",
      "  const s = \"supabase.rpc('ghost_in_a_string')\";",
      "  return supabase.rpc('record_audit');",
      "}",
      "export function quiet() { return 1; }",
      "warm();",
      "function warm() { return supabase.from('authors').select('id'); }",
      "",
    ].join("\n"),
  });
  const { records, diagnostics } = run(root, { roots: ["src"] });
  assert.deepEqual(diagnostics, []);
  const by = (fn) => records.find((r) => r.facts.function === fn);
  assert.deepEqual(records.map((r) => r.facts.function), ["<module>", "audit", "avatar", "base", "listJobs", "warm"], "quiet makes no call: no record");
  assert.deepEqual(by("listJobs").refs, ["?from:jobs"], "listJobs reaches base's call");
  assert.equal(by("listJobs").id, "data-access:supabase-js/src/data.ts#listJobs");
  assert.equal(by("listJobs").description, "The job list, newest first.");
  assert.deepEqual(by("avatar").refs, ["?from:avatars"]);
  assert.deepEqual(by("audit").refs, ["?function:record_audit"]);
  assert.deepEqual(by("<module>").refs, ["?from:authors"], "the module's top-level code reaches warm");
  assert.equal(by("<module>").filename, "supabase-js--src--data-ts--~3c~module~3e~.json");
  assert.ok(records.every((r) => r.requireRefs === true && r.kind === "data-access"));
});

test("Realtime: the client's own .on('postgres_changes', { table }) and a named helper are a subscribes edge on the unit that makes them; the old option on react-router warns", (t) => {
  const root = scratch(t, {
    "src/live.ts": 'export function watch() {\n  live.onInsert("audit_events", cb);\n  sb.channel("x").on("postgres_changes", { table: "jobs" }, cb);\n}\n',
  });
  const plain = run(root);
  assert.deepEqual(plain.records[0].facts.edges, { subscribes: ["?table:jobs"] });
  const named = run(root, { subscribeCalls: ["live.onInsert"] });
  assert.deepEqual(named.records[0].refs, ["?table:audit_events", "?table:jobs"]);
  assert.deepEqual(named.records[0].facts.edges, { subscribes: ["?table:audit_events", "?table:jobs"] });
  assert.throws(() => run(root, { roots: "src" }), /supabase-js: 'roots' must be an array of strings/);
});

test("roots: a missing root is nothing to inventory; test, spec and declaration files are skipped by default; node_modules is never entered", (t) => {
  const root = scratch(t, {
    "src/a.ts": "export const a = () => supabase.from('jobs');\n",
    "src/a.test.ts": "export const t = () => supabase.from('jobs');\n",
    "src/b.d.ts": "export declare const b: number;\n",
    "src/node_modules/pkg/index.js": "module.exports = () => supabase.from('jobs');\n",
  });
  const { records, diagnostics } = run(root, { roots: ["src", "nowhere"] });
  assert.deepEqual(records.map((r) => r.resource[0]), ["src/a.ts"]);
  assert.match(diagnostics.join("\n"), /nowhere not found — nothing to inventory/);
});

test("the join: a screen's own file is absorbed, a narrowed one-hop module's unit stays its own node, and ?code:<file>#* reaches every unit in the file", (t) => {
  const root = scratch(t, {
    "migrations/0001.sql": MIGRATION,
    "src/routes.tsx": 'import { Jobs } from "./Jobs";\nimport { Audit } from "./Audit";\nexport const routes = [{ path: "/jobs", element: <Jobs /> }, { path: "/audit", element: <Audit /> }];\n',
    "src/Jobs.tsx": 'import { listJobs } from "./data";\nexport function Jobs() { return <main>{String(listJobs())}</main>; }\n',
    "src/Audit.tsx": 'export function Audit() { supabase.from("audit_events").select(); return <main />; }\n',
    "src/data.ts": "export function listJobs() { return supabase.from('jobs').select(); }\nexport function authors() { return supabase.from('authors').select(); }\n",
  });
  const web = reactRouter({ repoRoot: root, options: { routesFile: "src/routes.tsx" } });
  const { records } = resolveRefs([...db(root), ...web.records, ...run(root).records]);
  const by = (id) => records.find((r) => r.id === id);
  assert.deepEqual(by("surface:/audit").refs, ["table:db/audit_events"], "inline: the screen's own body");
  assert.ok(!by("data-access:supabase-js/src/Audit.tsx#Audit"), "absorbed into the screen that holds its file");
  assert.deepEqual(by("surface:/jobs").refs, ["data-access:supabase-js/src/data.ts#listJobs", "table:db/jobs"], "a one-hop module's unit: a node, and the table");
  assert.ok(by("data-access:supabase-js/src/data.ts#listJobs"));
  assert.ok(!by("surface:/jobs").refs.includes("table:db/authors"), "narrowed: authors is not imported");
});

test("the verb rule: a component's reads: [?code:…] gives `reads` to the tables the record leaves untyped, and keeps its own edge order; a typed edge (subscribes) comes as it is", (t) => {
  const root = scratch(t, {
    "migrations/0001.sql": MIGRATION,
    "src/components/JobBadge.tsx": 'export function JobBadge() {\n  supabase.from("jobs").select();\n  live.onInsert("audit_events", cb);\n  return <span />;\n}\n',
  });
  const ui = components({ repoRoot: root, options: { roots: ["src"] }, io: makeExtractorIo(root) });
  assert.deepEqual(Object.keys(ui.records[0].facts.edges), ["reads"]);
  const { records } = resolveRefs([...db(root), ...ui.records, ...run(root, { subscribeCalls: ["live.onInsert"] }).records]);
  const badge = records.find((r) => r.kind === "component");
  assert.deepEqual(badge.facts.edges, { reads: ["table:db/jobs"], subscribes: ["table:db/audit_events"] });
  assert.deepEqual(Object.keys(badge.facts.edges), ["reads", "subscribes"], "the referrer's verb first, a new one after it");
  assert.deepEqual(badge.refs, ["table:db/audit_events", "table:db/jobs"]);
  assert.ok(!records.some((r) => r.kind === "data-access"));
});

test("a typed edge from the data-access record is never doubled into the referrer's verb: sqlalchemy-shaped reads/writes stay as they are", () => {
  const job = { kind: "job", id: "job:sweep", title: "sweep", resource: ["app/sweep.py"], refs: ["?code:app/sweep.py#*"], facts: { mode: "worker", edges: { reads: ["?code:app/sweep.py#*"] } }, filename: "sweep.json" };
  const table = (n) => ({ kind: "table", id: `table:db/${n}`, title: n, resource: ["m.sql"], refs: [], facts: {}, filename: `db--${n}.json` });
  const da = { kind: "data-access", id: "data-access:sqlalchemy/app/sweep.py#run", title: "run", resource: ["app/sweep.py"], refs: ["?table:audit_events", "?table:jobs"], facts: { function: "run", edges: { reads: ["?table:jobs"], writes: ["?table:audit_events", "?table:jobs"] } }, filename: "x.json", requireRefs: true };
  const { records } = resolveRefs([table("jobs"), table("audit_events"), job, da]);
  const sweep = records.find((r) => r.id === "job:sweep");
  assert.deepEqual(sweep.facts.edges, { reads: ["table:db/jobs"], writes: ["table:db/audit_events", "table:db/jobs"] });
});

test("?at: never lands on a data-access record — an external service's usedBy does not fold a file's tables into itself", () => {
  const svc = { kind: "external-service", id: "external-service:resend", title: "Resend", resource: ["package.json"], refs: ["?at:src/mail.ts"], facts: { edges: { usedBy: ["?at:src/mail.ts"] } }, filename: "resend.json" };
  const mod = { kind: "module", id: "module:src/mail.ts", title: "src/mail.ts", resource: ["src/mail.ts"], refs: ["?code:src/mail.ts#*"], facts: {}, filename: "m.json", requireRefs: true };
  const da = { kind: "data-access", id: "data-access:supabase-js/src/mail.ts#send", title: "send", resource: ["src/mail.ts"], refs: ["?from:jobs"], facts: { function: "send" }, filename: "d.json", requireRefs: true };
  const t = { kind: "table", id: "table:db/jobs", title: "jobs", resource: ["m.sql"], refs: [], facts: {}, filename: "db--jobs.json" };
  const { records } = resolveRefs([t, svc, mod, da]);
  assert.deepEqual(records.find((r) => r.id === "external-service:resend").facts.edges, { usedBy: ["module:src/mail.ts"] });
  assert.deepEqual(records.find((r) => r.id === "module:src/mail.ts").refs, ["table:db/jobs"]);
});

test("scanDataCalls: .from(NAME) unresolvable file-locally is named; a class's static Array.from(xs) is not a client call", () => {
  assert.deepEqual([...scanDataCalls("db.from(tableVar).select();\nArray.from(rows);\nBuffer.from(x);\n").unresolved], ["tableVar"]);
});

// ---- slice 2b campaign (CR-045 to CR-074, D-1) -----------------------------

test("CR-046/047/061: an ambient `declare` and `export default interface` are no unit and reach nothing; `export default abstract class Store` is Store; every declarator and destructured name is declared, one unit per statement", () => {
  const mod = topLevel([
    "function helper() { return supabase.from('jobs'); }",
    "export declare const alias: typeof helper;",
    "export default interface Shape { v: ReturnType<typeof helper> }",
    "export const loadA = () => db.from('a'),",
    "             loadB = () => db.from('b');",
    "export const { c, d: e, f = pick(x, y), ...g } = obj;",
    "const m: Map<string, number> = new Map();",
    "",
  ].join("\n"));
  assert.deepEqual(codeUnits(mod), ["helper", null, null, "loadA", "c", "m"]);
  assert.deepEqual(mod.statements.map((s) => s.kind), ["decl", "type", "type", "decl", "decl", "decl"]);
  assert.deepEqual(mod.statements[1].mentions, new Set(), "an erased declaration runs nothing, so it reaches nothing");
  for (const n of ["alias", "loadB", "e", "g"]) assert.ok(mod.decls.has(n), n);
  for (const n of ["d", "x", "y", "pick", "number"]) assert.ok(!mod.decls.has(n), `${n} is a key, a default's name or a type, never a binding`);
  assert.deepEqual(codeUnits(topLevel("export default abstract class Store { load() { return 1; } }\n")), ["Store"]);
  assert.equal(narrowModule(mod, ["loadB"]).whole, undefined, "a second declarator narrows, never 'declares no such name'");
});

test("CR-052/053/055/060: a capitalised static receiver is no client call; a unit's own const shadows another unit's; a schema-qualified constant resolves; `table:` counts only as the filter object's own key", (t) => {
  assert.deepEqual([...scanDataCalls('Array.from("admin_users"); Buffer.from("jobs"); Registry.rpc("drop_tenant"); supabase.from("jobs"); admin().from("x");').from].sort(), ["jobs", "x"]);
  assert.deepEqual([...scanDataCalls('Registry.rpc("drop_tenant"); supabase.rpc("ok");').rpc], ["ok"]);
  assert.deepEqual([...scanSubscriptions('channel.on("postgres_changes", {}, () => { const metadata = { table: "admin_users" }; });')], []);
  assert.deepEqual([...scanSubscriptions('sb.on("postgres_changes", { filter: { table: "nested" }, table: "jobs" }, cb);')], ["jobs"]);
  const root = scratch(t, {
    "src/a.ts": [
      'const TABLE = "public.jobs";',
      "export function one() { return supabase.from(TABLE); }",
      'function unrelated() { const OTHER = "admin"; return OTHER; }',
      "export function two() { return supabase.from(OTHER); }",
      'export function three() { const OTHER = "authors"; return supabase.from(OTHER); }',
      "",
    ].join("\n"),
  });
  const { records, diagnostics } = run(root);
  const by = (fn) => records.find((r) => r.facts.function === fn);
  assert.deepEqual(by("one").refs, ["?from:public.jobs"]);
  assert.equal(by("two"), undefined, "another function's local const resolves nothing here");
  assert.deepEqual(by("three").refs, ["?from:authors"]);
  assert.match(diagnostics.join("\n"), /src\/a\.ts: \.from\(OTHER\) — identifier not resolvable file-locally/);
});

test("CR-054: a parameter or a local that shadows a top-level declaration is not a call to it", (t) => {
  const root = scratch(t, {
    "src/a.ts": [
      "function db() { return supabase.from('admin'); }",
      "export function route(db) { return db(); }",
      "export const viaArrow = (db) => db();",
      "export function local() { const db = make(); return db(); }",
      "export function real() { return db(); }",
      "export function destructured(props) { const { db, other: x = db } = props; return db(); }",
      "export function keyOnly(props) { const { db: client } = props; return db(); }",
      "",
    ].join("\n"),
  });
  const fns = run(root).records.map((r) => r.facts.function);
  // `keyOnly` binds `client`, not `db` (a key before `:` binds nothing), so its db() is the module's.
  assert.ok(fns.includes("keyOnly") && !fns.includes("destructured"), fns.join(", "));
  fns.splice(fns.indexOf("keyOnly"), 1);
  assert.deepEqual(fns, ["db", "real"]);
});

test("CR-051: a file of malformed .on('postgres_changes' calls scans in linear time", () => {
  const started = Date.now();
  assert.deepEqual([...scanSubscriptions('x.on("postgres_changes", ('.repeat(20000))], []);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});

test("CR-050: a declaration chain past the closure's bound keeps each unit's own calls and warns, never exhausting memory", (t) => {
  assert.equal(closeOver([{ name: "a", refers: new Set(["b"]) }, { name: "b", refers: new Set() }], () => new Set(["x", "y"]), { max: 3 }), null);
  const N = 1600;
  const lines = [];
  for (let i = 0; i < N; i++) lines.push(`function f${i}() { f${i + 1}(); return s.from("t${i}"); }`);
  const root = scratch(t, { "src/chain.ts": lines.join("\n") + "\n" });
  const { records, warnings } = run(root);
  assert.equal(records.length, N);
  assert.deepEqual(records.find((r) => r.facts.function === "f0").refs, ["?from:t0"]);
  assert.match(warnings.join("\n"), /src\/chain\.ts: too many same-file calls to follow/);
});

test("CR-057/071/074: a walk that runs out of budget warns; .mjs and .cjs are read; a gitignored or oversized file is not", (t) => {
  const files = { "src/a.mjs": "export const a = () => supabase.from('a');\n", "src/b.cjs": "exports.b = () => supabase.from('b');\n", "src/secret.ts": "export const s = () => supabase.from('s');\n" };
  for (let i = 0; i < 20; i++) files[`src/pad/p${i}.ts`] = "export const p = 1;\n";
  const root = scratch(t, files);
  writeFileSync(join(root, "src", "big.ts"), `export const big = () => supabase.from('big');\n${" ".repeat(1024 * 1024)}`);
  const io = makeExtractorIo(root, "t", { ignored: (rel) => rel === "src/secret.ts" });
  const out = supabaseJs({ repoRoot: root, options: { roots: ["src"] }, io });
  assert.deepEqual(out.records.map((r) => r.resource[0]).sort(), ["src/a.mjs", "src/b.cjs"]);
  assert.match(out.diagnostics.join("\n"), /src\/big\.ts: .* — skipped/);
  const tight = supabaseJs({ repoRoot: root, options: { roots: ["src"] }, io: makeExtractorIo(root, "t", { maxEntries: 5 }) });
  assert.match(tight.warnings.join("\n"), /src: the walk's budget ran out — some files were not read/);
});

test("CR-058: the filename encoding is one-to-one — `a b.ts` and `a~20~b.ts` never share a file", (t) => {
  const root = scratch(t, { "src/a b.ts": "export const x = () => supabase.from('jobs');\n", "src/a~20~b.ts": "export const x = () => supabase.from('jobs');\n" });
  const names = run(root).records.map((r) => r.filename);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, 2, names.join(", "));
});

test("CR-056: a table both queried and subscribed to keeps its reads edge beside subscribes", (t) => {
  const root = scratch(t, {
    "migrations/0001.sql": MIGRATION,
    "src/components/Live.tsx": 'export function Live() {\n  supabase.from("jobs").select();\n  sb.on("postgres_changes", { table: "jobs" }, cb);\n  return <span />;\n}\n',
  });
  const ui = components({ repoRoot: root, options: { roots: ["src"] }, io: makeExtractorIo(root) });
  const { records } = resolveRefs([...db(root), ...ui.records, ...run(root).records]);
  assert.deepEqual(records.find((r) => r.kind === "component").facts.edges, { reads: ["table:db/jobs"], subscribes: ["table:db/jobs"] });
});

test("CR-065/D-1: ?code:<file>#* folds every record in the file, from every adapter; a data-access record nothing reaches is dropped", () => {
  const t = (n) => ({ kind: "table", id: `table:db/${n}`, title: n, resource: ["m.sql"], refs: [], facts: {}, filename: `db--${n}.json` });
  const da = (adapter, fn, table) => ({ kind: "data-access", id: `data-access:${adapter}/src/x.ts#${fn}`, title: fn, resource: ["src/x.ts"], refs: [`?from:${table}`], facts: { function: fn }, filename: `${adapter}-${fn}.json`, requireRefs: true });
  const page = { kind: "module", id: "module:src/x.ts", title: "x", resource: ["src/x.ts"], refs: ["?code:src/x.ts#*"], facts: {}, filename: "x.json", requireRefs: true };
  const orphan = { ...da("supabase-js", "unused", "authors"), resource: ["scripts/seed.ts"], id: "data-access:supabase-js/scripts/seed.ts#unused" };
  const { records } = resolveRefs([t("jobs"), t("audit_events"), t("authors"), page, da("supabase-js", "a", "jobs"), da("local-orm", "b", "audit_events"), orphan]);
  assert.deepEqual(records.find((r) => r.id === "module:src/x.ts").refs, ["table:db/audit_events", "table:db/jobs"]);
  assert.ok(!records.some((r) => r.kind === "data-access"), "both absorbed, the unreached one dropped");
});

test("CR-066: a verb the referrer had keeps its place even when a new one sorts before it; the new verbs follow in name order", () => {
  const t = (n) => ({ kind: "table", id: `table:db/${n}`, title: n, resource: ["m.sql"], refs: [], facts: {}, filename: `db--${n}.json` });
  const job = { kind: "job", id: "job:j", title: "j", resource: ["other.py"], refs: ["?code:app/w.py#*", "?table:jobs"], facts: { mode: "worker", edges: { writes: ["?table:jobs"], usedBy: ["?code:app/w.py#*"] } }, filename: "j.json" };
  const da = { kind: "data-access", id: "data-access:x/app/w.py#run", title: "run", resource: ["app/w.py"], refs: ["?table:audit_events", "?table:authors"], facts: { function: "run", edges: { subscribes: ["?table:authors"], reads: ["?table:audit_events"] } }, filename: "w.json", requireRefs: true };
  const { records } = resolveRefs([t("jobs"), t("audit_events"), t("authors"), job, da]);
  assert.deepEqual(Object.keys(records.find((r) => r.id === "job:j").facts.edges), ["usedBy", "writes", "reads", "subscribes"]);
});

test("CR-048: a ?code: ref in a record's refs and in its edge counts once in the lost-link warning", () => {
  const t = { kind: "table", id: "table:db/jobs", title: "jobs", resource: ["m.sql"], refs: [], facts: {}, filename: "db--jobs.json" };
  const c = { kind: "component", id: "component:a#A", title: "A", resource: ["a.tsx"], refs: ["?code:a.tsx#*"], facts: { edges: { reads: ["?code:a.tsx#*"] } }, filename: "a.json" };
  assert.match(resolveRefs([t, c]).warnings.join("\n"), /^1 ref names the code/);
});

test("CR-059: react-router's early returns still say the old subscribeCalls option moved", (t) => {
  const root = scratch(t, { "README.md": "x\n" });
  assert.match(reactRouter({ repoRoot: root, options: { routesFile: "routes.tsx", subscribeCalls: ["live.onInsert"] } }).warnings.join("\n"), /'subscribeCalls' is read by the supabase-js adapter/);
});
