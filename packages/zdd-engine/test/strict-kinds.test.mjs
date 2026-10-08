// Strict claims never widen on an extractor opt-in (CAS-97, decision 0017):
// the kinds 2.1 added are claimable and warned about, but under strict a
// failure only when claims.strictKinds names the kind; a page-private
// component is not claimable at all. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { unclaimedRecords } from "../src/lib/claims.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");

const run = (repo, args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
const derived = (t, fixture) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-strictkinds-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(join(PKG, "test", fixture), repo, { recursive: true });
  const r = run(repo, ["derive"]);
  assert.equal(r.status, 0, r.stderr);
  return repo;
};
const setClaims = (repo, claims) => {
  const p = join(repo, "zdd", "config.json");
  writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, "utf8")), claims }, null, 2));
};
const open = (repo) => unclaimedRecords({ metadataDir: join(repo, "zdd", "metadata"), mapDir: join(repo, "zdd", "map"), bundleDir: join(repo, "zdd") });

test("jobs fixture: jobs are claimable; strict alone fails only the tables; strictKinds ['job'] fails the unclaimed jobs too; the claimed worker stays claimed", (t) => {
  const repo = derived(t, "fixture-jobs");
  const u = open(repo);
  assert.deepEqual(u.unclaimed.map((r) => r.id), ["job:housekeeping", "job:nightly", "job:replay", "table:db/audit_events", "table:db/jobs", "table:db/reports"]);
  assert.equal(u.records.find((r) => r.id === "job:worker").optIn, true);
  // Default mode: one warning list, jobs and tables alike.
  const plain = run(repo, ["lint"]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stderr, /WARNING: 6 of 8 records unclaimed/);
  // Strict with the tables allowed: the jobs are a warning, not a failure.
  setClaims(repo, { strict: true, allowUnclaimed: ["table:db/audit_events", "table:db/jobs", "table:db/reports"] });
  const soft = run(repo, ["lint"]);
  assert.equal(soft.status, 0, soft.stderr);
  assert.match(soft.stderr, /WARNING: 3 records of an opt-in kind unclaimed — not a failure until claims\.strictKinds names the kind \(job\):/);
  assert.match(soft.stderr, /job {7}housekeeping {2}\(zdd\/metadata\/job\/housekeeping\.json\)/);
  assert.doesNotMatch(soft.stderr, /is unclaimed — claims\.strict/);
  // Naming the kind makes it a failure, with the same line a route gets.
  setClaims(repo, { strict: true, allowUnclaimed: ["table:db/audit_events", "table:db/jobs", "table:db/reports"], strictKinds: ["job"] });
  const hard = run(repo, ["lint"]);
  assert.equal(hard.status, 1, hard.stderr);
  assert.match(hard.stderr, /job:housekeeping is unclaimed — claims\.strict: link it from one feature slice, or add it to claims\.allowUnclaimed/);
  assert.match(hard.stderr, /job:nightly is unclaimed/);
  assert.doesNotMatch(hard.stderr, /job:worker is unclaimed/);
  // Allow-listing a job works like any record.
  setClaims(repo, { strict: true, allowUnclaimed: ["table:db/audit_events", "table:db/jobs", "table:db/reports", "job:housekeeping", "job:nightly", "job:replay"], strictKinds: ["job"] });
  assert.equal(run(repo, ["lint"]).status, 0);
});

test("components fixture: a shared component is claimable, a page-private one is not; strictKinds ['component'] fails the unclaimed shared ones only", (t) => {
  const repo = derived(t, "fixture-components");
  const u = open(repo);
  const kinds = u.records.filter((r) => r.kind === "component").map((r) => r.title).sort();
  assert.deepEqual(kinds, ["Badge", "Button", "RouteSearchPanel"], "Sparkline is page-private");
  const allowRest = u.unclaimed.filter((r) => r.kind !== "component").map((r) => r.id);
  setClaims(repo, { strict: true, allowUnclaimed: allowRest, strictKinds: ["component"] });
  const r = run(repo, ["lint"]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /component:apps\/web\/src\/components\/Badge\.tsx#Badge is unclaimed/);
  assert.match(r.stderr, /component:packages\/ui\/src\/Button\.tsx#Button is unclaimed/);
  assert.doesNotMatch(r.stderr, /RouteSearchPanel is unclaimed/, "claimed by the Jobs slice");
  assert.doesNotMatch(r.stderr, /Sparkline/);
});

test("config: strictKinds must be an array of opt-in kinds — an original kind and an unknown kind are refused by name; an unknown claims key still is", (t) => {
  const repo = derived(t, "fixture-jobs");
  const expect = (claims, re) => {
    setClaims(repo, claims);
    const r = run(repo, ["lint"]);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, re);
  };
  expect({ strict: true, strictKinds: "job" }, /'claims\.strictKinds' must be an array of kinds \(component, job, service\)/);
  expect({ strict: true, strictKinds: ["route"] }, /'claims\.strictKinds' lists 'route', which 'claims\.strict' already governs — remove it/);
  expect({ strict: true, strictKinds: ["jobz"] }, /'claims\.strictKinds' lists 'jobz', which is no opt-in claimable kind/);
  expect({ strict: true, strictKind: ["job"] }, /'claims' has an unknown key 'strictKind'/);
});
