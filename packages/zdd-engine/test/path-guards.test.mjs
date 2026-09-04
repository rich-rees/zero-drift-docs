// Path-layout guards at the CLI seam: the configured artifact paths must be
// dedicated and mutually disjoint, and nothing the engine reads, writes or
// prunes may reach through a symlink. Review CR-059 / CR-060 / CR-061 /
// CR-063 / CR-067 / CR-068 (DIO-312 campaign).
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, existsSync, readdirSync, statSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

const mkRepo = (fixture) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-guard-"));
  cpSync(fixture, repo, { recursive: true });
  return repo;
};
const run = (repo, args) =>
  execFileSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const runFail = (repo, args) => {
  try {
    run(repo, args);
  } catch (err) {
    return String(err.stderr);
  }
  assert.fail(`expected non-zero exit for ${args.join(" ")}`);
};
const readConfig = (repo) => JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
const writeConfig = (repo, config) => writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(config, null, 2));
const withPaths = (repo, paths) => writeConfig(repo, { ...readConfig(repo), paths });
const tree = (dir, base = dir, out = new Map()) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tree(p, base, out);
    else out.set(relative(base, p).split(/[\\/]/).join("/"), readFileSync(p, "utf8"));
  }
  return out;
};

// ---------------------------------------------------------------------------
// CR-059: derive prunes metadataDir, so metadataDir must be a dedicated folder.
// ---------------------------------------------------------------------------

test("CR-059: a metadataDir that contains, equals or sits inside another configured path is refused before anything is read or pruned", () => {
  const repo = mkRepo(FIXTURE);
  writeFileSync(join(repo, "zdd", "unrelated.json"), "{}\n");
  const snapshot = () => {
    const t = tree(join(repo, "zdd"));
    t.delete("config.json"); // the test rewrites it between cases
    return t;
  };
  const before = snapshot();
  const cases = [
    [{ metadataDir: "zdd" }, /paths\.metadataDir 'zdd' overlaps/], // contains config.json, glossary, map, adr, outputs
    [{ metadataDir: "." }, /paths\.metadataDir '\.' overlaps/],
    [{ metadataDir: "zdd/map" }, /paths\.metadataDir 'zdd\/map' overlaps paths\.mapDir/],
    [{ metadataDir: "zdd/adr/derived" }, /paths\.metadataDir 'zdd\/adr\/derived' overlaps paths\.adrDir/],
    [{ metadataDir: "zdd/glossary.md" }, /paths\.metadataDir 'zdd\/glossary\.md' overlaps paths\.glossary/],
    [{ metadataDir: "out", graph: "out/graph.json" }, /paths\.metadataDir 'out' overlaps paths\.graph/],
  ];
  for (const [paths, re] of cases) {
    withPaths(repo, paths);
    const err = runFail(repo, ["derive"]);
    assert.match(err, re, JSON.stringify(paths));
    assert.match(err, /dedicated/, "the error says why");
  }
  assert.deepEqual(snapshot(), before, "nothing under zdd/ was touched");
  rmSync(repo, { recursive: true, force: true });
});

test("CR-059: derive refuses to prune a folder holding JSON it did not write; non-JSON bystanders are left alone", () => {
  const repo = mkRepo(FIXTURE);
  // `src` overlaps no configured path, so only the content rule can save it:
  // a top-level .json and a directory nested below a kind-shaped folder are
  // both shapes derive never writes. (`src/lib/data.json` IS record-shaped;
  // the rule is honest about that — it is the folder as a whole that is refused.)
  mkdirSync(join(repo, "src", "lib"), { recursive: true });
  writeFileSync(join(repo, "src", "tsconfig.json"), '{"compilerOptions":{}}\n');
  writeFileSync(join(repo, "src", "lib", "data.json"), "[1]\n");
  const before = tree(join(repo, "src"));
  withPaths(repo, { metadataDir: "src" });
  const err = runFail(repo, ["derive"]);
  assert.match(err, /src.*not a dedicated metadata folder/s, err);
  assert.match(err, /tsconfig\.json/, "names the foreign file");
  assert.match(err, /app\/api\//, "names the foreign nested directory");
  assert.deepEqual(tree(join(repo, "src")), before, "src/ untouched — data.json included");
  // --check is refused the same way, never silently green.
  assert.match(runFail(repo, ["derive", "--check"]), /not a dedicated metadata folder/);

  // A README / .gitkeep beside the kind folders is not derive's business:
  // never read, never pruned, never an error.
  withPaths(repo, { metadataDir: "zdd/metadata" });
  mkdirSync(join(repo, "zdd", "metadata", "route"), { recursive: true });
  writeFileSync(join(repo, "zdd", "metadata", "README.md"), "generated — do not edit\n");
  writeFileSync(join(repo, "zdd", "metadata", "route", ".gitkeep"), "");
  writeFileSync(join(repo, "zdd", "metadata", "route", "stale.json"), "{}\n");
  assert.match(run(repo, ["derive"]), /Wrote 15 records/);
  assert.ok(existsSync(join(repo, "zdd", "metadata", "README.md")));
  assert.ok(existsSync(join(repo, "zdd", "metadata", "route", ".gitkeep")));
  assert.ok(!existsSync(join(repo, "zdd", "metadata", "route", "stale.json")), "a stale <kind>/*.json is still pruned");
  assert.match(run(repo, ["derive", "--check"]), /in sync/);
  // A stray .json at the top level, or a folder that is not a kind, is foreign.
  writeFileSync(join(repo, "zdd", "metadata", "notes.json"), "{}\n");
  assert.match(runFail(repo, ["derive"]), /notes\.json/);
  rmSync(join(repo, "zdd", "metadata", "notes.json"));
  mkdirSync(join(repo, "zdd", "metadata", "Archive"));
  writeFileSync(join(repo, "zdd", "metadata", "Archive", "old.json"), "{}\n");
  assert.match(runFail(repo, ["derive"]), /Archive\//);
  assert.ok(existsSync(join(repo, "zdd", "metadata", "Archive", "old.json")));
  rmSync(repo, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CR-061: the four render outputs are written last and unconditionally, so
// they must be pairwise distinct and disjoint from everything render reads.
// ---------------------------------------------------------------------------

test("CR-061: render refuses outputs that coincide with each other or with an input, before reading or writing anything", () => {
  const repo = mkRepo(FIXTURE);
  run(repo, ["derive"]);
  const glossaryBefore = readFileSync(join(repo, "zdd", "glossary.md"), "utf8");
  const cases = [
    [{ graph: "zdd/same.out", humanIndex: "zdd/same.out" }, /paths\.graph 'zdd\/same\.out' .*paths\.humanIndex/],
    [{ agentIndex: "zdd/adr-index.md" }, /paths\.agentIndex 'zdd\/adr-index\.md' .*paths\.adrIndex/],
    [{ humanIndex: "zdd/glossary.md" }, /paths\.humanIndex 'zdd\/glossary\.md' overlaps paths\.glossary/],
    [{ agentIndex: "zdd/config.json" }, /paths\.agentIndex 'zdd\/config\.json' overlaps the config file/],
    [{ adrIndex: "zdd/adr/index.md" }, /paths\.adrIndex 'zdd\/adr\/index\.md' overlaps paths\.adrDir/],
    [{ graph: "zdd/map/graph.json" }, /paths\.graph 'zdd\/map\/graph\.json' overlaps paths\.mapDir/],
    [{ humanIndex: "zdd/metadata/index.html" }, /overlaps/],
  ];
  for (const [paths, re] of cases) {
    withPaths(repo, paths);
    const err = runFail(repo, ["render"]);
    assert.match(err, re, JSON.stringify(paths));
    assert.ok(!existsSync(join(repo, "zdd", "same.out")), "no output written");
    assert.ok(!existsSync(join(repo, "zdd", "adr", "index.md")), "no output written into adrDir");
  }
  assert.equal(readFileSync(join(repo, "zdd", "glossary.md"), "utf8"), glossaryBefore, "glossary never clobbered");
  assert.match(readFileSync(join(repo, "zdd", "config.json"), "utf8"), /"name": "Fixture App"/, "config never clobbered");
  // A legal relocation still works and --check stays green.
  withPaths(repo, { graph: "docs/graph.json", humanIndex: "docs/index.html", agentIndex: "docs/agent.md", adrIndex: "docs/adrs.md" });
  mkdirSync(join(repo, "docs"));
  run(repo, ["render"]);
  assert.match(run(repo, ["render", "--check"]), /in sync/);
  rmSync(repo, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CR-063: the glossary is embedded verbatim in the hosted page, so it must be
// a regular markdown file — never a symlink, never `.env`.
// ---------------------------------------------------------------------------

// Create a symlink, or skip the test (narrated) where the OS refuses — Windows
// without Developer Mode returns EPERM; Linux CI exercises the guard.
const symlinkOrSkip = (t, target, path, type) => {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (e) {
    if (e.code !== "EPERM") throw e;
    t.skip("symlink creation needs privileges on this machine (EPERM)");
    return false;
  }
};
const noLeak = (repo) => {
  for (const f of ["human-index.html", "graph.json", "agent-index.md", "adr-index.md"]) {
    const p = join(repo, "zdd", f);
    if (existsSync(p)) assert.ok(!readFileSync(p, "utf8").includes("hunter2"), `${f} does not embed the sentinel`);
  }
};

test("CR-063: paths.glossary naming a non-markdown file is refused, and the sentinel is embedded nowhere", () => {
  const repo = mkRepo(FIXTURE);
  run(repo, ["derive"]);
  writeFileSync(join(repo, ".env"), "SECRET_TOKEN=hunter2\n");
  withPaths(repo, { glossary: ".env" });
  const err = runFail(repo, ["render"]);
  assert.match(err, /paths\.glossary '\.env' must be a regular \.md file/);
  noLeak(repo);
  // A directory is not a glossary either.
  withPaths(repo, { glossary: "zdd/map" });
  assert.match(runFail(repo, ["render"]), /paths\.glossary 'zdd\/map' must be a regular \.md file/);
  // A missing glossary is still greenfield: render exits 0 with an empty embed.
  withPaths(repo, { glossary: "zdd/not-yet.md" });
  run(repo, ["render"]);
  rmSync(repo, { recursive: true, force: true });
});

test("CR-063: a symlinked glossary.md is refused, not followed", (t) => {
  const repo = mkRepo(FIXTURE);
  run(repo, ["derive"]);
  const secret = join(repo, "secret.md");
  writeFileSync(secret, "# Terms\n\nTOKEN=hunter2\n");
  rmSync(join(repo, "zdd", "glossary.md"));
  if (!symlinkOrSkip(t, secret, join(repo, "zdd", "glossary.md"), "file")) {
    rmSync(repo, { recursive: true, force: true });
    return;
  }
  const err = runFail(repo, ["render"]);
  assert.match(err, /paths\.glossary 'zdd\/glossary\.md' must be a regular \.md file, not a symlink/);
  noLeak(repo);
  rmSync(repo, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CR-060: derive's containment was lexical; a symlinked metadataDir (or a
// linked ancestor) carried the writes and the prune anywhere the user can
// reach. Realpath containment before scan/write/prune; links inside skipped.
// ---------------------------------------------------------------------------

test("CR-060: a metadataDir that is a symlink, or sits under one, pointing outside the repo is refused before scan, write or prune", (t) => {
  const repo = mkRepo(FIXTURE);
  const outside = mkdtempSync(join(tmpdir(), "zdd-outside-"));
  mkdirSync(join(outside, "route"));
  writeFileSync(join(outside, "route", "victim.json"), "{}\n");
  const before = tree(outside);
  // Junction type: the only directory-link Windows creates without privileges;
  // ignored (plain symlink) elsewhere.
  if (!symlinkOrSkip(t, outside, join(repo, "zdd", "metadata"), "junction")) {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    return;
  }
  let err = runFail(repo, ["derive"]);
  assert.match(err, /metadataDir 'zdd\/metadata' .*(symlink|outside the repo)/, err);
  assert.deepEqual(tree(outside), before, "nothing written or pruned through the link");
  assert.match(runFail(repo, ["derive", "--check"]), /metadataDir 'zdd\/metadata' .*(symlink|outside the repo)/);
  rmSync(join(repo, "zdd", "metadata"));
  // A linked ANCESTOR of a not-yet-existing metadataDir: realpath of the nearest
  // existing ancestor decides.
  symlinkSync(outside, join(repo, "linked"), "junction");
  withPaths(repo, { metadataDir: "linked/derived" });
  err = runFail(repo, ["derive"]);
  assert.match(err, /metadataDir 'linked\/derived' (sits under a symlink|.*outside the repo)/, err);
  assert.deepEqual(tree(outside), before, "nothing written through the linked ancestor");
  rmSync(repo, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("CR-060: a symlink inside metadataDir is neither read, overwritten nor pruned — skipped with a --verbose note", (t) => {
  const repo = mkRepo(FIXTURE);
  const secret = join(repo, "secret.json");
  writeFileSync(secret, '{"token":"hunter2"}\n');
  mkdirSync(join(repo, "zdd", "metadata", "route"), { recursive: true });
  if (!symlinkOrSkip(t, secret, join(repo, "zdd", "metadata", "route", "leak.json"), "file")) {
    rmSync(repo, { recursive: true, force: true });
    return;
  }
  const { status, stderr } = spawnSync(process.execPath, [BIN, "derive", "--verbose"], { cwd: repo, encoding: "utf8" });
  assert.equal(status, 0, stderr);
  assert.match(stderr, /zdd\/metadata\/route\/leak\.json is a symlink — skipped/);
  assert.equal(readFileSync(secret, "utf8"), '{"token":"hunter2"}\n', "target untouched");
  assert.ok(lstatSync(join(repo, "zdd", "metadata", "route", "leak.json")).isSymbolicLink(), "link left in place, not pruned");
  assert.match(run(repo, ["derive", "--check"]), /in sync/);
  rmSync(repo, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CR-068 / CR-099: a mistyped store dir lints and renders as an empty corpus,
// indistinguishable from greenfield. One stderr line when the bundle is
// otherwise populated; silence — and exit 0 — when it is truly greenfield.
// ---------------------------------------------------------------------------

const FIXTURE_GREENFIELD = join(PKG, "test", "fixture-greenfield");
const spawn = (repo, args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });

test("CR-068/CR-099: an absent store dir in a populated bundle is noted on stderr by lint and render, exit 0; greenfield stays silent", () => {
  const repo = mkRepo(FIXTURE);
  run(repo, ["derive"]);
  withPaths(repo, { adrDir: "zdd/decisions" }); // typo for zdd/adr
  let out = spawn(repo, ["lint"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stderr, /^WARNING: paths\.adrDir 'zdd\/decisions' does not exist.*not greenfield/m, out.stderr);
  assert.match(out.stdout, /store lints passed/);
  out = spawn(repo, ["render"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stderr, /^WARNING: paths\.adrDir 'zdd\/decisions' does not exist/m, out.stderr);
  // The same note for a mistyped map or metadata dir (render reads all three).
  withPaths(repo, { mapDir: "zdd/maps" });
  out = spawn(repo, ["render"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stderr, /^WARNING: paths\.mapDir 'zdd\/maps' does not exist/m, out.stderr);
  assert.ok(!/^WARNING: paths\.adrDir/m.test(out.stderr), "only the absent one gets a line");
  rmSync(repo, { recursive: true, force: true });

  const green = mkRepo(FIXTURE_GREENFIELD);
  for (const args of [["derive"], ["lint"], ["render"]]) {
    const o = spawn(green, args);
    assert.equal(o.status, 0, o.stderr);
    assert.ok(!/WARNING/.test(o.stderr), `${args[0]} on greenfield: ${o.stderr}`);
  }
  rmSync(green, { recursive: true, force: true });
});
