// Fixture-corpus canaries: invariants derived from test/fixture — a miniature
// Next.js + Supabase repo that exercises renames, FK sweeps, triggers, wrapper
// pages, middleware auth, in-handler auth kinds, buckets, and module records.
// These only break if the replay/walker logic regresses.
// Run: node --test test/
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { derive } from "../src/adapters/nextjs-supabase/index.mjs";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "fixture");
const config = JSON.parse(readFileSync(join(FIXTURE, "zdd", "config.json"), "utf8"));

let records;
before(() => {
  ({ records } = derive({ repoRoot: FIXTURE, options: config.adapterOptions }));
});

const byId = (id) => records.find((r) => r.id === id);

test("canary: things table exists, renamed from widgets; widgets absent", () => {
  const things = byId("table:db/things");
  assert.ok(things);
  assert.deepEqual(things.facts.renamedFrom, ["widgets"]);
  assert.equal(byId("table:db/widgets"), undefined);
});

test("canary: FK sweep — audit_log's reference followed the rename", () => {
  const audit = byId("table:db/audit_log");
  const fk = audit.facts.columns.find((c) => c.name === "thing_id");
  assert.equal(fk.references, "things(id)");
  assert.ok(audit.refs.includes("table:db/things"));
});

test("canary: save_thing refs its tables; trigger function carries attachments", () => {
  const save = byId("function:db/save_thing");
  assert.ok(save.refs.includes("table:db/things"));
  assert.ok(save.refs.includes("table:db/audit_log"));
  const trig = byId("function:db/set_updated_at");
  assert.deepEqual(trig.facts.triggers, ["BEFORE UPDATE ON things"]);
  assert.ok(trig.refs.includes("table:db/things"));
});

test("canary: canonical route derives methods, refs and middleware auth", () => {
  const list = byId("route:/api/things");
  assert.deepEqual(list.facts.methods, ["GET", "POST"]);
  assert.equal(list.facts.auth, "session");
  assert.ok(list.refs.includes("table:db/things"));
  const detail = byId("route:/api/things/[id]");
  assert.deepEqual(detail.facts.methods, ["GET", "PUT", "DELETE"]);
  assert.ok(detail.refs.includes("function:db/save_thing"));
  assert.deepEqual(detail.facts.dynamicSegments, ["id"]);
});

test("canary: matcher-excluded routes get their in-handler auth kinds", () => {
  assert.equal(byId("route:/api/hooks/callback").facts.auth, "hmac");
  assert.equal(byId("route:/api/hooks/status").facts.auth, "session-in-handler");
});

test("canary: wrapper page's primary resource is the rendered component", () => {
  const home = byId("surface:/");
  assert.equal(home.resource[0], "src/components/HomePage.tsx");
  assert.equal(home.resource[1], "src/app/page.tsx");
  // A page with real logic stays its own primary resource.
  const detail = byId("surface:/things/[id]");
  assert.deepEqual(detail.resource, ["src/app/things/[id]/page.tsx"]);
  assert.ok(detail.refs.includes("route:/api/things/[id]"));
});

test("canary: unattributed source files with refs become module records", () => {
  const mod = byId("module:src/lib/things-api.ts");
  assert.ok(mod);
  assert.ok(mod.refs.includes("table:db/things"));
  assert.ok(mod.refs.includes("table:db/audit_log"));
  assert.ok(mod.refs.includes("route:/api/things/[id]"));
  const home = byId("module:src/components/HomePage.tsx");
  assert.ok(home.refs.includes("route:/api/things"));
});

test("canary: buckets — migration-created + config-declared external", () => {
  const uploads = byId("bucket:db/uploads");
  assert.equal(uploads.facts.origin, "migration");
  assert.equal(uploads.facts.public, false);
  assert.equal(uploads.facts.fileSizeLimit, 5242880);
  assert.equal(byId("bucket:db/cdn-assets").facts.origin, "external");
});

test("canary: every ref resolves to an emitted record", () => {
  const ids = new Set(records.map((r) => r.id));
  for (const r of records) for (const ref of r.refs) assert.ok(ids.has(ref), `${r.id} -> ${ref}`);
});
