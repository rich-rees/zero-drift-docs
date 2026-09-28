// Strict claims (CAS-65, decision 0012) — found by Cascade's CAS-64 review:
// its rule is "every record belongs to exactly one feature slice, except the
// plumbing routes", and lint could enforce neither half. Opt-in
// `claims: { strict, allowUnclaimed }` makes an unclaimed record not on the
// list, a stale list entry, and a record claimed by two features all FAIL
// lint; without it a double claim is a warning beside the unclaimed list.
// Driven through the CLI against the react-router fixture.
// Run: node --test "test/*.test.mjs"
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
const FIXTURE = join(PKG, "test", "fixture-react-router");

const run = (repo, args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
function derived(t) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-claims-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE, repo, { recursive: true });
  const r = run(repo, ["derive"]);
  assert.equal(r.status, 0, r.stderr);
  return repo;
}
const configPath = (repo) => join(repo, "zdd", "config.json");
const setClaims = (repo, claims) => {
  const config = JSON.parse(readFileSync(configPath(repo), "utf8"));
  writeFileSync(configPath(repo), JSON.stringify({ ...config, claims }, null, 2));
};
const unclaimed = (repo) => unclaimedRecords({ metadataDir: join(repo, "zdd", "metadata"), mapDir: join(repo, "zdd", "map"), bundleDir: join(repo, "zdd") }).unclaimed;
const feature = (repo, name, links) =>
  writeFileSync(join(repo, "zdd", "map", "features", `${name}.md`), `---\ntype: Feature\ntitle: ${name}\ndescription: x\nresource: apps\ntags: [${name}]\n---\n\n${links.join("\n")}\n`);

test("default mode: a record two features claim is a WARNING naming both slices; lint still exits 0", (t) => {
  const repo = derived(t);
  feature(repo, "audit", ["- [GET /users](../../metadata/route/users.json)"]);
  const r = run(repo, ["lint"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING: 1 record claimed by more than one feature slice/);
  assert.match(r.stderr, /route +\/users +\(zdd\/metadata\/route\/users\.json\) — zdd\/map\/features\/audit\.md, zdd\/map\/features\/user-administration\.md/);
});

test("strict: an unclaimed record off the allow-list FAILS; the allow-list covering them passes and prints no unclaimed warning", (t) => {
  const repo = derived(t);
  const open = unclaimed(repo);
  assert.equal(open.length, 9);
  setClaims(repo, { strict: true, allowUnclaimed: open.slice(1).map((r) => r.id) });
  const fail = run(repo, ["lint"]);
  assert.equal(fail.status, 1, fail.stdout);
  assert.match(fail.stderr, new RegExp(`${open[0].id.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} is unclaimed — claims\\.strict: link it from one feature slice, or add it to claims\\.allowUnclaimed`));
  setClaims(repo, { strict: true, allowUnclaimed: open.map((r) => r.id) });
  const pass = run(repo, ["lint"]);
  assert.equal(pass.status, 0, pass.stderr);
  assert.ok(!/unclaimed —/.test(pass.stderr), pass.stderr);
  assert.match(pass.stdout, /store lints passed \(strict claims: 3\/12 records claimed by a feature, 9 allowed unclaimed\)/);
});

test("strict: an allow-list entry naming no record FAILS (a stale exemption), and so does a record claimed by two features", (t) => {
  const repo = derived(t);
  const open = unclaimed(repo).map((r) => r.id);
  setClaims(repo, { strict: true, allowUnclaimed: [...open, "route:/gone"] });
  const stale = run(repo, ["lint"]);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /claims\.allowUnclaimed lists 'route:\/gone', which is no claimable record — remove it/);

  setClaims(repo, { strict: true, allowUnclaimed: open });
  feature(repo, "audit", ["- [GET /users](../../metadata/route/users.json)"]);
  const twice = run(repo, ["lint"]);
  assert.equal(twice.status, 1);
  assert.match(twice.stderr, /route:\/users is claimed by 2 feature slices \(zdd\/map\/features\/audit\.md, zdd\/map\/features\/user-administration\.md\) — claims\.strict: exactly one owns a record/);
});

test("claims config is validated: a malformed block fails lint before any check runs", (t) => {
  const repo = derived(t);
  for (const [claims, re] of [
    ["yes", /'claims' must be an object/],
    [{ strict: "true" }, /'claims\.strict' must be true or false/],
    [{ strict: true, allowUnclaimed: "route:/health" }, /'claims\.allowUnclaimed' must be an array of record ids/],
    [{ strict: true, allowUnclaimed: [42] }, /'claims\.allowUnclaimed' must be an array of record ids/],
  ]) {
    setClaims(repo, claims);
    const r = run(repo, ["lint"]);
    assert.equal(r.status, 1, JSON.stringify(claims));
    assert.match(r.stderr, re);
  }
});

test("an allow-list without strict is inert: default mode still warns about every unclaimed record", (t) => {
  const repo = derived(t);
  setClaims(repo, { allowUnclaimed: unclaimed(repo).map((r) => r.id) });
  const r = run(repo, ["lint"]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /WARNING: 9 of 12 records unclaimed/);
});
