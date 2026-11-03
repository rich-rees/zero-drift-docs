// Who covers `schema` and `queries` (decision 0048 point 6): the core's side
// of the trial read. An adapter answers detect; the core counts a part
// covered only by a proposal, so a declined claim leaves the part uncovered
// and bootstrap offers to build. The adapter's own answers are in
// supabase-formats.test.mjs.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detectRepo } from "../../zdd-engine/src/core/lib/detect-repo.mjs";
import { folderModules } from "../../zdd-engine/src/core/lib/adapter-folder.mjs";
import { ADAPTERS } from "./starters.mjs";
import { trialRead } from "../../zdd-engine/src/core/kit.mjs";
import * as supabase from "../adapters/supabase/index.mjs";

const modules = await folderModules(ADAPTERS);

const repo = (t, files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-coverage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};

test("a claim read clean covers `schema`; a declined one leaves it uncovered and is passed on with its reasons", async (t) => {
  const ok = detectRepo(repo(t, { "migrations/001.sql": "create table a (id int);\n" }), modules);
  assert.deepEqual(ok.coverage.find((c) => c.part === "schema").adapters, ["supabase"]);
  const root = repo(t, { "migrations/001.sql": "alter table never_made add column x int;\n" });
  const no = detectRepo(root, modules);
  assert.ok(!no.proposals.some((p) => p.name === "supabase"));
  assert.ok(no.uncovered.includes("schema"), "`schema` stays uncovered, so bootstrap offers to build");
  const said = no.declined.find((x) => x.name === "supabase");
  assert.deepEqual(said.parts, ["schema"]);
  // Passed on as the adapter said them, every word (CR-283).
  assert.deepEqual(said.reasons, (await trialRead(supabase, root, ADAPTERS)).declined);
  assert.match(said.reasons.join(" "), /never_made/);
});

test("the adapter kit's trial sees what detection sees: a folder another adapter skips is skipped for both (CR-286)", async (t) => {
  const root = repo(t, { "node_modules/pkg/migrations/001.sql": "create table vendored (id int);\n" });
  const d = detectRepo(root, modules);
  const own = await trialRead(supabase, root, ADAPTERS);
  assert.equal(Boolean(own?.proposal), d.proposals.some((p) => p.name === "supabase"));
  assert.ok(!own?.proposal, "an installed package's migrations are no claim, in the kit as in detection");
});

test("Flyway's own folder claims nothing and declines nothing: `schema` is simply uncovered", async (t) => {
  const d = detectRepo(repo(t, { "src/main/resources/db/migration/V1__init.sql": "CREATE TABLE orders (id INT PRIMARY KEY);\n" }), modules);
  assert.ok(d.uncovered.includes("schema"));
  assert.deepEqual(d.declined, []);
});

// ---- Other claimers ----

test("SQLAlchemy with no schema reader: `queries` covered, `schema` uncovered", async (t) => {
  const d = detectRepo(repo(t, { "requirements.txt": "sqlalchemy==2.0\n", "app/db.py": "from sqlalchemy import text\nrows = session.execute(text('select * from things'))\n" }), modules);
  assert.deepEqual(d.coverage.find((c) => c.part === "queries").adapters, ["sqlalchemy"]);
  assert.deepEqual(d.coverage.find((c) => c.part === "schema").adapters, []);
  assert.ok(d.uncovered.includes("schema"));
});

test("SQLAlchemy beside migrations the trial declines: `schema` is uncovered there too", async (t) => {
  const d = detectRepo(repo(t, { "requirements.txt": "sqlalchemy==2.0\n", "migrations/001.sql": "CREATE TABLE `users` (`id` int);\n" }), modules);
  assert.deepEqual(d.coverage.find((c) => c.part === "schema").adapters, []);
});

test("no adapter that reads queries also claims schema", () => {
  const both = modules.filter(({ mod }) => mod.DETECTION?.parts.includes("queries") && mod.DETECTION.parts.includes("schema"));
  assert.deepEqual(both.map((m) => m.name), []);
  const schema = modules.filter(({ mod }) => mod.DETECTION?.parts.includes("schema")).map((m) => m.name);
  assert.deepEqual(schema, ["supabase"]);
});
