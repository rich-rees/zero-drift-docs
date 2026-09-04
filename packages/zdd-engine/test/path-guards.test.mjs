// Path-layout guards at the CLI seam: the configured artifact paths must be
// dedicated and mutually disjoint, and nothing the engine reads, writes or
// prunes may reach through a symlink. Review CR-059 / CR-060 / CR-061 /
// CR-063 / CR-067 / CR-068 (DIO-312 campaign).
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
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
