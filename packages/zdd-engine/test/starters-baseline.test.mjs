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
// Held here: the baseline imports nothing outside its folder; an engine
// whose catalogue has the baseline in place of today's two derives every
// engine fixture to the same bytes; and its own tests pass.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
    assert.equal(out.baseline.status, out.today.status, `${fixture}: ${out.baseline.out}`);
    assert.equal(out.baseline.out, out.today.out, `${fixture}: what derive prints`);
    assert.deepEqual([...out.baseline.tree.keys()], [...out.today.tree.keys()], `${fixture}: the record files`);
    for (const [rel, text] of out.today.tree) assert.equal(out.baseline.tree.get(rel), text, `${fixture}: ${rel}`);
    if ([...out.today.tree.keys()].some((k) => /^(table|data-access)\//.test(k))) read++;
  }
  assert.ok(read >= 3, "the fixtures hold tables and data access for the two to read");
});

test("the baseline's own tests pass on the baseline", () => {
  const files = readdirSync(join(BASE, "tests")).filter((n) => n.endsWith(".test.mjs")).map((n) => join(BASE, "tests", n));
  assert.ok(files.length >= 2);
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
