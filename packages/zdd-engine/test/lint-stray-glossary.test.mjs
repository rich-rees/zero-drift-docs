// CAS-93: Matt Pocock's skills (1.3+) read and lazily create a root
// GLOSSARY.md (CONTEXT.md before 1.3). In a ZDD repo the glossary lives at
// paths.glossary, so a root file of either name beside it is a stray: terms
// landing where nothing reads them. `lint` says so as a WARNING on stderr,
// exit 0 — a nudge, never a failure (the same tier as an unclaimed record),
// so an adopter mid-migration does not go red in CI. Observed at the CLI seam
// on scratch copies of the fixture.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, renameSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

const mkRepo = (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-stray-"));
  cpSync(FIXTURE, repo, { recursive: true });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  return repo;
};
const lint = (repo) => spawnSync(process.execPath, [BIN, "lint"], { cwd: repo, encoding: "utf8" });
const STRAY = /WARNING: (GLOSSARY|CONTEXT)\.md at the repo root/;

test("lint: a root GLOSSARY.md beside zdd/glossary.md is a WARNING naming both files and the fix, exit 0", (t) => {
  const repo = mkRepo(t);
  writeFileSync(join(repo, "GLOSSARY.md"), "# Glossary\n\n**Thing**: stray.\n");
  const r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING: GLOSSARY\.md at the repo root beside zdd\/glossary\.md/, r.stderr);
  assert.match(r.stderr, /Matt Pocock's skills/, r.stderr);
  assert.match(r.stderr, /docs\/agents\/domain\.md/, r.stderr);
  assert.match(r.stdout, /store lints passed/);
});

test("lint: the pre-1.3 name CONTEXT.md gets the same WARNING; a clean root gets none", (t) => {
  const repo = mkRepo(t);
  assert.doesNotMatch(lint(repo).stderr, STRAY, "clean fixture");
  writeFileSync(join(repo, "CONTEXT.md"), "# Context\n");
  const r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING: CONTEXT\.md at the repo root beside zdd\/glossary\.md/, r.stderr);
});

test("lint: a root GLOSSARY.md that IS the configured glossary (paths.glossary) is not a stray", (t) => {
  const repo = mkRepo(t);
  renameSync(join(repo, "zdd", "glossary.md"), join(repo, "GLOSSARY.md"));
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  cfg.paths = { ...(cfg.paths ?? {}), glossary: "GLOSSARY.md" };
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(cfg, null, 2) + "\n");
  const r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, STRAY, r.stderr);
});
