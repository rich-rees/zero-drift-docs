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
