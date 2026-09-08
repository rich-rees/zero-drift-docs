// The freshness nudge's "advisory means advisory" contract against every
// checkout shape (DIO-313 review CR-011..CR-016): exit 0 with one line when
// there is nothing to compare; NUL-delimited git paths; adopter-relative
// paths inside a larger checkout; symlinked and oversized store files
// ignored; table cells escaped.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync, symlinkSync, appendFileSync, realpathSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { cell, changedAgainstBase } from "../src/check-freshness.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (cwd, msg) => {
  git(cwd, "add", "-A");
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", msg);
};
const engine = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
const ok = (r, msg) => {
  assert.equal(r.status, 0, `${msg}: exit ${r.status} ${r.stderr}`);
  return r.stdout;
};
// A derived fixture copy committed on main with a fake origin/main.
function mkRepo({ remote = true, derive = true } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-fresh-h-"));
  cpSync(FIXTURE, repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "core.quotepath", "true");
  if (derive) ok(engine(repo, "derive"), "derive");
  commit(repo, "base");
  if (remote) git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(repo, "checkout", "-q", "-b", "work");
  return repo;
}

test("CR-011: exit 0 with one line when there is no git, no base, an unborn branch, or `--base` has no value", () => {
  const noGit = mkdtempSync(join(tmpdir(), "zdd-fresh-nogit-"));
  cpSync(FIXTURE, noGit, { recursive: true });
  let out = ok(engine(noGit, "freshness"), "no git");
  assert.match(out, /^No git checkout here/);
  assert.equal(out.trim().split("\n").length, 1);

  const noBase = mkRepo({ remote: false });
  git(noBase, "branch", "-m", "main", "trunk"); // no origin/main, no local main
  out = ok(engine(noBase, "freshness"), "no base");
  assert.match(out, /^No base to diff against \(tried origin\/main, main\)/);
  out = ok(engine(noBase, "freshness", "--base", "trunk"), "explicit base that exists");
  assert.match(out, /No changes against trunk/);
  out = ok(engine(noBase, "freshness", "--base", "nonesuch"), "explicit base that does not");
  assert.match(out, /^No base to diff against \(tried nonesuch\)/);
  out = ok(engine(noBase, "freshness", "--base"), "--base without a value");
  assert.match(out, /`--base` needs a ref/);
  out = ok(engine(noBase, "freshness", "--base", "--verbose"), "--base followed by another flag");
  assert.match(out, /`--base` needs a ref/);

  const unborn = mkdtempSync(join(tmpdir(), "zdd-fresh-unborn-"));
  cpSync(FIXTURE, unborn, { recursive: true });
  git(unborn, "init", "-q", "-b", "main");
  out = ok(engine(unborn, "freshness"), "unborn branch");
  assert.match(out, /nothing to compare/);
  for (const d of [noGit, noBase, unborn]) rmSync(d, { recursive: true, force: true });
});

test("CR-011: origin/<base> is preferred, the local branch is the fallback", () => {
  const repo = mkRepo({ remote: false });
  appendFileSync(join(repo, "src", "components", "HomePage.tsx"), "\n// touched\n");
  commit(repo, "touch");
  const out = ok(engine(repo, "freshness"), "local main");
  assert.match(out, /possibly stale/);
  assert.match(out, /things\.md/);
  rmSync(repo, { recursive: true, force: true });
});

test("CR-012: a non-ASCII changed filename (C-quoted by default) still matches its resource", () => {
  const repo = mkRepo();
  writeFileSync(join(repo, "src", "components", "Café.tsx"), "export {};\n");
  commit(repo, "unicode");
  const out = ok(engine(repo, "freshness", "--base", "main"), "quoted name");
  assert.match(out, /\| `zdd\/map\/features\/things\.md` \| src\/components\/Café\.tsx \| `resource:` \|/);
  rmSync(repo, { recursive: true, force: true });
});

test("CR-016: an adopter root inside a larger checkout compares adopter-relative paths, and sibling changes are ignored", () => {
  const mono = mkdtempSync(join(tmpdir(), "zdd-fresh-mono-"));
  const app = join(mono, "packages", "app");
  mkdirSync(join(mono, "packages", "other"), { recursive: true });
  cpSync(FIXTURE, app, { recursive: true });
  writeFileSync(join(mono, "packages", "other", "x.ts"), "");
  git(mono, "init", "-q", "-b", "main");
  ok(engine(app, "derive"), "derive");
  commit(mono, "base");
  git(mono, "checkout", "-q", "-b", "work");
  writeFileSync(join(mono, "packages", "other", "x.ts"), "changed");
  commit(mono, "sibling");
  let out = ok(engine(app, "freshness", "--base", "main"), "sibling only");
  const debug = () =>
    JSON.stringify({ top: git(app, "rev-parse", "--show-toplevel"), realTop: realpathSync(git(app, "rev-parse", "--show-toplevel")), app, realApp: realpathSync(app), diff: changedAgainstBase(app, "main", "main") });
  assert.match(out, /No changes against main/, `the sibling change is not this adopter's: ${debug()}`);
  appendFileSync(join(app, "src", "components", "HomePage.tsx"), "\n// touched\n");
  commit(mono, "app");
  out = ok(engine(app, "freshness", "--base", "main"), "app change");
  assert.match(out, /\| `zdd\/map\/features\/things\.md` \| src\/components\/HomePage\.tsx \|/, "adopter-relative in the table");
  appendFileSync(join(app, "zdd", "map", "features", "things.md"), "\nUpdated.\n");
  appendFileSync(join(app, "zdd", "map", "apps", "fixture-app.md"), "\nUpdated.\n");
  commit(mono, "concepts");
  out = ok(engine(app, "freshness", "--base", "main"), "exempt");
  assert.match(out, /No semantic concepts affected/, "the same-diff exemption matches adopter-relative too");
  const diff = changedAgainstBase(app, "main", "main");
  assert.ok(diff.changed.every((f) => !f.startsWith("packages/")), JSON.stringify(diff));
  rmSync(mono, { recursive: true, force: true });
});

test("CR-013/CR-014: a symlinked concept, a symlinked metadata parent and an oversized record contribute nothing; CR-015: table cells are escaped", (t) => {
  const repo = mkRepo();
  writeFileSync(join(repo, "outside.md"), "---\ntype: Feature\ntitle: o\ndescription: d\nresource: src\ntags: []\n---\n");
  let linked = true;
  try {
    symlinkSync(join(repo, "outside.md"), join(repo, "zdd", "map", "features", "linked.md"), "file");
    mkdirSync(join(repo, "elsewhere"));
    writeFileSync(join(repo, "elsewhere", "evil.json"), JSON.stringify({ resource: ["src/app/page.tsx"] }));
    symlinkSync(join(repo, "elsewhere"), join(repo, "zdd", "metadata", "linkdir"), "junction");
  } catch {
    linked = false;
    t.diagnostic("symlink creation not permitted here");
  }
  writeFileSync(join(repo, "zdd", "metadata", "route", "huge.json"), JSON.stringify({ resource: ["src/app/page.tsx"], pad: "x".repeat(1024 * 1024) }));
  writeFileSync(
    join(repo, "zdd", "map", "features", "probe.md"),
    "---\ntype: Feature\ntitle: p\ndescription: d\nresource: nowhere\ntags: []\n---\n\n- [via link](/metadata/linkdir/evil.json)\n- [huge](/metadata/route/huge.json)\n",
  );
  appendFileSync(join(repo, "src", "app", "page.tsx"), "\n// touched\n");
  writeFileSync(join(repo, "src", "we`ird.ts"), ""); // a pipe is not a legal Windows filename; cell() below covers it
  commit(repo, "touch");
  const out = ok(engine(repo, "freshness", "--base", "main"), "hardened");
  assert.doesNotMatch(out, /linked\.md/, "symlinked concept skipped");
  assert.doesNotMatch(out, /probe\.md/, "neither the symlinked-parent record nor the oversized one watches anything");
  assert.match(out, /we'ird\.ts/, "backtick escaped in the cell");
  assert.equal(cell("a|b`c\x1bd"), "a\\|b'c?d");
  if (!linked) t.diagnostic("link cases not exercised");
  rmSync(repo, { recursive: true, force: true });
});
