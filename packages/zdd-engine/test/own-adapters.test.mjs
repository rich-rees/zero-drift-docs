// The core with the repo's own adapters only (decision 0048 points 1 to 3,
// As built slice 4): the engine ships no adapter, so derive runs what
// localExtractorDir holds and tells a config naming anything else where
// adapters come from; detect, preview and `zdd-engine test` work from a
// folder of adapters they are given; and the kit, the package's public
// entry, hands an adapter's tests the io and the scan. Driven over the
// engine's own test-only adapters (test/adapters/), which name no stack.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ioFor, scanFor, trialRead } from "../src/core/kit.mjs";
import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";
import * as notes from "./adapters/notes/index.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const ADAPTERS = join(PKG, "test", "adapters");
const FIXTURE = join(PKG, "test", "fixture");

const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", ...opts });
const scratch = (t, prefix = "zdd-own-") => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const put = (root, files) => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
};
// The fixture as an app holds it: its adapters in zdd/extractors.
function app(t) {
  const repo = scratch(t, "zdd-own-app-");
  cpSync(FIXTURE, repo, { recursive: true });
  cpSync(ADAPTERS, join(repo, "zdd", "extractors"), { recursive: true });
  put(repo, { "notes/api.note": "GET /things\nGET /health\n" });
  // The map links what these adapters read: one route of the fixture's.
  const page = join(repo, "zdd", "map", "features", "things.md");
  writeFileSync(page, readFileSync(page, "utf8").replace(/\n- \[.*$/s,"\n- [/api/things](../../metadata/route/things.json)\n"));
  return repo;
}

test("derive, render and lint run the repo's own adapters, and nothing else", (t) => {
  const repo = app(t);
  const d = run(["derive", `--root=${repo}`]);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /Wrote 2 records \(2 routes\)/);
  assert.equal(run(["derive", "--check", `--root=${repo}`]).status, 0);
  const r = run(["render", `--root=${repo}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(repo, "zdd", "human-index.html")));
  assert.equal(run(["render", "--check", `--root=${repo}`]).status, 0);
  const l = run(["lint", `--root=${repo}`]);
  assert.equal(l.status, 0, l.stderr);
});

test("a name the repo does not hold stops derive with the route across, never a crash, and writes nothing", (t) => {
  const repo = app(t);
  const p = join(repo, "zdd", "config.json");
  writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, "utf8")), extractors: ["notes", "elsewhere"] }));
  const d = run(["derive", `--root=${repo}`]);
  assert.equal(d.status, 1);
  assert.match(d.stderr, /^Extractor 'elsewhere' is not one of this repo's adapters: localExtractorDir \(zdd\/extractors\) holds lists, notes\. Since ZDD 0\.14 a repo owns every adapter it runs and the engine ships none\. If an older ZDD ran 'elsewhere' for you, say "upgrade ZDD": it copies the adapter into the repo, from the starter library \(npm @rich-rees\/zdd-starter-adapters\), and proves the records unchanged\. Otherwise build it with the extractor skill, or take it out of "extractors"\.\n$/);
  assert.ok(!existsSync(join(repo, "zdd", "metadata")));
});

test("detect asks the folder it is given, or the repo's own localExtractorDir, and says so when there is neither", (t) => {
  const root = scratch(t);
  put(root, { "notes/a.note": "GET /a\n", "data/x.list": "x\n" });
  const given = run(["detect", `--adapters=${ADAPTERS}`, `--root=${root}`]);
  assert.equal(given.status, 0, given.stderr);
  const out = JSON.parse(given.stdout);
  assert.deepEqual(out.proposals.map((p) => [p.name, p.parts, p.options]), [["notes", ["routes"], { roots: ["notes"] }], ["lists", ["schema"], {}]]);
  assert.ok(!existsSync(join(root, "zdd")), "detect writes nothing");
  const none = run(["detect", `--root=${root}`]);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /detect: no adapters to ask — pass --adapters=<folder of adapters> \(the starter library's adapters\/, npm @rich-rees\/zdd-starter-adapters\), or set localExtractorDir in zdd\/config\.json; the engine ships no adapter of its own/);
  const repo = app(t);
  const own = run(["detect", `--root=${repo}`]);
  assert.equal(own.status, 0, own.stderr);
  assert.deepEqual(JSON.parse(own.stdout).proposals.map((p) => p.name), ["notes"], "the repo's own adapters, from its config");
  const missing = run(["detect", `--adapters=${join(root, "nowhere")}`, `--root=${root}`]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /detect: the adapter folder .*nowhere does not exist/);
});

test("preview renders the chosen adapters' examples from the folder it is given, each copied with what it reaches; an unknown name or no folder is refused", (t) => {
  const root = scratch(t);
  const out = join(scratch(t, "zdd-own-preview-"), "p");
  const r = run(["preview", `--adapters=${ADAPTERS}`, "--extractors=notes,lists", `--root=${root}`, `--out=${out}`, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.deepEqual([got.used, got.skipped], [["notes"], ["lists"]], "lists ships no example");
  assert.ok(existsSync(got.humanIndex));
  assert.deepEqual(readdirSync(join(out, "zdd", "extractors")).sort(), ["_shared", "notes"]);
  assert.ok(existsSync(join(out, "zdd", "extractors", "_shared", "words.mjs")), "the shared file notes reaches travels");
  assert.ok(!existsSync(join(out, "zdd", "extractors", "notes", "test")), "its tests, fixture and example stay behind");
  assert.ok(!existsSync(join(out, "zdd", "extractors", "notes", "fixture")));
  assert.match(readFileSync(join(out, "zdd", "metadata", "route", "hello.json"), "utf8"), /"route:\/hello"/);
  const typo = run(["preview", `--adapters=${ADAPTERS}`, "--extractors=notez", `--root=${root}`]);
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /notez is not an adapter in .*adapters \(it holds: lists, notes\)/);
  const bare = run(["preview", "--extractors=notes", `--root=${root}`]);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /--adapters=<dir> names the folder of adapters to preview from/);
});

test("zdd-engine test runs the tests that travel with a folder's adapters, the kit resolvable by the package's name; a folder with none to run fails", (t) => {
  const r = run(["test", `--adapters=${ADAPTERS}`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok 1 - notes: a GET line is a route/m);
  assert.match(r.stdout, /^# pass 1$/m);
  const empty = scratch(t);
  cpSync(join(ADAPTERS, "lists"), join(empty, "lists"), { recursive: true });
  const none = run(["test", `--adapters=${empty}`]);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /test: no adapter in .* has a test\/ folder of \*\.test\.mjs files — nothing to run/);
  // A failing test fails the command.
  const red = scratch(t);
  cpSync(ADAPTERS, red, { recursive: true });
  writeFileSync(join(red, "notes", "test", "red.test.mjs"), 'import { test } from "node:test";\ntest("red", () => { throw new Error("no"); });\n');
  assert.equal(run(["test", `--adapters=${red}`]).status, 1);
  // Without --adapters: the repo's own localExtractorDir.
  const repo = app(t);
  assert.equal(run(["test", `--root=${repo}`]).status, 0);
});

test("the kit: ioFor is derive's io; scanFor skips the folders every adapter in the given folder names; trialRead is the adapter's own answer on that scan", async (t) => {
  const root = scratch(t);
  put(root, { "notes/a.note": "GET /a\n", "scratch/b.note": "GET /b\n", "vendored/c.note": "GET /c\n" });
  const out = notes.derive({ repoRoot: root, options: { roots: ["notes"] }, io: ioFor(root, "notes") });
  assert.deepEqual(out.records.map((r) => r.id), ["route:/a"]);
  const scan = await scanFor(root, ADAPTERS);
  assert.deepEqual(scan.files.map((f) => f.rel), ["notes/a.note"], "scratch/ (notes') and vendored/ (lists') are both skipped");
  const alone = scratch(t);
  cpSync(join(ADAPTERS, "notes"), join(alone, "notes"), { recursive: true });
  cpSync(join(ADAPTERS, "_shared"), join(alone, "_shared"), { recursive: true });
  assert.deepEqual((await scanFor(root, alone)).files.map((f) => f.rel), ["notes/a.note", "vendored/c.note"], "a folder without lists skips only what notes names");
  assert.deepEqual((await trialRead(notes, root, ADAPTERS)).proposal.options, { roots: ["notes"] });
  await assert.rejects(() => scanFor(root), /the folder of the app's adapters is required/);
});

test("the repo's adapter folder is never source: an adapter walking the whole repo never sees the adapters, their tests or their fixtures, and a read of one is refused as absent", (t) => {
  const repo = app(t);
  // `lists` walks the whole repo for .list files; one sits in the app, one in
  // a fixture an adapter carries, as a copied starter does.
  put(repo, { "data/real.list": "real\n", "zdd/extractors/lists/fixture/data/sample.list": "sample\n" });
  const p = join(repo, "zdd", "config.json");
  writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, "utf8")), extractors: ["notes", "lists"] }));
  const d = run(["derive", `--root=${repo}`]);
  assert.equal(d.status, 0, d.stderr);
  assert.ok(existsSync(join(repo, "zdd", "metadata", "item", "real.json")));
  assert.ok(!existsSync(join(repo, "zdd", "metadata", "item", "sample.json")), "a fixture in the adapter folder is no record");
  const io = ioFor(repo, "x");
  assert.equal(io.read("zdd/extractors/lists/fixture/data/sample.list").ok, true, "the kit's io knows no config: a test's own repo reads as it is");
  const det = run(["detect", `--root=${repo}`]);
  assert.equal(det.status, 0, det.stderr);
  assert.ok(!JSON.parse(det.stdout).limits.refusedFirst.some((f) => f.startsWith("zdd/")), "detection skips it too");
});

test("io notSource: a walk never enters the folder, a read is refused as absent, and isIgnored says so", (t) => {
  const root = scratch(t);
  put(root, { "tools/a/x.txt": "x", "tools/ab.txt": "y", "src/z.txt": "z" });
  const io = makeExtractorIo(root, "t", { notSource: ["tools/a"] });
  const seen = [];
  io.walk(".", (rel) => seen.push(rel));
  assert.deepEqual(seen, ["src/z.txt", "tools/ab.txt"], "a sibling that only shares the prefix is source");
  const r = io.read("tools/a/x.txt");
  assert.deepEqual([r.ok, r.code], [false, "ignored"]);
  assert.match(r.reason, /is in the repo's adapter folder \(localExtractorDir\) — ZDD's own tooling, not source, not read/);
  assert.equal(io.isIgnored("tools/a"), true);
  assert.equal(io.isIgnored("tools/ab.txt"), false);
});
