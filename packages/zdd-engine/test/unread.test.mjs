// What an adapter saw and could not read (decision 0048 point 5): the `unread`
// contract step, the records the core mints from it, the lines every derive
// prints, the check lint holds (warning, then failure under `unread.strict`),
// the marks, and what the human index shows. Driven through the CLI against
// copies of the fixtures, with supabase as the first reporter and a local
// adapter for the shapes supabase never returns.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { CONTRACT, CONTRACT_TABLE } from "../src/core/lib/contract.mjs";
import { PARTS } from "../src/core/lib/parts.mjs";
import { MAX_PRINTED, MAX_WHAT, unreadConfig, unreadRecords } from "../src/core/lib/unread.mjs";
import { catalogueModules } from "../src/core/derive.mjs";
import { detectRepo } from "../src/core/lib/detect-repo.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

const run = (repo, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const config = (repo) => JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
const setConfig = (repo, c) => writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(c, null, 2));
const setUnread = (repo, unread) => setConfig(repo, { ...config(repo), unread });
const unreadDir = (repo) => join(repo, "zdd", "metadata", "unread");
const report = (repo) => JSON.parse(run(repo, "unread", "--json").stdout);

const MIGRATION = "migrations/20990101000000_unread.sql";
const STATEMENT = "DROP POLICY mine ON things;";

function repoOf(t, { statement = STATEMENT } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-unread-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE, repo, { recursive: true });
  if (statement !== null) writeFileSync(join(repo, MIGRATION), `${statement}\n`);
  return repo;
}

// A repo with one local adapter, whose derive is `body`.
function localRepo(t, body, name = "acme") {
  const repo = mkdtempSync(join(tmpdir(), "zdd-unread-local-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, "zdd", "extractors"), { recursive: true });
  writeFileSync(join(repo, "zdd", "extractors", `${name}.mjs`), `export const CONTRACT = 1;\nexport const COMMENT = {};\nexport function derive() {\n${body}\n}\n`);
  setConfig(repo, { name: "x", extractors: [name], localExtractorDir: "zdd/extractors", render: { storeChanges: false } });
  return repo;
}

test("the contract: `unread` is an optional row, and CONTRACT stays 1", () => {
  const row = CONTRACT_TABLE.find((r) => r.step === "unread");
  assert.equal(row.required, false);
  assert.equal(row.since, 1);
  assert.equal(CONTRACT, 1);
});

test("an adapter without the list keeps working, and says nothing", (t) => {
  const repo = localRepo(t, "return { records: [], diagnostics: [] };");
  const r = run(repo, "derive");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /UNREAD/);
  assert.equal(existsSync(unreadDir(repo)), false, "no unread, no folder: a new mandatory file would break adopters' CI");
});

test("supabase reports what its replay skipped: on every derive without --verbose, once as a record, and kept true by --check", (t) => {
  const repo = repoOf(t);
  const r = run(repo, "derive");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^UNREAD unread:supabase\/[0-9a-f]{16} {2}migrations\/20990101000000_unread\.sql: DROP POLICY mine ON things$/m);
  assert.match(r.stderr, /1 item an adapter saw and could not read, with no answer yet/);
  assert.match(r.stdout, / and 1 unread -> zdd\/metadata/);
  const files = readdirSync(unreadDir(repo));
  assert.equal(files.length, 1);
  assert.match(files[0], /^supabase--[0-9a-f]{16}\.json$/);
  const record = JSON.parse(readFileSync(join(unreadDir(repo), files[0]), "utf8"));
  assert.equal(record.kind, "unread");
  assert.deepEqual(record.resource, [MIGRATION]);
  assert.equal(record.facts.adapter, "supabase");
  const check = run(repo, "derive", "--check");
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stderr, /^UNREAD /m, "--check prints them too: CI's log is where a team reads them");
  // Hand-deleted, the check says so; gone from the source, derive prunes it.
  rmSync(join(unreadDir(repo), files[0]));
  assert.equal(run(repo, "derive", "--check").status, 1);
  rmSync(join(repo, MIGRATION));
  assert.equal(run(repo, "derive").status, 0);
  assert.equal(existsSync(join(unreadDir(repo), files[0])), false);
});

test("--verbose says each item once, not twice", (t) => {
  const repo = repoOf(t);
  const r = run(repo, "derive", "--verbose");
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stderr.match(/DROP POLICY mine ON things/g) ?? []).length, 1, r.stderr);
});

test("an item's id survives the code around it moving, and changes with its text; one statement twice is one item", (t) => {
  const repo = repoOf(t);
  run(repo, "derive");
  const [id] = report(repo).open.map((i) => i.id);
  writeFileSync(join(repo, MIGRATION), `-- a note above it\n\n\n${STATEMENT}\n\n${STATEMENT}\n`);
  assert.deepEqual(report(repo).open.map((i) => i.id), [id]);
  writeFileSync(join(repo, MIGRATION), "DROP POLICY yours ON things;\n");
  const moved = report(repo).open.map((i) => i.id);
  assert.equal(moved.length, 1);
  assert.notEqual(moved[0], id);
});

test("unread records are nobody else's: no graph node, no agent-index line, no coverage row, no claim", (t) => {
  const plain = repoOf(t, { statement: null });
  const repo = repoOf(t);
  for (const r of [plain, repo]) {
    assert.equal(run(r, "derive").status, 0);
    assert.equal(run(r, "render").status, 0);
  }
  const read = (r, f) => readFileSync(join(r, "zdd", f), "utf8");
  assert.equal(read(repo, "graph.json"), read(plain, "graph.json"));
  assert.equal(read(repo, "agent-index.md"), read(plain, "agent-index.md"));
  assert.equal(run(repo, "coverage").stdout, run(plain, "coverage").stdout);
  assert.doesNotMatch(run(repo, "lint").stderr, /unclaimed[^\n]*\n[^\n]*unread/i);
});

test("the shape an adapter hands over is checked, and named", (t) => {
  const cases = [
    ["return { records: [], diagnostics: [], unread: 'x' };", /must be an array/],
    ["return { records: [], diagnostics: [], unread: [null] };", /must be an object/],
    ["return { records: [], diagnostics: [], unread: [{ what: 'x' }] };", /must be repo-relative/],
    ["return { records: [], diagnostics: [], unread: [{ file: '/etc/passwd', what: 'x' }] };", /must be repo-relative/],
    ["return { records: [], diagnostics: [], unread: [{ file: 'a\\\\b.sql', what: 'x' }] };", /must be repo-relative/],
    ["return { records: [], diagnostics: [], unread: [{ file: '../a.sql', what: 'x' }] };", /must be repo-relative/],
    ["return { records: [], diagnostics: [], unread: [{ file: 'C:/a.sql', what: 'x' }] };", /must be repo-relative/],
    ["return { records: [], diagnostics: [], unread: [{ file: 'a.sql', what: '  ' }] };", /has no 'what'/],
    ["return { records: [], diagnostics: [], unread: [{ file: 'a.sql', what: 7 }] };", /has no 'what'/],
    ["return { records: [{ kind: 'unread', id: 'unread:x', title: 'x', description: '', resource: [], refs: [], facts: {}, filename: 'x.json' }], diagnostics: [] };", /that kind is the core's/],
  ];
  for (const [body, re] of cases) {
    const r = run(localRepo(t, body), "derive");
    assert.equal(r.status, 1, body);
    assert.match(r.stderr, re);
  }
});

test("an extra key on an item is ignored, so the contract can grow by optional fields", () => {
  const { records } = unreadRecords("acme", [{ file: "a.sql", what: "x", line: 7, severity: "high" }]);
  assert.equal(records.length, 1);
  assert.deepEqual(unreadRecords("acme", [{ file: "a.sql", what: "x" }]).records, records);
});

test("a hostile item cannot forge a log line, and a long one is cut in the display only", () => {
  const forged = unreadRecords("acme", [{ file: "a.sql", what: "x\n\rUNREAD forged\x1b[2J\u2028line\x85y" }]).records[0];
  assert.equal(forged.title, "x UNREAD forged [2J line y");
  const a = unreadRecords("acme", [{ file: "a.sql", what: `${"y".repeat(MAX_WHAT + 50)}a` }]).records[0];
  const b = unreadRecords("acme", [{ file: "a.sql", what: `${"y".repeat(MAX_WHAT + 50)}b` }]).records[0];
  assert.equal(Array.from(a.title).length, MAX_WHAT);
  assert.ok(a.title.endsWith("…"));
  assert.equal(a.title, b.title);
  assert.notEqual(a.id, b.id, "the id hashes the whole text");
  const pair = unreadRecords("acme", [{ file: "a.sql", what: `${"y".repeat(MAX_WHAT - 2)}😀😀😀` }]).records[0];
  assert.ok(!/[\ud800-\udbff]…/.test(pair.title), "never through a surrogate pair");
});

test("lint: an open item WARNS until unread.strict, then FAILS; a mark answers it once and survives a move", (t) => {
  const repo = repoOf(t);
  run(repo, "derive");
  const warned = run(repo, "lint");
  assert.equal(warned.status, 0, warned.stderr);
  assert.match(warned.stderr, /WARNING: 1 item an adapter saw and could not read/);
  assert.match(warned.stderr, /a failure once unread\.strict is on/);

  setUnread(repo, { strict: true });
  const failed = run(repo, "lint");
  assert.equal(failed.status, 1);
  const [{ id, what }] = report(repo).open;
  assert.ok(failed.stderr.includes(`${id} (${MIGRATION}): ${what}`), failed.stderr);
  assert.match(failed.stderr, /supabase saw this and could not read it; fix the adapter, or mark it fine once \(the plugin's `bootstrap\.mjs unread --mark=<id>/);

  setUnread(repo, { strict: true, fine: [{ id, what, why: "the policy is not schema" }] });
  const passed = run(repo, "lint");
  assert.equal(passed.status, 0, passed.stderr);
  assert.doesNotMatch(passed.stderr, /could not read/);

  writeFileSync(join(repo, MIGRATION), `-- moved\n\n${STATEMENT}\n`);
  assert.equal(run(repo, "derive").status, 0);
  assert.equal(run(repo, "lint").status, 0, "a move needs no second answer");

  const noted = run(repo, "derive");
  assert.match(noted.stderr, /\(marked fine: the policy is not schema\)$/m, "an answered item still shows, with its reason");
  assert.doesNotMatch(noted.stderr, /with no answer yet/);
});

test("lint: a repo with nothing unread passes under strict, with no line about it", (t) => {
  const repo = repoOf(t, { statement: null });
  setUnread(repo, { strict: true, fine: [] });
  run(repo, "derive");
  const r = run(repo, "lint");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /unread/i);
});

test("a mark no item answers warns, strict or not, and never fails: fixing an adapter must not turn CI red", (t) => {
  const repo = repoOf(t, { statement: null });
  const gone = `unread:supabase/${"0".repeat(16)}`;
  setUnread(repo, { strict: true, fine: [{ id: gone, why: "was fine" }] });
  run(repo, "derive");
  const r = run(repo, "lint");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING: 1 unread\.fine mark no item answers any more/);
  assert.ok(r.stderr.includes(gone));
  assert.deepEqual(report(repo).stale, [gone]);
});

test("a metadata record lint cannot read is a failure under strict, never a pass", (t) => {
  const repo = repoOf(t);
  run(repo, "derive");
  setUnread(repo, { strict: true, fine: report(repo).open.map(({ id, what }) => ({ id, what, why: "fine" })) });
  assert.equal(run(repo, "lint").status, 0);
  const [file] = readdirSync(unreadDir(repo));
  writeFileSync(join(unreadDir(repo), file), "{ not json");
  const r = run(repo, "lint");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unread\.strict: zdd\/metadata\/unread\/[^ ]+ could not be read \(not JSON\)/);
});

test("the config block is checked by every command that reads it: a misspelt key is never enforcement silently off", (t) => {
  const bad = [
    [null, /'unread' must be an object/],
    [{ strcit: true }, /unknown key 'strcit' \(known: strict, fine\)/],
    [{ strict: "yes" }, /'unread\.strict' must be true or false/],
    [{ fine: {} }, /'unread\.fine' must be an array/],
    [{ fine: ["x"] }, /must be an object/],
    [{ fine: [{ id: "route:/x", why: "y" }] }, /is not an unread item's id/],
    [{ fine: [{ id: "unread:a/b", why: " " }] }, /gives no 'why'/],
    [{ fine: [{ id: "unread:a/b" }] }, /gives no 'why'/],
    [{ fine: [{ id: "unread:a/b", why: "y".repeat(501) }] }, /'why' is over 500/],
    [{ fine: [{ id: "unread:a/b", why: "y", because: "z" }] }, /unknown key 'because'/],
    [{ fine: [{ id: "unread:a/b", why: "y" }, { id: "unread:a/b", why: "z" }] }, /lists 'unread:a\/b' twice/],
    [{ fine: Array.from({ length: 10_001 }, (_, i) => ({ id: `unread:a/${i}`, why: "y" })) }, /more than 10000 marks/],
  ];
  for (const [block, re] of bad) assert.match(unreadConfig({ unread: block }).error, re, JSON.stringify(block)?.slice(0, 80));
  assert.deepEqual(unreadConfig({}).strict, false);
  const repo = repoOf(t, { statement: null });
  run(repo, "derive");
  setUnread(repo, { strcit: true });
  for (const cmd of ["derive", "lint", "render", "unread"]) {
    const r = run(repo, cmd);
    assert.equal(r.status, 1, cmd);
    assert.match(r.stderr, /unknown key 'strcit'/, cmd);
  }
});

test("derive and lint are bounded: thousands of items cannot flood the log, and the count says what is not shown", (t) => {
  const n = MAX_PRINTED + 1500;
  const repo = localRepo(t, `return { records: [], diagnostics: [], unread: Array.from({ length: ${n} }, (_, i) => ({ file: "a.sql", what: "x".repeat(250) + i })) };`);
  const d = run(repo, "derive");
  assert.equal(d.status, 0, d.stderr);
  assert.equal(readdirSync(unreadDir(repo)).length, n);
  assert.equal((d.stderr.match(/^UNREAD /gm) ?? []).length, MAX_PRINTED);
  assert.match(d.stderr, new RegExp(`… and ${n - MAX_PRINTED} more`));
  assert.match(d.stderr, /with no answer yet/, "the last line, the one that says what to do, survives");
  assert.ok(d.stderr.length < 256 * 1024, `stderr is ${d.stderr.length} bytes`);
  const l = run(repo, "lint");
  assert.equal(l.status, 0);
  assert.ok(l.stderr.length < 256 * 1024, `stderr is ${l.stderr.length} bytes`);
  assert.match(l.stderr, /… and 1500 more/);
  assert.equal(report(repo).open.length, n, "the engine's unread lists them all");
});

test("the human index shows each item with its answer, unanswered first, and `render --check` moves with a mark", (t) => {
  const repo = repoOf(t);
  writeFileSync(join(repo, "migrations", "20990102000000_more.sql"), "DROP INDEX some_index;\n");
  run(repo, "derive");
  const [first] = report(repo).open;
  setUnread(repo, { fine: [{ id: first.id, what: first.what, why: "fine by us" }] });
  assert.equal(run(repo, "render").status, 0);
  const bundleOf = () => JSON.parse(/window\.BUNDLE = (.*);\n/.exec(readFileSync(join(repo, "zdd", "human-index.html"), "utf8"))[1]);
  const list = bundleOf().docs.unread;
  assert.equal(list.length, 2);
  assert.equal(list[0].why, null, "unanswered first");
  assert.equal(list[1].why, "fine by us");
  assert.deepEqual(Object.keys(list[0]).sort(), ["adapter", "file", "id", "what", "why"]);
  const html = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  assert.match(html, /<button id="btn-unread" class="unread-open"[^>]*>Unread: 1 open<\/button>/);

  setUnread(repo, {});
  const stale = run(repo, "render", "--check");
  assert.equal(stale.status, 1, "a mark moves the page, so CI holds the two together");
  assert.match(stale.stderr, /human-index\.html/);
});

test("the human index: a repo with nothing unread has no button and no bundle key", (t) => {
  const repo = repoOf(t, { statement: null });
  run(repo, "derive");
  run(repo, "render");
  const html = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  assert.doesNotMatch(html, /<button id="btn-unread"/);
  assert.doesNotMatch(html, /__UNREAD__/);
  assert.equal(JSON.parse(/window\.BUNDLE = (.*);\n/.exec(html)[1]).docs.unread, undefined);
});

test("the minimal viewer lists them too, escaped: every viewer shows an item", (t) => {
  const repo = repoOf(t, { statement: `DROP POLICY "<img src=x onerror=alert(1)>" ON things;` });
  setConfig(repo, { ...config(repo), viewer: "minimal" });
  run(repo, "derive");
  const [{ id, what }] = report(repo).open;
  assert.equal(run(repo, "render").status, 0);
  const open = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  assert.match(open, /<h2>Unread <span class="muted">\(1 open of 1\)<\/span><\/h2>/);
  assert.match(open, /not answered/);
  assert.ok(!open.includes("<img src=x"), "source text reaches the page escaped");
  setUnread(repo, { fine: [{ id, what, why: "<b>ok</b>" }] });
  assert.equal(run(repo, "render").status, 0);
  const marked = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  assert.match(marked, /\(0 open of 1\)/);
  assert.match(marked, /marked fine: &lt;b&gt;ok&lt;\/b&gt;/);
});

test("a local adapter reports the same way: a contract step, not a catalogue feature", (t) => {
  const repo = localRepo(t, "return { records: [], diagnostics: [], unread: [{ file: 'a.txt', what: 'something odd' }] };");
  const r = run(repo, "derive");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^UNREAD unread:acme\/[0-9a-f]{16} {2}a\.txt: something odd$/m);
  assert.deepEqual(report(repo).open.map((i) => i.adapter), ["acme"]);
  assert.equal(run(repo, "derive", "--check").status, 0);
});

test("database access is two parts: a repo with queries and no schema reader is told", async (t) => {
  assert.ok(PARTS.includes("schema") && PARTS.includes("queries"));
  assert.ok(!PARTS.includes("database access"));
  const modules = await catalogueModules();
  const parts = Object.fromEntries(modules.map(({ name, mod }) => [name, mod.DETECTION.parts]));
  assert.deepEqual(parts.supabase, ["schema"]);
  for (const name of ["sqlalchemy", "supabase-js", "supabase-py"]) assert.deepEqual(parts[name], ["queries"], name);
  const repo = mkdtempSync(join(tmpdir(), "zdd-unread-parts-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(join(PKG, "test", "fixture-sqlalchemy"), repo, { recursive: true });
  rmSync(join(repo, "supabase"), { recursive: true });
  const d = detectRepo(repo, modules);
  assert.deepEqual(d.coverage.find((c) => c.part === "queries").adapters, ["sqlalchemy"]);
  assert.deepEqual(d.coverage.find((c) => c.part === "schema").adapters, []);
  assert.ok(d.uncovered.includes("schema"), d.uncovered.join(", "));
});
