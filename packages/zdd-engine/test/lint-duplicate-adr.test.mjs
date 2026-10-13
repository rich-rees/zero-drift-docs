// 2.4.1, finding 6: two branches that each mint "the next ADR" merge with no
// git conflict (the filenames differ), leaving two ADRs with one number —
// and citations and supersession key on the number. `lint` has failed on it
// since the engine was extracted (section 0 of lint-stores.mjs, the first adopter's
// own check), but nothing held it. Observed at the CLI seam on scratch
// copies of the fixture.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

const mkRepo = (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-dupadr-"));
  cpSync(FIXTURE, repo, { recursive: true });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  return repo;
};
const lint = (repo) => spawnSync(process.execPath, [BIN, "lint"], { cwd: repo, encoding: "utf8" });

test("lint: two ADR files sharing a number FAIL, naming both and the renumber, never picking one by sort order (CR-001)", (t) => {
  const repo = mkRepo(t);
  // Sorts BEFORE the established 0002-things-…: the order says nothing about which branch added it.
  writeFileSync(join(repo, "zdd", "adr", "0002-a-parallel-branch-decision.md"), "# ADR-0002: A parallel branch decision\n\nStatus: accepted\n");
  const r = lint(repo);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = r.stdout + r.stderr;
  assert.match(out, /duplicate ADR number 0002: 0002-a-parallel-branch-decision\.md and 0002-things-replace-widgets\.md — two branches each minted it/, out);
  assert.match(out, /the ADR the later-merged branch added takes the next free number \(rename it, retitle it, rewrite its citations\), the other keeps 0002/, out);
  assert.doesNotMatch(out, /renumber this file/, "no file is singled out");
});

test("lint: distinct numbers pass", (t) => {
  const repo = mkRepo(t);
  writeFileSync(join(repo, "zdd", "adr", "0003-a-parallel-branch-decision.md"), "# ADR-0003: A parallel branch decision\n\nStatus: accepted\n");
  const r = lint(repo);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /duplicate ADR number/);
});
