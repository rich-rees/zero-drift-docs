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
import { derive as supabaseJs, scanDataCalls } from "../src/adapters/supabase-js/index.mjs";
import { derive as supabase } from "../src/adapters/supabase/index.mjs";
import { derive as reactRouter } from "../src/adapters/react-router/index.mjs";
import { derive as components } from "../src/adapters/components/index.mjs";
import { codeUnits, topLevel, MODULE_UNIT } from "../src/adapters/js/source.mjs";
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
