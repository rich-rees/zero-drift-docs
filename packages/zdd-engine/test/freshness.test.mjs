// The advisory freshness check, widened in DIO-313: a concept is watched
// through its `resource:` path AND the source behind every metadata record it
// links to. Observed at the CLI seam on a scratch git repo built from the
// Next.js fixture (derived so the metadata records exist), plus watchedPaths
// on its own. Always exit 0.
// Run: node --test "test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync, cpSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { watchedPaths } from "../src/check-freshness.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

let repo;
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const engine = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
const commit = (msg) => {
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg);
};

before(() => {
  repo = mkdtempSync(join(tmpdir(), "zdd-fresh-"));
  cpSync(FIXTURE, repo, { recursive: true });
  git("init", "-q", "-b", "main");
  assert.equal(engine("derive").status, 0);
  commit("base");
  git("checkout", "-q", "-b", "work");
});
after(() => repo && rmSync(repo, { recursive: true, force: true }));

const freshness = () => {
  const r = engine("freshness", "--base", "main");
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
// Each scenario runs on a fresh `work` branch off main; the reset happens in
// finally so one failing scenario cannot cascade into the next.
const scenario = (fn) => {
  try {
    fn();
  } finally {
    git("checkout", "-q", "-f", "main");
    git("branch", "-q", "-D", "work");
    git("checkout", "-q", "-b", "work");
  }
};
// The fixture's app concept (zdd/map/apps/fixture-app.md) has `resource: src`,
// so every change under src/ fires it via `resource:` — expected, and a row
// the scenarios below assert alongside the feature's.
const APP_ROW = /\| `zdd\/map\/apps\/fixture-app\.md` \| [^|]+ \| `resource:` \|/;

test("watchedPaths: the resource plus every linked metadata record's source, deduped, in document order; map links and broken links contribute nothing", () => {
  const conceptPath = join(repo, "zdd", "map", "features", "things.md");
  const text = readFileSync(conceptPath, "utf8");
  const watched = watchedPaths(conceptPath, text, { bundleDir: join(repo, "zdd"), metadataDir: join(repo, "zdd", "metadata") });
  assert.deepEqual(watched[0], { path: "src/components", via: "resource" });
  assert.ok(watched.some((w) => w.path === "src/app/api/things/route.ts" && w.via === "metadata/route/things"), JSON.stringify(watched));
  assert.ok(watched.some((w) => w.path === "src/app/api/things/[id]/route.ts" && w.via === "metadata/route/things--_id"));
  assert.ok(watched.some((w) => w.via === "metadata/table/db--things"), "a table record's migration file is watched too");
  assert.equal(new Set(watched.map((w) => w.path)).size, watched.length, "no duplicate paths");
  const withMapLink = text + "\n- [app](../apps/fixture-app.md)\n- [nowhere](/metadata/route/nope.json)\n- [outside](../../../../etc/passwd.json)\n";
  assert.deepEqual(
    watchedPaths(conceptPath, withMapLink, { bundleDir: join(repo, "zdd"), metadataDir: join(repo, "zdd", "metadata") }),
    watched,
  );
});

test("freshness: no diff against the base says so", () => {
  assert.match(freshness(), /No changes against main/);
});

test("freshness: a change under the resource path fires via `resource:`; updating the concept in the same diff clears it", () =>
  scenario(() => {
    appendFileSync(join(repo, "src", "components", "HomePage.tsx"), "\n// touched\n");
    commit("touch component");
    let out = freshness();
    assert.match(out, /possibly stale concepts/);
    assert.match(out, /\| `zdd\/map\/features\/things\.md` \| src\/components\/HomePage\.tsx \| `resource:` \|/);
    assert.match(out, APP_ROW);
    appendFileSync(join(repo, "zdd", "map", "features", "things.md"), "\nUpdated.\n");
    appendFileSync(join(repo, "zdd", "map", "apps", "fixture-app.md"), "\nUpdated.\n");
    commit("update concepts");
    out = freshness();
    assert.match(out, /No semantic concepts affected/);
  }));

test("freshness: a change to the source behind a LINKED metadata record fires, naming the record — the DIO-313 widening", () =>
  scenario(() => {
    // src/app/api/things/[id]/route.ts is nowhere near the feature's resource
    // (src/components); before the widening this change never fired for it.
    appendFileSync(join(repo, "src", "app", "api", "things", "[id]", "route.ts"), "\n// touched\n");
    commit("touch linked route");
    const out = freshness();
    assert.match(out, /possibly stale concepts/);
    assert.match(out, /\| `zdd\/map\/features\/things\.md` \| src\/app\/api\/things\/\[id\]\/route\.ts \| `metadata\/route\/things--_id` \|/);
    assert.match(out, APP_ROW);
    // A file under both a resource and a linked record lists both routes in.
    appendFileSync(join(repo, "src", "components", "HomePage.tsx"), "\n// touched\n");
    commit("touch component too");
    assert.match(freshness(), /\| `zdd\/map\/features\/things\.md` \| [^|]*HomePage\.tsx[^|]*\| `resource:`<br>`metadata\/route\/things--_id` \|/);
  }));

test("freshness: an unrelated change fires nothing", () =>
  scenario(() => {
    writeFileSync(join(repo, "README.md"), "# unrelated\n");
    commit("readme");
    assert.match(freshness(), /No semantic concepts affected/);
  }));
