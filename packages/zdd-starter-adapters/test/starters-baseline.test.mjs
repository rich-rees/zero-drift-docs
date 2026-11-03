// The baseline and the library's two versions (decision 0048, As built
// slices 2 to 4). `baseline/adapters/` holds `supabase` and `sqlalchemy` as
// they were at commit 419293d, the readers that reproduce adopters' records,
// laid out as the published package lays them out; `scripts/stage.mjs` lays
// them over the tree to make 0.1.0, the version "upgrade ZDD" copies first
// and proves the records unchanged against (slice 5). The tree itself is the
// next version, with the fixes notes.json describes.
//
// Held here: every baseline file's bytes, pinned (a change is a deliberate,
// narrated step, as a golden's is); the baseline reaches nothing outside
// itself but the kit; 0.1.0 is the tree with the overlay and nothing else,
// and the tree's version is the tree; on every fixture of this suite, 0.1.0's
// starters derive the same bytes as the tree's (the fixtures hold none of
// what the fixes read, so the two versions must agree there); the
// baseline's own tests pass on 0.1.0; and the notes stage with the version.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { moduleReach } from "../../zdd-engine/src/core/lib/suite.mjs";
import { repoRelative as coreRepoRelative } from "../../zdd-engine/src/core/lib/paths.mjs";
import { repoRelative as sharedRepoRelative } from "../adapters/_shared/paths.mjs";
import { BASELINE, stage, stageable } from "../scripts/stage.mjs";
import { ENGINE_BIN, PKG, fixtures } from "./starters.mjs";
import { copyFixture } from "./starters.mjs";

const BASE = join(PKG, "baseline", "adapters");
const ADAPTERS = ["supabase", "sqlalchemy"];

const walk = (dir) => readdirSync(dir).sort().flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const rel = (base, p) => relative(base, p).split(sep).join("/");
const tree = (dir) => new Map(existsSync(dir) ? walk(dir).map((p) => [rel(dir, p), readFileSync(p, "utf8")]) : []);
const scratch = (t, prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

// Every file of the baseline and the SHA-256 of its bytes as checked out
// (.gitattributes makes every text file LF on every machine). Made from
// `git show 419293d:packages/zdd-engine/…` with only these edits: an import
// of `../../core/lib/paths.mjs` or `data-access.mjs` reads `../_shared/…`,
// `../python/` reads `../_shared/python/`, one comment's path likewise; in
// the tests, the adapter is `../`, the io and the trial come from the kit
// (`@rich-rees/zdd`: `ioFor` for `makeExtractorIo`, `trialRead` for
// `detectRepo`, awaited, over the folder the adapter sits in), and the
// core's coverage half of supabase-formats is left to the engine.
// `_shared/` is the files the two reach, the bytes they had at 419293d (one
// comment has since moved in the tree's copy). CR-282. Slice 4 moved the
// files into the package's layout, changed only the tests' imports, and
// gave each adapter the fixture/ and SUITE export every starter carries, so
// a copy passes the app's standard suite: SUITE is read by the suite alone,
// never by derive, and the fixture is the library suite's own (fixture-jobs
// for supabase, fixture-sqlalchemy for sqlalchemy).
const PINNED = {
  "_shared/data-access.mjs": "4023bfeb680e947d2f6f363d1b7371a855877abdbb5581c6d876dd2e04d1c837",
  "_shared/paths.mjs": "a8f62c77bab9158ed81f6b09213d5ba23528e7e7b27c0185999ce10f4aff23a5",
  "_shared/python/detect.mjs": "35cf24881b6d752beac2f34fc77e8011fd83aed9a55bf353a25b8058ea2dd1a1",
  "_shared/python/imports.mjs": "bfa09d1a1a4edbb74f001e04449d28d2c7fb04ec94b9256ecee7922558dc99b6",
  "_shared/python/source.mjs": "df507325e4abaa84989c44a504f8276a6b81eb8ab48b8ea6eda12d8f6c7c13f5",
  "_shared/slug.mjs": "f12e048774607b984acbfad0d308c963792d33c3a3542c920349663733715343",
  "sqlalchemy/detect.mjs": "10ce2a2cd8677fdbc2c8d2d907f14ca5029ce7a31c4682deea6effaa3cd60fad",
  "sqlalchemy/fixture/app/a/util.py": "85f4beef0026d253d1c28c63e56580bb61eaee81d964064fcfe300edb2d28ccb",
  "sqlalchemy/fixture/app/b/util.py": "50b6bb6b7db3418c6523193b33ed4084f06d0133c6e672a248fe3841907431f5",
  "sqlalchemy/fixture/app/main.py": "3706690cc4c0c8e70789bfb745cf0ba2eb537e7a5b4b6694b0a752d2fb817e97",
  "sqlalchemy/fixture/app/repositories/events.py": "ffd009871794d9c36acca818e242b7d52f4a5997fdd58fa1a4ea1f1c8187d610",
  "sqlalchemy/fixture/app/repositories/jobs.py": "0b93bb603a439948ec31b447c4f7f015f212052ffcc8f4fdfd47e8200c90b9a6",
  "sqlalchemy/fixture/app/routes/jobs.py": "46dcdac8f0b0b93a40f906d049b23445faa340547fabb68d16d61415b1ed8880",
  "sqlalchemy/fixture/supabase/migrations/0001_init.sql": "8c5229d7ffd1235c5a5d33a937b946cd8349d0450ff1a524e37bd1d69436a42e",
  "sqlalchemy/index.mjs": "95f3a193463f34aa9c14e56604ef4eee757b25519fe072088a5d5bd912ef2b82",
  "supabase/detect.mjs": "236e742401fbf1ae7eb09f5e80b4b7b1b2a7b91e6798c72f00a3fab4f3aa55d0",
  "supabase/example/supabase/migrations/0001_things.sql": "95cd7cdff48b97c696685c6cffdb8bf2fa22ad3b16a2ee13e5bed6ac220028a6",
  "supabase/fixture/.github/workflows/nightly.yml": "e2de6df115fbe4a539e6121e22fcf8b8103bddaea12d2ea44c90fe45f81fe976",
  "supabase/fixture/Procfile": "99114bfe8f77755da21968ed80fae0f193b32d8c25f02d101df73be121c7b308",
  "supabase/fixture/apps/api/Procfile": "9708648ed0f578157e8f6a42a0d70af1db9bf5223c57a795ea3a74ce593f5e46",
  "supabase/fixture/apps/api/app/housekeeping.py": "a1e63165295bbcb1b41076ecf6390c89904e114a6f29ed676eb98272cb452cf3",
  "supabase/fixture/apps/api/app/outbound/__init__.py": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "supabase/fixture/apps/api/app/outbound/replay.py": "ffe63ca8f5571e256826057357d1c241301a2c80c85c5264bb980396bf37921d",
  "supabase/fixture/apps/api/app/outbound/worker.py": "e3a29b89aa2c47197c3b471d81e2648e0af5c53719d4189b5e6e8147880ee52b",
  "supabase/fixture/apps/api/package.json": "85be33d00ef0f6b63800bb50651a03190c5400a18eeafb56049567cc74457fdc",
  "supabase/fixture/apps/api/services/housekeeping/railway.toml": "ece90099d7a591fb65d5a6b5d9f76668f04126e9a0ed9ec93b515c56068355ca",
  "supabase/fixture/apps/web/src/app/api/cron/sweep-stalled/route.ts": "2de5b307d290799e9361aac0ce7dcbbef233968b5be852573db7e6d4335aea64",
  "supabase/fixture/apps/web/src/lib/queues.ts": "769613168862c9e86a3138fc553a84e81d1e140ffb7235c331f5455c6e16a4fd",
  "supabase/fixture/apps/web/vercel.json": "f71df73ed71ca4a5c66ce477237f3c901874b6eddfdaedefd1774c9dc695228e",
  "supabase/fixture/docker-compose.yml": "8d9d7cd7302c1873b1bed02ffaa6ec5f2eb38d5ced2a91d286f328e85329a68a",
  "supabase/fixture/scripts/nightly.mjs": "c37df044c9f1412908430884c184e688f2586882c8f9ae00539ec7cf15532bcf",
  "supabase/fixture/scripts/transcode.mjs": "35fd82a7724d2504823a0b32bb35924e8622dded3222180c7960194ef152e68e",
  "supabase/fixture/supabase/migrations/0001_init.sql": "7e3e114ff6bb04d02459893f6bddc9e3cd22c633408d8199ccae387fab3052d3",
  "supabase/fixture/supabase/migrations/0002_cron.sql": "0ea2b5be1a6fef9877c49b85b4675d609b6d91aa351aaf98d9844b3aefa4d765",
  "supabase/fixture/workers/edge/src/index.ts": "cb872f9dac4d2cf04c8ce779ad21aa02982b01614ff9e4704a71c2a46c86e7a0",
  "supabase/fixture/workers/edge/wrangler.toml": "5032e505dc2a42594568115ac103553e5f676e814a5bbe8e1a6fb7f872235150",
  "supabase/index.mjs": "c233ab0753bd8c10f7e16b00460aaa3852a6e9fd13169cfa424c5c37f811212b",
  "supabase/sql-replay.mjs": "d152ca312ad6a2b9b5645b047b3d6cb70aeacc78ca1484148a7e9cd2ad721f4e",
  "supabase/test/sql-replay.test.mjs": "62226719e30704d4712f0e0d4d8d415a2376de1e171a67062555bdd2707b9b73",
  "supabase/test/supabase-formats.test.mjs": "ddc6ca362def9e601ea2404e8b612379ff6b89a252540049fedd83e795739991",
  "supabase/test/supabase.test.mjs": "c6eac4507f6dba928305c5f6052f6f038a69b81093d0c55c17bbbb7e39a9c229",
};

test("the baseline's every file is pinned to its bytes: nothing added, dropped or edited (CR-282)", () => {
  const got = Object.fromEntries(walk(BASE).map((p) => [rel(BASE, p), createHash("sha256").update(readFileSync(p)).digest("hex")]));
  assert.deepEqual(got, PINNED);
});

test("the baseline is self-contained: its adapters reach only themselves and _shared/, _shared/ holds only what they reach, and its tests reach ZDD only through the kit", () => {
  const reached = new Set();
  for (const name of ADAPTERS) {
    for (const p of walk(join(BASE, name)).filter((f) => f.endsWith(".mjs") && !f.includes(`${sep}test${sep}`) && !f.includes(`${sep}fixture${sep}`))) {
      const r = moduleReach(p, BASE);
      assert.deepEqual([r.outside, r.missing], [[], []], p);
      for (const f of r.files) {
        assert.ok(f.startsWith(join(BASE, name) + sep) || f.startsWith(join(BASE, "_shared") + sep), `${p} reaches ${f}`);
        reached.add(f);
      }
    }
  }
  assert.deepEqual(walk(join(BASE, "_shared")), [...reached].filter((f) => f.startsWith(join(BASE, "_shared") + sep)).sort());
  for (const p of walk(join(BASE, "supabase", "test"))) {
    const r = moduleReach(p, BASE);
    assert.deepEqual([r.outside, r.missing], [[], []], p);
    assert.ok(r.files.every((f) => f.startsWith(join(BASE, "supabase") + sep) || f.startsWith(join(BASE, "_shared") + sep)), p);
    const bare = [...readFileSync(p, "utf8").matchAll(/^import .* from "([^".][^"]*)";$/gm)].map((m) => m[1]).filter((s) => !s.startsWith("node:"));
    assert.deepEqual([...new Set(bare)], bare.length ? ["@rich-rees/zdd"] : [], `${p}: a package other than the kit`);
  }
});

test("the stager makes two versions from this tree: 0.1.0, the tree with the baseline laid over it, and the tree's own", (t) => {
  assert.deepEqual(stageable(), [BASELINE, JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version]);
  assert.notEqual(stageable()[1], BASELINE, "the tree is the next version");
  const own = stage(stageable()[1], scratch(t, "zdd-stage-own-"));
  const base = stage(BASELINE, scratch(t, "zdd-stage-base-"));
  // The tree's version is the package's published files, byte for byte.
  const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
  const published = pkg.files.flatMap((f) => (statSync(join(PKG, f)).isDirectory() ? walk(join(PKG, f)) : [join(PKG, f)])).map((p) => rel(PKG, p));
  assert.deepEqual([...own.files].sort(), [...published, "package.json"].sort());
  for (const f of published.filter((f) => f !== "notes.json")) assert.equal(readFileSync(join(own.out, f), "utf8"), readFileSync(join(PKG, f), "utf8"), f);
  // 0.1.0: every starter folder the baseline holds is the baseline's whole,
  // each _shared/ file it holds is its, and everything else is the tree's.
  const ownAdapters = tree(join(own.out, "adapters"));
  const baseAdapters = tree(join(base.out, "adapters"));
  const overlay = tree(BASE);
  for (const [f, text] of baseAdapters) {
    const top = f.split("/")[0];
    if (overlay.has(f)) assert.equal(text, overlay.get(f), `${f}: the baseline's`);
    else {
      assert.ok(!ADAPTERS.includes(top), `${f}: a baseline starter holds only the baseline's files`);
      assert.equal(text, ownAdapters.get(f), `${f}: the tree's`);
    }
  }
  for (const f of ownAdapters.keys()) if (!ADAPTERS.includes(f.split("/")[0])) assert.ok(baseAdapters.has(f), `${f} is in 0.1.0 too`);
  // The version and the notes each stage with.
  assert.equal(JSON.parse(readFileSync(join(base.out, "package.json"), "utf8")).version, BASELINE);
  assert.deepEqual(JSON.parse(readFileSync(join(base.out, "notes.json"), "utf8")).versions.map((v) => v.version), [BASELINE]);
  assert.deepEqual(JSON.parse(readFileSync(join(own.out, "notes.json"), "utf8")).versions.map((v) => v.version), [BASELINE, stageable()[1]]);
  assert.throws(() => stage("0.1.1", scratch(t, "zdd-stage-no-")), /neither/);
  assert.throws(() => stage(BASELINE, own.out), /not empty/);
});

test("on every fixture of this suite, 0.1.0's starters derive the same bytes as the tree's", (t) => {
  const versions = { tree: stage(stageable()[1], scratch(t, "zdd-v-tree-")).out, baseline: stage(BASELINE, scratch(t, "zdd-v-base-")).out };
  let read = 0;
  for (const fixture of fixtures()) {
    const out = {};
    for (const [label, lib] of Object.entries(versions)) {
      const repo = scratch(t, "zdd-baseline-repo-");
      copyFixture(fixture, repo);
      rmSync(join(repo, "zdd", "extractors"), { recursive: true, force: true });
      cpSync(join(lib, "adapters"), join(repo, "zdd", "extractors"), { recursive: true });
      const r = spawnSync(process.execPath, [ENGINE_BIN, "derive", `--root=${repo}`], { encoding: "utf8" });
      out[label] = { status: r.status, out: `${r.stdout}${r.stderr}`.replaceAll(repo, "<repo>"), tree: tree(join(repo, "zdd", "metadata")) };
    }
    const name = rel(PKG, fixture);
    assert.equal(out.tree.status, 0, `${name}, tree: ${out.tree.out}`);
    assert.equal(out.baseline.status, 0, `${name}, 0.1.0: ${out.baseline.out}`);
    assert.equal(out.baseline.out, out.tree.out, `${name}: what derive prints`);
    assert.deepEqual([...out.baseline.tree.keys()], [...out.tree.tree.keys()], `${name}: the record files`);
    for (const [f, text] of out.tree.tree) assert.equal(out.baseline.tree.get(f), text, `${name}: ${f}`);
    if ([...out.tree.tree.keys()].some((k) => /^(table|data-access)\//.test(k))) read++;
  }
  assert.ok(read >= 3, "the fixtures hold tables and data access for the two to read");
});

test("the baseline's own tests pass on 0.1.0, run as an app runs them (zdd-engine test)", (t) => {
  const lib = stage(BASELINE, scratch(t, "zdd-v-base-tests-")).out;
  // supabase's own tests at 419293d, every one (CR-280); sqlalchemy's were
  // in data-access.test.mjs, which reads the core's resolution, and stay in
  // this suite.
  assert.deepEqual(readdirSync(join(lib, "adapters", "supabase", "test")).sort(), ["sql-replay.test.mjs", "supabase-formats.test.mjs", "supabase.test.mjs"]);
  const only = scratch(t, "zdd-v-base-only-");
  cpSync(join(lib, "adapters", "supabase"), join(only, "supabase"), { recursive: true });
  cpSync(join(lib, "adapters", "_shared"), join(only, "_shared"), { recursive: true });
  const r = spawnSync(process.execPath, [ENGINE_BIN, "test", `--adapters=${only}`], { encoding: "utf8" });
  assert.equal(r.status, 0, (r.stdout + r.stderr).split("\n").filter((l) => /^not ok|Error/.test(l)).join("\n"));
  assert.match(r.stdout, /^# fail 0$/m);
});

// The one rule `_shared/` holds a copy of rather than importing: an
// adapter's option path, checked as the core checks config paths.
test("_shared/paths.mjs refuses and normalises exactly what the core's repoRelative does", () => {
  const cases = ["a/b", "./a//b/", ".", "", " a", "a b", "a\tb", "a\\b", "/a", "C:/a", "c:a", "javascript:x", "a/../b", "..", "a/..", "x/./y", "a\u0000b", "a\u007fb", 3, null, "ok-name_1.sql"];
  const run = (fn, v) => {
    try {
      return { ok: fn(v, "label") };
    } catch (e) {
      return { threw: e.message };
    }
  };
  for (const v of cases) assert.deepEqual(run(sharedRepoRelative, v), run(coreRepoRelative, v), JSON.stringify(v));
});
