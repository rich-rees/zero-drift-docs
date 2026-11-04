// The baseline and the library's two versions (decision 0048, As built
// slices 2 to 4). `baseline/adapters/` holds `supabase` and `sqlalchemy` as
// they were at commit 419293d, and `nextjs` as 0.1.0 published it (0.2.1
// changed it), the readers that reproduce adopters' records,
// laid out as the published package lays them out; `scripts/stage.mjs` lays
// them over the tree to make 0.1.0, the version "upgrade ZDD" copies first
// and proves the records unchanged against (slice 5). The tree itself is the
// next version, with the fixes notes.json describes.
//
// Held here: every baseline file's bytes, pinned (a change is a deliberate,
// narrated step, as a golden's is); the baseline reaches nothing outside
// itself but the kit; 0.1.0 is the tree with the overlay and nothing else,
// and the tree's version is the tree; on every fixture of this suite, 0.1.0's
// starters derive the same bytes as the tree's but for the record files
// CHANGED names, each a fix the notes describe; the
// baseline's own tests pass on 0.1.0; and the notes stage with the version.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { moduleReach } from "../../zdd-engine/src/core/lib/suite.mjs";
import { repoRelative as coreRepoRelative } from "../../zdd-engine/src/core/lib/paths.mjs";
import { repoRelative as sharedRepoRelative } from "../adapters/_shared/paths.mjs";
import { BASELINE, MANIFEST, checkNotes, manifestOf, stage, stageable } from "../scripts/stage.mjs";
import { ENGINE_BIN, PKG, fixtures } from "./starters.mjs";
import { copyFixture } from "./starters.mjs";

const BASE = join(PKG, "baseline", "adapters");
const ADAPTERS = ["supabase", "sqlalchemy", "nextjs"];
// The record files a fixture derives differently on the tree than on 0.1.0,
// by fixture: each is a fix notes.json describes, and must differ. 0.2.1:
// the home screen renders HomePage from src/components, and takes its call.
const CHANGED = { "test/fixture": ["surface/index.json"] };

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
// comment has since moved in the tree's copy). CR-282. 0.2.1 added `nextjs`
// and the `_shared/` files it reaches, each byte for byte as 0.1.0 (main at
// 07dd8ac) staged it. Slice 4 moved the
// files into the package's layout, changed only the tests' imports, and
// gave each adapter the fixture/ and SUITE export every starter carries, so
// a copy passes the app's standard suite: SUITE is read by the suite alone,
// never by derive, and the fixture is the library suite's own (fixture-jobs
// for supabase, fixture-sqlalchemy for sqlalchemy).
const PINNED = {
  "_shared/data-access.mjs": "4023bfeb680e947d2f6f363d1b7371a855877abdbb5581c6d876dd2e04d1c837",
  "_shared/js/detect.mjs": "9fb04fec326bc58aaff4b555d28c81caeef7fc561a55569893a8de6043af0c4d",
  "_shared/js/imports.mjs": "430f9805ea8f0d7d5684c3ce2a9c8ffb929333a963c31f86fd6f7e9330296b3f",
  "_shared/js/source.mjs": "0f270dfa0546e4ef3eabf8dcf57864c0bf10f13bc3aa6e1188cb503d9b26c2e7",
  "_shared/template-paths.mjs": "adf9bd13391aa58f7abd376514e2a348936bb64b1ee83bdae023e95d71bea340",
  "_shared/paths.mjs": "a8f62c77bab9158ed81f6b09213d5ba23528e7e7b27c0185999ce10f4aff23a5",
  "_shared/python/detect.mjs": "35cf24881b6d752beac2f34fc77e8011fd83aed9a55bf353a25b8058ea2dd1a1",
  "_shared/python/imports.mjs": "bfa09d1a1a4edbb74f001e04449d28d2c7fb04ec94b9256ecee7922558dc99b6",
  "_shared/python/source.mjs": "df507325e4abaa84989c44a504f8276a6b81eb8ab48b8ea6eda12d8f6c7c13f5",
  "_shared/slug.mjs": "f12e048774607b984acbfad0d308c963792d33c3a3542c920349663733715343",
  "nextjs/detect.mjs": "66c994f3768c11e158ccaae1cdb1ddf40547dc7819650af516496ba25f7282f7",
  "nextjs/example/src/app/api/things/route.ts": "8452fa57b4fd5a751b77e7511b3e99b8eaf370d20bffe41b35180d284fab8432",
  "nextjs/example/src/app/page.tsx": "a9430615ed7ca6fb8a559e040a55ac0106471ac70901422f969c92c97c107392",
  "nextjs/example/src/app/things/[id]/page.tsx": "7f7abd8f4dacbcca09c8598031cac2bfa888298163cb331ea7d8a6f439aff10f",
  "nextjs/fixture/migrations/00001_init.sql": "6c129256d9082d26efd1bad198031a1121b1a9bc8a29ffc4fc063a5782234d28",
  "nextjs/fixture/migrations/00002_things.sql": "7ddd15a2c009d79c414f180a853ccefedbc207554563a1bcd0ae82f36c9bba10",
  "nextjs/fixture/src/app/(app)/layout.tsx": "22f33a9ed4a52be8f933dd9e11e5e95207540660c067ae8c53d6773852cd3b9c",
  "nextjs/fixture/src/app/api/hooks/callback/route.ts": "6e9389270356030657234533f64141a1deec67de98613523392491472d4a45dc",
  "nextjs/fixture/src/app/api/hooks/status/route.ts": "fee4eef6d04b969f611fec591e54570223badfb3234349777d93418666d100aa",
  "nextjs/fixture/src/app/api/things/[id]/route.ts": "bc6a13ae349e27c0f34612b1d49e14ced19c738c85631b33fa8e5f9f5e958c17",
  "nextjs/fixture/src/app/api/things/route.ts": "7f448a520f9a2a82da0d0ed0da737bb07aa5d7fdd541a27864146d619d3ca419",
  "nextjs/fixture/src/app/layout.tsx": "94a959c04935cff3dfd044ccee6164163fbfdb0896c31f5525abc95dff9c23c9",
  "nextjs/fixture/src/app/page.tsx": "45c2a249427d372e4099bce53dad70cf84144a395285a818edff6d77d9672ae3",
  "nextjs/fixture/src/app/things/[id]/page.tsx": "b536a1ddcc64854a2de1d85b05cc6a2a945a340b7d09a5f0cadc83d81f760a79",
  "nextjs/fixture/src/components/HomePage.tsx": "cfd66627d98448e3462b8417be13cc2945c5f30e5a4bc21bbca4c21b7817b9b6",
  "nextjs/fixture/src/lib/things-api.ts": "2a949934a35311aa1c9a85a1e213268e3f7be5ba515f7948d9ccecb02472e2e5",
  "nextjs/fixture/src/middleware.ts": "263ca745fde35a829827ee9431fe321f4e86bfc457b7606b716d7492217e40c2",
  "nextjs/index.mjs": "c7dbf52db7aa76d9da7985a5a9110ba8992d9aca7b54b7fa83f6dc94b7976cc2",
  "nextjs/refs.mjs": "733702d7deee71bab026ebb9808a4649dc055c70d33493bc0b3de8a11d23655a",
  "nextjs/test/wrapper-resolution.test.mjs": "30c4489abc69fb2ff4fdc299af08e00d17dd745e309086f3eb85323e641411cd",
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
  assert.deepEqual(JSON.parse(readFileSync(join(own.out, "notes.json"), "utf8")).versions.map((v) => v.version), JSON.parse(readFileSync(join(PKG, "notes.json"), "utf8")).versions.map((v) => v.version));
  // 0.1.0's README is the one it was published with; the tree's lists later versions.
  assert.equal(readFileSync(join(base.out, "README.md"), "utf8"), readFileSync(join(PKG, "baseline", "README.md"), "utf8"));
  assert.equal(readFileSync(join(own.out, "README.md"), "utf8"), readFileSync(join(PKG, "README.md"), "utf8"));
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
    const changed = CHANGED[name] ?? [];
    for (const [f, text] of out.tree.tree) {
      if (changed.includes(f)) assert.notEqual(out.baseline.tree.get(f), text, `${name}: ${f} is named in CHANGED but derives the same — take it out`);
      else assert.equal(out.baseline.tree.get(f), text, `${name}: ${f}`);
    }
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

test("CR-291: 0.1.0 is frozen by its manifest: what it stages is exactly the pinned bytes, and a change to any starter refuses the stage rather than change 0.1.0", (t) => {
  const pinned = JSON.parse(readFileSync(join(PKG, MANIFEST), "utf8"));
  const out = stage(BASELINE, scratch(t, "zdd-frozen-"));
  assert.deepEqual(manifestOf(out.out), pinned);
  // A tree whose generic starter has since changed: 0.1.0 can no longer be staged from it.
  const tree = scratch(t, "zdd-frozen-tree-");
  for (const part of ["package.json", "notes.json", "README.md", "adapters", "baseline"]) cpSync(join(PKG, part), join(tree, part), { recursive: true });
  writeFileSync(join(tree, "adapters", "generic", "index.mjs"), readFileSync(join(tree, "adapters", "generic", "index.mjs"), "utf8") + "// later\n");
  const dest = join(scratch(t, "zdd-frozen-out-"), "v");
  assert.throws(() => stage(BASELINE, dest, { root: tree }), /0\.1\.0 is frozen by baseline\/manifest-0\.1\.0\.json, and 1 staged file\(s\) differ from it: adapters\/generic\/index\.mjs/);
  assert.ok(!existsSync(dest), "a refused stage leaves nothing behind");
  assert.equal(stage(stageable()[1], join(scratch(t, "zdd-frozen-own-"), "v"), { root: tree }).version, stageable()[1], "the tree's own version still stages");
});

test("CR-297: notes.json is checked whole before anything is staged", () => {
  const notes = JSON.parse(readFileSync(join(PKG, "notes.json"), "utf8"));
  const version = stageable()[1];
  const starters = readdirSync(join(PKG, "adapters")).filter((n) => existsSync(join(PKG, "adapters", n, "index.mjs")));
  assert.doesNotThrow(() => checkNotes(notes, { version, starters }));
  const bad = (edit, re) => {
    const n = structuredClone(notes);
    edit(n);
    assert.throws(() => checkNotes(n, { version, starters }), re);
  };
  bad((n) => (n.notes = 2), /"notes" must be 1/);
  bad((n) => n.versions.reverse(), /must come after|first version is 0\.1\.0/);
  bad((n) => n.versions.push(structuredClone(n.versions.at(-1))), /must come after/);
  bad((n) => delete n.versions[1].summary, /versions\[1\]\.summary must be a non-empty string/);
  bad((n) => (n.versions[1].version = "0.2"), /versions\[1\]\.version must be X\.Y\.Z/);
  bad((n) => (n.versions[1].starters.rails = n.versions[1].starters.supabase), /names 'rails', which is not a starter of this library/);
  bad((n) => (n.versions[1].starters.supabase.fixes = []), /fixes must be a non-empty list/);
  bad((n) => delete n.versions[1].starters.supabase.fixes[0].moves, /fixes\[0\]\.moves must be a non-empty string/);
  bad((n) => (n.versions[1].starters.sqlalchemy.fixes[0].who = " "), /fixes\[0\]\.who must be a non-empty string/);
  bad((n) => (n.versions[0].starters = { generic: { fixes: [{ what: "x", who: "y", moves: "z" }] } }), /the first version is 0\.1\.0, the baseline, with no starters/);
  const before = notes.versions.at(-2).version.replaceAll(".", "\\.");
  bad((n) => n.versions.pop(), new RegExp(`the last version is ${before}, but package\\.json says`));
});
