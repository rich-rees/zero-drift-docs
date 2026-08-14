// End-to-end determinism + --check behaviour, exercised through the real CLI
// against a throwaway copy of test/fixture (the engine never writes into the
// committed fixture). Also the render smoke test: the fixture's config turns
// store-change highlights off (render.storeChanges: false), so no git repo is
// needed and the outputs are pure functions of the fixture bytes.
// Run: node --test test/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

let repo; // throwaway fixture copy
const run = (args, opts = {}) =>
  execFileSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8", ...opts });

before(() => {
  repo = mkdtempSync(join(tmpdir(), "zdd-engine-"));
  cpSync(FIXTURE, repo, { recursive: true });
});
after(() => rmSync(repo, { recursive: true, force: true }));

test("derive is byte-stable: --check passes twice after one derive", () => {
  assert.match(run(["derive"]), /Wrote \d+ records/);
  assert.match(run(["derive", "--check"]), /in sync/);
  assert.match(run(["derive", "--check"]), /in sync/);
});

test("render is byte-stable and --check passes", () => {
  run(["render"]);
  const first = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  assert.match(run(["render", "--check"]), /in sync/);
  run(["render"]);
  assert.equal(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), first);
});

test("agent index: feature sections, generic regen pointer, linkified ADRs", () => {
  const index = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  assert.match(index, /^# Fixture App/m);
  assert.match(index, /^## Things/m);
  assert.match(index, /zdd-engine derive/);
  assert.ok(!index.includes("zdd/scripts/"), "no in-tree script paths in output");
  // Bare ADR citations in descriptions become links relative to the bundle.
  assert.ok(index.includes("[ADR-0002](adr/0002-things-replace-widgets.md)"), index);
});

test("human index: configured title + embedded docs", () => {
  const html = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  assert.ok(html.includes("<title>Fixture App Wiki</title>"));
  assert.ok(html.includes("https://github.com/example/fixture/tree/main/"));
});

test("ADR index: numeric order + supersession stamp", () => {
  const adrIndex = readFileSync(join(repo, "zdd", "adr-index.md"), "utf8");
  assert.ok(adrIndex.includes("[ADR-0001](adr/0001-widgets-are-the-core-entity.md)"));
  assert.ok(adrIndex.includes("_(superseded by ADR-0002)_"), adrIndex);
});

test("lint: fixture stores pass the supersession-symmetry lint", () => {
  assert.match(run(["lint"]), /store lints passed/);
});

test("check fails on stale, missing and orphaned files, and derive repairs", () => {
  const metadata = join(repo, "zdd", "metadata");
  const routeFile = join(metadata, "route", "things.json");
  writeFileSync(routeFile, readFileSync(routeFile, "utf8").replace("things", "thimgs"));
  writeFileSync(join(metadata, "route", "ghost.json"), "{}\n");
  rmSync(join(metadata, "table", "db--things.json"));

  let failed = false;
  try {
    run(["derive", "--check"]);
  } catch (err) {
    failed = true;
    const out = String(err.stderr);
    assert.match(out, /stale: route\/things\.json/);
    assert.match(out, /orphaned .*: route\/ghost\.json/);
    assert.match(out, /missing: table\/db--things\.json/);
    assert.match(out, /zdd-engine derive/);
  }
  assert.ok(failed, "--check should exit non-zero");

  // Write mode repairs all three (including pruning the orphan).
  run(["derive"]);
  assert.match(run(["derive", "--check"]), /in sync/);
});

test("derived output contains no timestamps, CRLF, or absolute paths", () => {
  const sample = readFileSync(join(repo, "zdd", "metadata", "route", "things.json"), "utf8");
  assert.ok(!/[A-Za-z]:\\/.test(sample), "no Windows absolute paths");
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(sample), "no ISO timestamps");
  assert.ok(sample.endsWith("\n"), "trailing newline");
  assert.ok(!sample.includes("\r"), "LF only");
});
