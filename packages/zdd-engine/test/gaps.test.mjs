// The map's gaps (decision 0049): what should link and does not, over the
// whole repo, every run. The core's kinds and an adapter's GAPS step, the
// ids and their one-time answers in zdd/config.json, the engine's `gaps`
// report, lint's check (a warning, then a failure under `gaps.strict`), and
// known gaps in both indexes. Driven through the CLI over a local adapter
// that mints whatever records a test hands it, so no stack is named.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_TABLE } from "../src/core/lib/contract.mjs";
import { DEFAULT_GAP_KINDS, GAP_ID, checkGaps, gapKinds, gapsConfig, gapsOf, gapReport, outLinks } from "../src/core/lib/gaps.mjs";
import { coverageOf } from "../src/core/coverage.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const run = (repo, ...args) => spawnSync(process.execPath, [BIN, ...args, `--root=${repo}`], { encoding: "utf8" });

const rec = (kind, name, refs = [], extra = {}) => ({ kind, id: `${kind}:x/${name}`, title: name, description: "", resource: [`src/${name}.txt`], refs, facts: {}, filename: `${name}.json`, ...extra });

// A repo whose one adapter mints `records`, and optionally declares GAPS.
function repoWith(t, records, { gaps, config = {} } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-gaps-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, "zdd", "extractors"), { recursive: true });
  writeFileSync(
    join(repo, "zdd", "extractors", "acme.mjs"),
    `export const CONTRACT = 1;\nexport const COMMENT = {};\n${gaps === undefined ? "" : `export const GAPS = ${JSON.stringify(gaps)};\n`}export function derive() {\n  return { records: ${JSON.stringify(records)}, diagnostics: [] };\n}\n`,
  );
  setConfig(repo, { name: "x", extractors: ["acme"], localExtractorDir: "zdd/extractors", render: { storeChanges: false }, ...config });
  return repo;
}
const readConfig = (repo) => JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
const setConfig = (repo, c) => writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(c, null, 2));
const report = (repo) => {
  const r = run(repo, "gaps", "--json");
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const derived = (repo) => assert.equal(run(repo, "derive").status, 0);

// A route that reaches a table, one that reaches nothing, a surface that
// reaches nothing, a table nothing reaches, and a kind the core does not count.
const SHAPE = [rec("route", "things", ["table:x/things"]), rec("route", "health"), rec("surface", "home"), rec("table", "things"), rec("table", "orphans"), rec("module", "lib")];

test("the contract: `gaps` is an optional step", () => {
  const row = CONTRACT_TABLE.find((r) => r.step === "gaps");
  assert.equal(row.required, false);
  assert.equal(row.since, 1);
  assert.match(row.what, /reachNothing/);
});

test("the core's kinds: a route, surface or background task that reaches nothing, and a table nothing reaches; nothing else", () => {
  assert.deepEqual(DEFAULT_GAP_KINDS, { reachNothing: ["background-task", "route", "surface"], reachedByNothing: ["table"] });
  const gaps = gapsOf(SHAPE);
  assert.deepEqual(gaps.map((g) => [g.record, g.direction]), [["route:x/health", "reachNothing"], ["surface:x/home", "reachNothing"], ["table:x/orphans", "reachedByNothing"]]);
  for (const g of gaps) assert.match(g.id, GAP_ID);
  assert.equal(gaps[0].what, "route health: reaches nothing");
  assert.equal(gaps[2].what, "table orphans: nothing reaches it");
  assert.equal(gaps[0].file, "src/health.txt");
});

test("what counts as a link is the coverage report's own rule: refs and typed edges to a record that exists, never itself", () => {
  const records = [rec("route", "a", ["route:x/a", "table:x/missing"]), rec("route", "b", [], { facts: { edges: { reads: ["table:x/t"] } } }), rec("table", "t")];
  assert.deepEqual(gapsOf(records).map((g) => g.record), ["route:x/a"]);
  const outs = outLinks(records);
  const cov = coverageOf(records);
  for (const kind of ["route", "table"]) {
    const row = cov.find((r) => r.kind === kind);
    assert.equal(row.linkNothing.count, records.filter((r) => r.kind === kind && !outs.get(r.id).length).length, kind);
  }
});

test("an id is the direction and the record's id: stable across everything else, new when the record is renamed", () => {
  const [a] = gapsOf([rec("route", "health")]);
  const [b] = gapsOf([rec("route", "health", [], { title: "Health check", resource: ["elsewhere.txt"], description: "moved" })]);
  const [c] = gapsOf([rec("route", "healthz")]);
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  // A kind in both directions is two gaps, with two ids.
  const both = gapsOf([rec("widget", "w")], { reachNothing: ["widget"], reachedByNothing: ["widget"] });
  assert.equal(both.length, 2);
  assert.notEqual(both[0].id, both[1].id);
});

test("text from a record is one plain line: a control or bidi character in a title cannot forge a log line", () => {
  const [g] = gapsOf([rec("route", "x", [], { title: "a\nFAKE LINE‮" })]);
  assert.equal(g.title, "a FAKE LINE");
  assert.doesNotMatch(g.what, /\n/);
});

test("an adapter's GAPS adds kinds of its own records; a malformed one stops derive, naming the adapter", (t) => {
  assert.deepEqual(gapKinds([{ name: "acme", mod: { GAPS: { reachNothing: ["widget"] } } }]).reachNothing, ["background-task", "route", "surface", "widget"]);
  for (const [bad, why] of [[[], /must be an object/], [{ reachNothing: "widget" }, /array/], [{ reachesNothing: ["w"] }, /unknown key/], [{ reachNothing: ["Bad Kind"] }, /not a record kind/], [{ reachedByNothing: ["unread"] }, /not a record kind/], [{ reachNothing: Array.from({ length: 51 }, (_, i) => `k${i}`) }, /at most 50/]]) {
    assert.match(checkGaps("acme", bad).error, why, JSON.stringify(bad));
  }
  const repo = repoWith(t, [rec("widget", "w"), rec("route", "r", ["widget:x/w"])], { gaps: { reachNothing: ["widget"] } });
  const r = report(repo);
  assert.deepEqual(r.kinds.reachNothing, ["background-task", "route", "surface", "widget"]);
  assert.deepEqual(r.open.map((g) => g.record), ["widget:x/w"]);
  const broken = repoWith(t, [], { gaps: { reachNothing: "widget" } });
  const d = run(broken, "derive");
  assert.equal(d.status, 1);
  assert.match(d.stderr, /adapter 'acme': GAPS \.reachNothing must be an array/);
});

test("the gaps block: an unknown key, a bad id, a mark with no why, and an id in both lists are errors, never enforcement off", () => {
  const id = gapsOf([rec("route", "health")])[0].id;
  const err = (gaps) => gapsConfig({ gaps }).error;
  assert.match(err({ strickt: true }), /'gaps' has an unknown key 'strickt' \(known: strict, fine, known\)/);
  assert.match(err({ strict: "yes" }), /'gaps.strict' must be true or false/);
  assert.match(err({ fine: [{ id: "route:x/health", why: "w" }] }), /is not a gap's id \("gap:<kind>\/<hash>"\)/);
  assert.match(err({ known: [{ id }] }), /'gaps.known' entry .* gives no 'why' — a known gap says why it cannot be mapped/);
  assert.match(err({ fine: [{ id, why: "a" }], known: [{ id, why: "b" }] }), /is in both 'gaps.fine' and 'gaps.known' — one answer per item/);
  assert.deepEqual(gapsConfig({}), { strict: false, fine: new Map(), known: new Map() });
  const cfg = gapsConfig({ gaps: { known: [{ id, what: "x", why: "built at runtime" }], fine: [{ id: "gap:route/0000000000000000", why: "gone" }] } });
  const r = gapReport(gapsOf([rec("route", "health")]), cfg);
  assert.deepEqual(r.open, []);
  assert.equal(r.known[0].why, "built at runtime");
  assert.deepEqual(r.stale, ["gap:route/0000000000000000"]);
});

test("lint reads the records derive wrote and agrees with the engine's `gaps`: a warning off strict, a failure on it, named by id", (t) => {
  const repo = repoWith(t, SHAPE);
  derived(repo);
  const ids = report(repo).open.map((g) => g.id);
  assert.equal(ids.length, 3);
  const warn = run(repo, "lint");
  assert.equal(warn.status, 0, warn.stderr);
  assert.match(warn.stderr, /WARNING: 3 gaps in the map with no answer yet — .*a failure once gaps\.strict is on/);
  for (const id of ids) assert.ok(warn.stderr.includes(id), id);
  setConfig(repo, { ...readConfig(repo), gaps: { strict: true } });
  const fail = run(repo, "lint");
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /Store lints failed \(3\)/);
  for (const id of ids) assert.ok(fail.stderr.includes(id), id);
});

test("an answered gap passes strict lint: fine or known, once; a mark no gap answers warns and never fails", (t) => {
  const repo = repoWith(t, SHAPE);
  derived(repo);
  const [a, b, c] = report(repo).open;
  setConfig(repo, { ...readConfig(repo), gaps: { strict: true, fine: [{ id: a.id, what: a.what, why: "a health check touches no table" }, { id: "gap:route/0123456789abcdef", why: "an old one" }], known: [{ id: b.id, what: b.what, why: "built at runtime" }, { id: c.id, why: "read by a job no adapter sees" }] } });
  const ok = run(repo, "lint");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /WARNING: 1 gap mark in zdd\/config\.json no gap answers any more — .*gap:route\/0123456789abcdef/);
  const r = report(repo);
  assert.deepEqual([r.open.length, r.fine.length, r.known.length, r.stale.length], [0, 1, 2, 1]);
});

test("fixed is no mark: once the record links, its gap is gone and lint passes strict", (t) => {
  const repo = repoWith(t, [rec("route", "health")], { config: { gaps: { strict: true } } });
  derived(repo);
  assert.equal(run(repo, "lint").status, 1);
  const fixed = repoWith(t, [rec("route", "health", ["table:x/t"]), rec("table", "t")], { config: { gaps: { strict: true } } });
  derived(fixed);
  assert.equal(run(fixed, "lint").status, 0);
});

test("under strict, a record lint cannot read fails: what links there is unknown", (t) => {
  const repo = repoWith(t, [rec("route", "r", ["table:x/t"]), rec("table", "t")], { config: { gaps: { strict: true } } });
  derived(repo);
  writeFileSync(join(repo, "zdd", "metadata", "table", "t.json"), "{ not json");
  const r = run(repo, "lint");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /gaps\.strict: zdd\/metadata\/table\/t\.json could not be read \(not JSON\)/);
});

test("a malformed gaps block stops lint, render and the report before they run", (t) => {
  const repo = repoWith(t, SHAPE, { config: { gaps: { strict: "on" } } });
  derived(repo);
  for (const cmd of ["lint", "render", "gaps"]) {
    const r = run(repo, cmd);
    assert.equal(r.status, 1, cmd);
    assert.match(r.stderr, /'gaps.strict' must be true or false/, cmd);
  }
});

test("a known gap shows in the agent index and the human index; with none, both keep their bytes", (t) => {
  const repo = repoWith(t, SHAPE);
  derived(repo);
  assert.equal(run(repo, "render").status, 0);
  const index = join(repo, "zdd", "agent-index.md");
  const html = join(repo, "zdd", "human-index.html");
  const before = [readFileSync(index, "utf8"), readFileSync(html, "utf8")];
  // A fine mark changes neither index: only a known gap is a part not to trust.
  const [a, b] = report(repo).open;
  setConfig(repo, { ...readConfig(repo), gaps: { fine: [{ id: a.id, why: "nothing to map" }] } });
  assert.equal(run(repo, "render").status, 0);
  assert.deepEqual([readFileSync(index, "utf8"), readFileSync(html, "utf8")], before);
  assert.doesNotMatch(before[0], /Known gaps/);
  setConfig(repo, { ...readConfig(repo), gaps: { fine: [{ id: a.id, why: "nothing to map" }], known: [{ id: b.id, why: "screens built from a runtime list" }] } });
  assert.equal(run(repo, "render").status, 0);
  const text = readFileSync(index, "utf8");
  assert.match(text, /## Known gaps\n\nParts of the map not to trust/);
  assert.match(text, /^- surface \[home\]\(metadata\/surface\/home\.json\) \(`src\/home\.txt`\): reaches nothing — screens built from a runtime list$/m);
  assert.equal(run(repo, "render", "--check").status, 0, "the index holds the answer, so --check keeps the two together");
  const page = readFileSync(html, "utf8");
  assert.match(page, /<button id="btn-gaps" class="unread-open"[^>]*>Known gaps: 1<\/button>/);
  const bundle = JSON.parse(page.match(/window\.BUNDLE = (.*?);\n/s)[1].replace(/\\u003c/g, "<"));
  assert.deepEqual(bundle.docs.gaps, [{ id: b.id, node: "metadata/surface/home", kind: "surface", title: "home", file: "src/home.txt", direction: "reachNothing", what: "surface home: reaches nothing", why: "screens built from a runtime list" }]);
  setConfig(repo, { ...readConfig(repo), viewer: "minimal" });
  assert.equal(run(repo, "render").status, 0);
  assert.match(readFileSync(html, "utf8"), /<h2>Known gaps <span class="muted">\(1 — parts of the map not to trust\)<\/span><\/h2>/);
});

test("the engine's `gaps` writes nothing and says how to answer", (t) => {
  const repo = repoWith(t, SHAPE);
  const r = run(repo, "gaps");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /3 gaps with no answer yet — fix the adapter that should read it \(the extractor skill\), or answer it once/);
  assert.match(r.stdout, /gaps\.strict is off: lint only warns\./);
  assert.throws(() => readFileSync(join(repo, "zdd", "metadata", "route", "health.json")));
});
