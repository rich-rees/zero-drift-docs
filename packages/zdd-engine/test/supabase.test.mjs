// supabase extractor option guards against a scratch repo.
// Review CR-064 (DIO-312 campaign). Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { derive } from "../src/extractors/supabase/index.mjs";

const scratch = (files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-supa-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};

test("CR-064: two migrationNamespaces with one name is an error naming both dirs, never a silent replacement", () => {
  const root = scratch({
    "db-a/0001.sql": "create table jobs (id uuid primary key);\n",
    "db-b/0001.sql": "create table offers (id uuid primary key);\n",
  });
  const options = { migrationNamespaces: [{ name: "db", dir: "db-a" }, { name: "db", dir: "db-b" }] };
  assert.throws(() => derive({ repoRoot: root, options }), /migrationNamespaces: name 'db' is used twice \(db-a and db-b\)/);
  // The same name is still refused when the first dir does not exist yet
  // (greenfield tolerance must not hide the duplicate).
  const missing = { migrationNamespaces: [{ name: "db", dir: "nope" }, { name: "db", dir: "db-b" }] };
  assert.throws(() => derive({ repoRoot: root, options: missing }), /name 'db' is used twice \(nope and db-b\)/);
  // Distinct names: both replay.
  const ok = derive({ repoRoot: root, options: { migrationNamespaces: [{ name: "a", dir: "db-a" }, { name: "b", dir: "db-b" }] } });
  assert.deepEqual(ok.records.map((r) => r.id).sort(), ["table:a/jobs", "table:b/offers"]);
  rmSync(root, { recursive: true, force: true });
});

test("a table created as `public.things` keeps that id when later migrations say `things`; its FK, trigger and function edges are drawn either way (CAS-99)", () => {
  const root = scratch({
    "migrations/0001.sql": "create table public.things (id uuid primary key);\ncreate table public.kids (id uuid, thing_id uuid references things(id));\ncreate or replace function touch() returns trigger language plpgsql as $$ begin return new; end; $$;\ncreate trigger trg_touch before update on things for each row execute function touch();\ncreate or replace function count_things() returns int language sql as $$ select count(*) from things $$;\n",
    "migrations/0002.sql": "alter table things add column name text;\n",
  });
  try {
    const { records } = derive({ repoRoot: root, options: { migrationNamespaces: [{ name: "db", dir: "migrations" }] } });
    const things = records.find((r) => r.id === "table:db/public.things");
    assert.ok(things, records.map((r) => r.id).join(", "));
    assert.equal(things.filename, "db--public.things.json");
    assert.deepEqual(things.facts.columns.map((c) => c.name), ["id", "name"]);
    assert.deepEqual(records.find((r) => r.id === "table:db/public.kids").refs, ["table:db/public.things"]);
    assert.deepEqual(records.find((r) => r.id === "function:db/touch").refs, ["table:db/public.things"]);
    assert.deepEqual(records.find((r) => r.id === "function:db/count_things").refs, ["table:db/public.things"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a function body that names only `archive.things` links that table, never `public.things`; a bare or public-qualified mention links the public one (CAS-99 CR-003)", () => {
  const root = scratch({
    "migrations/0001.sql": "create table public.things (id uuid);\ncreate table archive.things (id uuid);\ncreate or replace function archived() returns int language sql as $$ select count(*) from archive.things $$;\ncreate or replace function bare() returns int language sql as $$ select count(*) from things $$;\ncreate or replace function qualified() returns int language sql as $$ select count(*) from public.things $$;\n",
  });
  try {
    const { records } = derive({ repoRoot: root, options: { migrationNamespaces: [{ name: "db", dir: "migrations" }] } });
    const refs = (id) => records.find((r) => r.id === id).refs;
    assert.deepEqual(refs("function:db/archived"), ["table:db/archive.things"]);
    assert.deepEqual(refs("function:db/bare"), ["table:db/public.things"]);
    assert.deepEqual(refs("function:db/qualified"), ["table:db/public.things"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collision checks see through the spelling: `public.things` in one namespace and `things` in another, or a bucket named like a public table, are errors (CAS-99 CR-011)", () => {
  const root = scratch({
    "a/0001.sql": "create table public.things (id uuid);\n",
    "b/0001.sql": "create table things (id uuid);\n",
  });
  try {
    assert.throws(() => derive({ repoRoot: root, options: { migrationNamespaces: [{ name: "a", dir: "a" }, { name: "b", dir: "b" }] } }), /Table 'things' exists in namespaces 'a' and 'b'/);
    assert.throws(() => derive({ repoRoot: root, options: { migrationNamespaces: [{ name: "a", dir: "a" }], externalBuckets: [{ name: "things", namespace: "a" }] } }), /'things' is both a table and a bucket/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
