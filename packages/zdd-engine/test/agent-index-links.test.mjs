// Every local link the agent index writes resolves to a file (CAS-99): the
// External services list linked `metadata/service/<id>.md` while the record
// is `.json`. Run over every fixture that derives and renders, so a new
// section or kind cannot reintroduce a dead pointer.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURES = ["fixture", "fixture-services", "fixture-components", "fixture-jobs", "fixture-fastapi", "fixture-react-router"];

for (const name of FIXTURES) {
  test(`${name}: every local link in the agent index names a file that exists`, (t) => {
    const repo = mkdtempSync(join(tmpdir(), "zdd-links-"));
    t.after(() => rmSync(repo, { recursive: true, force: true }));
    cpSync(join(PKG, "test", name), repo, { recursive: true });
    const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
    const d = run(["derive"]);
    assert.equal(d.status, 0, d.stderr);
    const r = run(["render"]);
    assert.equal(r.status, 0, r.stderr);
    const index = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
    const hrefs = [...index.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((h) => !/^[a-z]+:/i.test(h) && !h.startsWith("#"));
    assert.ok(hrefs.length > 0, "the index links something");
    const dead = hrefs.filter((h) => !existsSync(join(repo, "zdd", decodeURI(h.split("#")[0]))));
    assert.deepEqual(dead, []);
  });
}

test("a custom paths.metadataDir: service records and feature pointers still link .json (CAS-99 CR-005)", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-links-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(join(PKG, "test", "fixture-services"), repo, { recursive: true });
  const cfgPath = join(repo, "zdd", "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.paths = { metadataDir: "zdd/inventory" };
  writeFileSync(cfgPath, JSON.stringify(cfg));
  for (const page of ["features/health.md", "services/sentry.md"]) {
    const p = join(repo, "zdd", "map", page);
    writeFileSync(p, readFileSync(p, "utf8").replaceAll("../../metadata/", "../../inventory/"));
  }
  const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
  const d = run(["derive"]);
  assert.equal(d.status, 0, d.stderr);
  const r = run(["render"]);
  assert.equal(r.status, 0, r.stderr);
  const index = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  assert.match(index, /\(inventory\/service\/resend\.json\)/, index);
  const hrefs = [...index.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((h) => !/^[a-z]+:/i.test(h) && !h.startsWith("#"));
  assert.deepEqual(hrefs.filter((h) => !existsSync(join(repo, "zdd", decodeURI(h.split("#")[0])))), []);
});
