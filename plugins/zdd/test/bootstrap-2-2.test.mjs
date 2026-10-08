// ZDD 2.2 adoption prompts (CAS-101): detection asks about a Realtime wrapper
// when Supabase sits beside a web app (the client's own .on("postgres_changes")
// needs nothing; a wrapper is invisible until named in subscribeCalls), and the
// services proposal says what its `usedBy` can and cannot see.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync, mkdtempSync, cpSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "test");
const BOOTSTRAP = join(PLUGIN, "scripts", "bootstrap.mjs");

const scratch = (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-boot22-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  return repo;
};
const detect = (repo, json = true) => execFileSync(process.execPath, [BOOTSTRAP, "detect", ...(json ? ["--json"] : []), `--root=${repo}`], { encoding: "utf8" });

test("Supabase beside a Next.js app: detection asks the Realtime-wrapper question, in JSON and in the narration", (t) => {
  const repo = scratch(t);
  mkdirSync(join(repo, "supabase", "migrations"), { recursive: true });
  writeFileSync(join(repo, "supabase", "migrations", "001_init.sql"), "create table things (id int);\n");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ dependencies: { next: "14.0.0" } }));
  const json = JSON.parse(detect(repo));
  assert.deepEqual(json.proposals.map((p) => p.name), ["supabase", "nextjs"]);
  const q = json.questions.find((x) => x.topic === "realtime");
  assert.ok(q, JSON.stringify(json.questions));
  assert.match(q.ask, /wrapper of its own/);
  assert.match(q.ask, /\.on\("postgres_changes"/);
  assert.deepEqual(q.records, "extractorOptions.nextjs.refs.subscribeCalls");
  assert.match(detect(repo, false), /^ {2}ask: Does the app subscribe to Supabase Realtime through a wrapper of its own/m);
});

test("Supabase alone, or a web app alone: no Realtime question", (t) => {
  const repo = scratch(t);
  mkdirSync(join(repo, "supabase", "migrations"), { recursive: true });
  writeFileSync(join(repo, "supabase", "migrations", "001_init.sql"), "create table things (id int);\n");
  assert.deepEqual(JSON.parse(detect(repo)).questions, []);
});

test("the services proposal says what usedBy sees: files carrying the marker, never a provider reached through a settings object", (t) => {
  const repo = scratch(t);
  cpSync(join(FIXTURES, "fixture-services"), repo, { recursive: true });
  rmSync(join(repo, "zdd"), { recursive: true });
  const services = JSON.parse(detect(repo)).proposals.find((p) => p.name === "services");
  assert.ok(services);
  assert.ok(services.evidence.some((e) => /usedBy lists the files carrying a service's marker.*never .*settings object/.test(e)), services.evidence.join("\n"));
});
