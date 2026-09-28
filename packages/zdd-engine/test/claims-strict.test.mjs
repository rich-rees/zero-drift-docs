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
import { mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync, symlinkSync, chmodSync } from "node:fs";
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

test("CAS-65 CR-027/028/031: `claims: null`, an unknown key, and an oversized allow-list are config errors, never strict silently off", (t) => {
  const repo = derived(t);
  for (const [claims, re] of [
    [null, /'claims' must be an object/],
    [{ strcit: true }, /'claims' has an unknown key 'strcit' \(known: strict, allowUnclaimed\)/],
    [{ strict: true, allowUnclaimed: Array.from({ length: 10_001 }, (_, i) => `route:/r${i}`) }, /'claims\.allowUnclaimed' lists more than 10000 ids/],
    [{ strict: true, allowUnclaimed: ["route:/" + "x".repeat(600)] }, /'claims\.allowUnclaimed' ids must be at most 512 characters/],
  ]) {
    setClaims(repo, claims);
    const r = run(repo, ["lint"]);
    assert.equal(r.status, 1, JSON.stringify(claims)?.slice(0, 80));
    assert.match(r.stderr, re);
  }
  const schema = JSON.parse(readFileSync(join(PKG, "..", "..", "plugins", "zdd", "templates", "config.schema.json"), "utf8"));
  assert.equal(schema.properties.claims.additionalProperties, false, "the schema refuses a misspelt key too");
});

test("CAS-65 CR-029: strict FAILS naming a map or metadata file it could not read — its claims are unknown; default mode warns", (t) => {
  const repo = derived(t);
  const open = unclaimed(repo).map((r) => r.id);
  writeFileSync(join(repo, "zdd", "map", "features", "huge.md"), `---\ntype: Feature\ntitle: Huge\ndescription: x\nresource: apps\ntags: []\n---\n\n${"x".repeat(1024 * 1024)}\n`);
  writeFileSync(join(repo, "zdd", "metadata", "route", "broken.json"), "{ not json");
  setClaims(repo, { strict: true, allowUnclaimed: open });
  const strict = run(repo, ["lint"]);
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /claims\.strict: zdd\/map\/features\/huge\.md could not be read \(over 1048576 bytes\) — its claims are unknown/);
  assert.match(strict.stderr, /claims\.strict: zdd\/metadata\/route\/broken\.json could not be read \(not JSON\) — its record is unknown/);
  // Default mode: a warning, exit 0. (An oversized map concept already fails
  // the blessing lint on its own, so only the unreadable record stays.)
  rmSync(join(repo, "zdd", "map", "features", "huge.md"));
  setClaims(repo, {});
  const loose = run(repo, ["lint"]);
  assert.equal(loose.status, 0, loose.stderr);
  assert.match(loose.stderr, /WARNING: 1 claim file could not be read — the claim picture is incomplete[\s\S]*zdd\/metadata\/route\/broken\.json \(not JSON\)/);
});

test("CAS-65 CR-029 (POSIX): a symlinked feature file is never read, and strict fails naming it", { skip: process.platform === "win32" && "file symlinks need privileges on Windows" }, (t) => {
  const repo = derived(t);
  setClaims(repo, { strict: true, allowUnclaimed: unclaimed(repo).map((r) => r.id) });
  const outside = join(repo, "..", `outside-${Date.now()}.md`);
  writeFileSync(outside, "---\ntype: Feature\ntitle: Linked\n---\n");
  t.after(() => rmSync(outside, { force: true }));
  symlinkSync(outside, join(repo, "zdd", "map", "features", "linked.md"));
  const r = run(repo, ["lint"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /claims\.strict: zdd\/map\/features\/linked\.md could not be read \(a symlink — not followed\)/);
});

test("CAS-65 CR-029: a map folder that exists but cannot be listed is reported, never read as empty (POSIX, not root)", { skip: (process.platform === "win32" || process.getuid?.() === 0) && "needs POSIX permissions and a non-root user" }, (t) => {
  const repo = derived(t);
  setClaims(repo, { strict: true, allowUnclaimed: unclaimed(repo).map((r) => r.id) });
  const locked = join(repo, "zdd", "map", "features");
  chmodSync(locked, 0o000);
  t.after(() => chmodSync(locked, 0o755));
  const r = run(repo, ["lint"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /claims\.strict: zdd\/map\/features could not be read \(could not be listed \(EACCES\)\)/);
});

test("CAS-65 CR-030: many features claiming one record are collected in linear time", (t) => {
  const repo = derived(t);
  const N = 4000;
  for (let i = 0; i < N; i++) feature(repo, `f${String(i).padStart(4, "0")}`, ["- [GET /users](../../metadata/route/users.json)"]);
  const started = Date.now();
  const { doubleClaimed } = unclaimedRecords({ metadataDir: join(repo, "zdd", "metadata"), mapDir: join(repo, "zdd", "map"), bundleDir: join(repo, "zdd") });
  const ms = Date.now() - started;
  const users = doubleClaimed.find((r) => r.id === "route:/users");
  assert.equal(users.features.length, N + 1);
  assert.deepEqual(users.features.slice(0, 2), ["zdd/map/features/f0000.md", "zdd/map/features/f0001.md"], "sorted once");
  assert.ok(ms < 15_000, `collecting took ${ms} ms`);
});

test("CAS-65 CR-032: feature paths in the double-claim output are printable — a control character cannot forge a log line", (t) => {
  const repo = derived(t);
  const name = process.platform === "win32" ? "tab\u0009name" : "evil\nFAKE: all green";
  try {
    feature(repo, name, ["- [GET /users](../../metadata/route/users.json)"]);
  } catch {
    t.skip("this filesystem refuses control characters in names");
    return;
  }
  const r = run(repo, ["lint"]);
  assert.ok(!/^FAKE: all green/m.test(r.stderr), r.stderr);
  assert.match(r.stderr, /features\/(evil\?FAKE: all green|tab\?name)\.md/);
});

test("CAS-65 CR-031: the engine reads zdd/config.json under a size cap — an oversized config fails before it is parsed", (t) => {
  const repo = derived(t);
  const config = JSON.parse(readFileSync(configPath(repo), "utf8"));
  writeFileSync(configPath(repo), JSON.stringify({ ...config, pad: "x".repeat(1024 * 1024) }));
  for (const cmd of ["lint", "derive"]) {
    const r = run(repo, [cmd]);
    assert.equal(r.status, 1, cmd);
    assert.match(r.stderr, /zdd\/config\.json is over 1048576 bytes; a config is small/);
  }
});

test("an allow-list without strict is inert: default mode still warns about every unclaimed record", (t) => {
  const repo = derived(t);
  setClaims(repo, { allowUnclaimed: unclaimed(repo).map((r) => r.id) });
  const r = run(repo, ["lint"]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /WARNING: 9 of 12 records unclaimed/);
});
