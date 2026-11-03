// The baseline (decision 0048, As built slice 2 and 3): `supabase` and
// `sqlalchemy` as they were at commit 419293d, the readers that reproduce
// adopters' records, in the self-contained form an app holds. The starter
// library's first version publishes them (slice 4), and "upgrade ZDD"
// copies them first and proves the records byte-identical (slice 5) before
// it offers the fixes. They live under test/, so the catalogue never runs
// them; only these tests do.
//
// test/starters-baseline/ is laid out as an app holds its adapters:
//   supabase/, sqlalchemy/   the adapter folders, imports rewired only
//   _shared/                 exactly the shared files their imports reach
//   tests/                   their own tests at 419293d, through the kit
//
// Held here: every file's bytes, pinned (a change is a deliberate, narrated
// step, as a golden's is); the baseline imports nothing outside its folder
// save the kit, the one file an app provides; an engine whose catalogue has
// the baseline in place of today's two derives every engine fixture to the
// same bytes; and its own tests pass.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { moduleReach } from "../src/core/lib/suite.mjs";
import { repoRelative as coreRepoRelative } from "../src/core/lib/paths.mjs";
import { repoRelative as sharedRepoRelative } from "../src/adapters/_shared/paths.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = join(PKG, "test", "starters-baseline");
const ADAPTERS = ["supabase", "sqlalchemy"];

const walk = (dir) => readdirSync(dir).sort().flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const tree = (dir) => new Map(existsSync(dir) ? walk(dir).map((p) => [relative(dir, p).split(sep).join("/"), readFileSync(p, "utf8")]) : []);

// Every file of the baseline and its SHA-256, line endings as LF. Made from
// `git show 419293d:packages/zdd-engine/…` with only these edits: an import
// of `../../core/lib/paths.mjs` or `data-access.mjs` reads `../_shared/…`,
// `../python/` reads `../_shared/python/`, one comment's path likewise; in
// the tests, the adapter is `../<name>/` and the io comes from the kit
// (`ioFor` for `makeExtractorIo`, `trialRead` for `detectRepo`), and the
// core's coverage half of supabase-formats is left to the engine.
// `_shared/` is the files of today's `_shared/` the two reach, unchanged
// since 419293d (paths.mjs holds the core's `repoRelative`). CR-282.
const PINNED = {
  "_shared/data-access.mjs": "4023bfeb680e947d2f6f363d1b7371a855877abdbb5581c6d876dd2e04d1c837",
  "_shared/paths.mjs": "a8f62c77bab9158ed81f6b09213d5ba23528e7e7b27c0185999ce10f4aff23a5",
  "_shared/python/detect.mjs": "35cf24881b6d752beac2f34fc77e8011fd83aed9a55bf353a25b8058ea2dd1a1",
  "_shared/python/imports.mjs": "bfa09d1a1a4edbb74f001e04449d28d2c7fb04ec94b9256ecee7922558dc99b6",
  "_shared/python/source.mjs": "df507325e4abaa84989c44a504f8276a6b81eb8ab48b8ea6eda12d8f6c7c13f5",
  "_shared/slug.mjs": "f12e048774607b984acbfad0d308c963792d33c3a3542c920349663733715343",
  "sqlalchemy/detect.mjs": "10ce2a2cd8677fdbc2c8d2d907f14ca5029ce7a31c4682deea6effaa3cd60fad",
  "sqlalchemy/index.mjs": "a1d777aad89ab2e9113397b95821afb4b00ac9bd4ac9833c65631d858e2167fc",
  "supabase/detect.mjs": "236e742401fbf1ae7eb09f5e80b4b7b1b2a7b91e6798c72f00a3fab4f3aa55d0",
  "supabase/example/supabase/migrations/0001_things.sql": "95cd7cdff48b97c696685c6cffdb8bf2fa22ad3b16a2ee13e5bed6ac220028a6",
  "supabase/index.mjs": "23140ecd221e1133f7aba2f8abaf6e10ca591dffea8a84beb44810e6e890164c",
  "supabase/sql-replay.mjs": "d152ca312ad6a2b9b5645b047b3d6cb70aeacc78ca1484148a7e9cd2ad721f4e",
  "tests/adapter-kit.mjs": "d385d1c477d2ee79df5f233d166bd18dbebbd6396153b1bfccbdfe82b5c66aa8",
  "tests/sql-replay.test.mjs": "01a823db374d6c02aee665426700196d6cd7a962aa18bf842d32d4340ed44412",
  "tests/supabase-formats.test.mjs": "b962b2d3e7269092f7987bf7392808f100d0471a79dd5b7b62a8c3dc16cec7a1",
  "tests/supabase.test.mjs": "d0ad6da085689d65e136827be6ed72e8a298d545ed856e8ce8342919f59a53d8",
};

test("the baseline's every file is pinned to its bytes: nothing added, dropped or edited (CR-282)", () => {
  const got = Object.fromEntries(walk(BASE).map((p) => [relative(BASE, p).split(sep).join("/"), createHash("sha256").update(readFileSync(p, "utf8").replace(/\r\n/g, "\n")).digest("hex")]));
  assert.deepEqual(got, PINNED);
});

test("the baseline is self-contained: its adapters reach only themselves and _shared/, and _shared/ holds only what they reach", () => {
  const reached = new Set();
  for (const name of ADAPTERS) {
    for (const p of walk(join(BASE, name)).filter((f) => f.endsWith(".mjs"))) {
      const r = moduleReach(p, BASE);
      assert.deepEqual([r.outside, r.missing], [[], []], p);
      for (const f of r.files) {
        assert.ok(f.startsWith(join(BASE, name) + sep) || f.startsWith(join(BASE, "_shared") + sep), `${p} reaches ${f}`);
        reached.add(f);
      }
    }
  }
  assert.deepEqual(walk(join(BASE, "_shared")), [...reached].filter((f) => f.startsWith(join(BASE, "_shared") + sep)).sort());
  // Its tests reach the baseline and the kit, and the kit is the one file
  // that leaves it: the seam an app provides (CR-285).
  for (const p of walk(join(BASE, "tests")).filter((f) => f.endsWith(".mjs"))) {
    const r = moduleReach(p, BASE);
    assert.deepEqual(r.missing, [], p);
    const viaKit = r.files.includes(join(BASE, "tests", "adapter-kit.mjs"));
    assert.deepEqual(r.outside, viaKit ? ["tests/adapter-kit.mjs imports ../../adapter-kit.mjs"] : [], p);
  }
});

test("an engine with the baseline in its catalogue derives every engine fixture to the same bytes", (t) => {
  // A copy of the engine, the two adapters and the shared files they reach
  // swapped for the baseline's.
  const engine = mkdtempSync(join(tmpdir(), "zdd-baseline-engine-"));
  t.after(() => rmSync(engine, { recursive: true, force: true }));
  for (const part of ["bin", "src", "package.json"]) cpSync(join(PKG, part), join(engine, part), { recursive: true });
  for (const name of ADAPTERS) {
    rmSync(join(engine, "src", "adapters", name), { recursive: true, force: true });
    cpSync(join(BASE, name), join(engine, "src", "adapters", name), { recursive: true });
  }
  cpSync(join(BASE, "_shared"), join(engine, "src", "adapters", "_shared"), { recursive: true });

  const fixtures = readdirSync(join(PKG, "test")).filter((n) => n.startsWith("fixture") && existsSync(join(PKG, "test", n, "zdd", "config.json"))).sort();
  let read = 0;
  for (const fixture of fixtures) {
    const out = {};
    for (const [label, bin] of [["today", join(PKG, "bin", "zdd-engine.mjs")], ["baseline", join(engine, "bin", "zdd-engine.mjs")]]) {
      const repo = mkdtempSync(join(tmpdir(), "zdd-baseline-repo-"));
      t.after(() => rmSync(repo, { recursive: true, force: true }));
      cpSync(join(PKG, "test", fixture), repo, { recursive: true });
      const r = spawnSync(process.execPath, [bin, "derive", `--root=${repo}`], { encoding: "utf8" });
      out[label] = { status: r.status, out: `${r.stdout}${r.stderr}`.replaceAll(repo, "<repo>"), tree: tree(join(repo, "zdd", "metadata")) };
    }
    assert.equal(out.today.status, 0, `${fixture}, today: ${out.today.out}`);
    assert.equal(out.baseline.status, 0, `${fixture}, baseline: ${out.baseline.out}`);
    assert.equal(out.baseline.out, out.today.out, `${fixture}: what derive prints`);
    assert.deepEqual([...out.baseline.tree.keys()], [...out.today.tree.keys()], `${fixture}: the record files`);
    for (const [rel, text] of out.today.tree) assert.equal(out.baseline.tree.get(rel), text, `${fixture}: ${rel}`);
    if ([...out.today.tree.keys()].some((k) => /^(table|data-access)\//.test(k))) read++;
  }
  assert.ok(read >= 3, "the fixtures hold tables and data access for the two to read");
});

test("the baseline's own tests pass on the baseline", () => {
  const names = readdirSync(join(BASE, "tests")).filter((n) => n.endsWith(".test.mjs")).sort();
  // supabase's own tests at 419293d, every one (CR-280); sqlalchemy's were
  // in data-access.test.mjs, which reads the core's resolution, and stay.
  assert.deepEqual(names, ["sql-replay.test.mjs", "supabase-formats.test.mjs", "supabase.test.mjs"]);
  const files = names.map((n) => join(BASE, "tests", n));
  const r = spawnSync(process.execPath, ["--test", ...files], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout.split("\n").filter((l) => l.startsWith("not ok")).join("\n"));
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
