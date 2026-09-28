// The `io` an extractor is handed (CAS-65, decision 0010): read and walk,
// repo-relative, never leaving the repo physically, one entry budget per io.
// Unit tests against scratch trees, then the CLI seam: a local extractor in
// localExtractorDir receives io and its records land.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, symlinkSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { makeExtractorIo, IO_MAX_READ_BYTES } from "../src/lib/extractor-io.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE_GREENFIELD = join(PKG, "test", "fixture-greenfield");
const POSIX = process.platform !== "win32";

const scratch = (files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-io-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};
const collect = (io, dir, opts) => {
  const files = [];
  const result = io.walk(dir, (rel, name) => files.push([rel, name]), opts);
  return { files, ...result };
};

test("read: a regular file inside the repo is text; missing, a directory and an oversized file are refusals with a code", (t) => {
  const root = scratch({ "src/a.cs": "class A {}\n", "src/My Controller.cs": "class B {}\n" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "big.sql"), "x".repeat(IO_MAX_READ_BYTES + 1));
  const io = makeExtractorIo(root);
  assert.deepEqual(io.read("src/a.cs"), { ok: true, text: "class A {}\n" });
  assert.deepEqual(io.read("./src//a.cs"), { ok: true, text: "class A {}\n" }, "normalised like a path");
  assert.equal(io.read("src/My Controller.cs").ok, true, "spaces are source, not a refusal");
  assert.equal(io.read("src/nope.cs").code, "missing");
  assert.equal(io.read("src").code, "not-regular");
  const big = io.read("big.sql");
  assert.equal(big.code, "too-large");
  assert.match(big.reason, /big\.sql is over \d+ bytes — not read/);
});

test("read: maxBytes lowers the cap and can never raise it", (t) => {
  const root = scratch({ "a.txt": "12345" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "big.txt"), "x".repeat(IO_MAX_READ_BYTES + 1));
  const io = makeExtractorIo(root);
  assert.equal(io.read("a.txt", { maxBytes: 4 }).code, "too-large");
  assert.equal(io.read("a.txt", { maxBytes: 5 }).ok, true);
  assert.equal(io.read("big.txt", { maxBytes: IO_MAX_READ_BYTES * 8 }).code, "too-large");
});

test("read and walk: a path that is not repo-relative POSIX throws, naming the extractor", (t) => {
  const root = scratch({ "a.txt": "a" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const io = makeExtractorIo(root, "mysql");
  for (const bad of ["/etc/passwd", "../outside.txt", "src/../../x", "C:/x", "src\\a.cs", "a.cs:stream", "a\u0000b", "", 42]) {
    assert.throws(() => io.read(bad), /^Error: mysql: io\.read path .* must be repo-relative POSIX/, JSON.stringify(bad));
    assert.throws(() => io.walk(bad, () => {}), /^Error: mysql: io\.walk directory .* must be repo-relative POSIX/, JSON.stringify(bad));
  }
});

test("walk: sorted, repo-relative POSIX paths, .git skipped by default, enter can veto, the root may be '.'", (t) => {
  const root = scratch({
    "src/b/two.cs": "",
    "src/a/one.cs": "",
    "src/z.cs": "",
    "src/node_modules/dep.js": "",
    ".git/HEAD": "",
    "top.sql": "",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const io = makeExtractorIo(root);
  const src = collect(io, "src", { enter: (rel, name) => name !== "node_modules" });
  assert.deepEqual(src.files, [["src/a/one.cs", "one.cs"], ["src/b/two.cs", "two.cs"], ["src/z.cs", "z.cs"]]);
  assert.equal(src.exists, true);
  assert.equal(src.truncated, false);
  assert.deepEqual(src.skipped, []);
  const all = collect(io, ".");
  assert.deepEqual(all.files.map(([rel]) => rel), ["src/a/one.cs", "src/b/two.cs", "src/node_modules/dep.js", "src/z.cs", "top.sql"]);
  for (const [rel] of all.files) assert.equal(io.read(rel).ok, true, `every walked path reads: ${rel}`);
});

test("walk: a missing root is nothing to inventory (no skipped entry); a file as the root is reported", (t) => {
  const root = scratch({ "a.txt": "a" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const io = makeExtractorIo(root);
  assert.deepEqual(collect(io, "migrations"), { files: [], exists: false, truncated: false, skipped: [] });
  const file = collect(io, "a.txt");
  assert.equal(file.exists, false);
  assert.equal(file.skipped.length, 1);
  assert.match(file.skipped[0].reason, /not a real directory/);
});

test("walk: every walk on one io shares one entry budget; a fresh io starts afresh", (t) => {
  const files = {};
  for (let i = 0; i < 6; i++) files[`a/f${i}.txt`] = "";
  for (let i = 0; i < 6; i++) files[`b/f${i}.txt`] = "";
  const root = scratch(files);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const io = makeExtractorIo(root, "x", { maxEntries: 8 });
  const a = collect(io, "a");
  assert.equal(a.files.length, 6);
  assert.equal(a.truncated, false);
  // CAS-65 CR-025: the budget is charged per directory entry as it is read,
  // and a directory the budget runs out inside yields nothing — never the
  // subset the filesystem happened to list first.
  const b = collect(io, "b");
  assert.equal(b.files.length, 0, "b's listing would pass the budget: dropped whole, deterministically");
  assert.equal(b.truncated, true);
  assert.equal(collect(io, "a").files.length, 0, "a spent budget stays spent");
  assert.equal(collect(makeExtractorIo(root, "x", { maxEntries: 8 }), "b").files.length, 6);
});

test("walk: the budget holds across nested directories, and depth is capped", (t) => {
  const root = scratch({ "d/1/2/3/deep.txt": "", "d/1/x.txt": "", "d/1/2/y.txt": "" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const shallow = collect(makeExtractorIo(root, "x", { maxDepth: 1 }), "d");
  assert.deepEqual(shallow.files.map(([rel]) => rel), ["d/1/x.txt"]);
  assert.equal(shallow.truncated, true);
  // Listings charged: d → [1] (1), d/1 → [2, x.txt] (3), d/1/2 → [3, y.txt]
  // would reach 5 > 3, so d/1/2 yields nothing and the walk is truncated.
  const tight = collect(makeExtractorIo(root, "x", { maxEntries: 3 }), "d");
  assert.deepEqual(tight.files.map(([rel]) => rel), ["d/1/x.txt"]);
  assert.equal(tight.truncated, true);
});

test("CAS-65 CR-024: walk hands out files in one global path order — a numbered file before the same-named folder's contents", (t) => {
  const root = scratch({ "db/001/a.sql": "", "db/001.sql": "", "db/002.sql": "", "db/001-x.sql": "" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(collect(makeExtractorIo(root), "db").files.map(([rel]) => rel), ["db/001-x.sql", "db/001.sql", "db/001/a.sql", "db/002.sql"]);
});

test("CAS-65 CR-025: a total read budget per io — once spent, a read is over-budget, never a silent miss", (t) => {
  const root = scratch({ "a.txt": "x".repeat(600), "b.txt": "y".repeat(600) });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const io = makeExtractorIo(root, "x", { maxTotalBytes: 1000 });
  assert.equal(io.read("a.txt").ok, true);
  const b = io.read("b.txt");
  assert.equal(b.code, "over-budget");
  assert.match(b.reason, /b\.txt would pass this extractor's total read budget of 1000 bytes — not read/);
  assert.equal(makeExtractorIo(root, "x", { maxTotalBytes: 1000 }).read("b.txt").ok, true, "a fresh io starts afresh");
});

test("CAS-65 CR-023: a file that is present but cannot be read is 'unreadable', never 'missing' (POSIX, not root)", { skip: (!POSIX || process.getuid?.() === 0) && "needs POSIX permissions and a non-root user" }, (t) => {
  const root = scratch({ "locked.sql": "CREATE TABLE t (id int);" });
  t.after(() => {
    chmodSync(join(root, "locked.sql"), 0o644);
    rmSync(root, { recursive: true, force: true });
  });
  chmodSync(join(root, "locked.sql"), 0o000);
  const got = makeExtractorIo(root).read("locked.sql");
  assert.equal(got.code, "unreadable");
  assert.match(got.reason, /locked\.sql could not be opened \(EACCES\) — not read/);
});

test("CAS-65 CR-038: a directory link is never followed on any platform — a junction on Windows, a symlink elsewhere", (t) => {
  const outside = scratch({ "leak.sql": "CREATE TABLE leak (id int);" });
  const root = scratch({ "db/real.sql": "x" });
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const type = POSIX ? "dir" : "junction"; // a junction needs no privilege on Windows
  symlinkSync(outside, join(root, "db", "linked"), type);
  symlinkSync(outside, join(root, "linkedroot"), type);
  const io = makeExtractorIo(root);
  const db = collect(io, "db");
  assert.deepEqual(db.files.map(([rel]) => rel), ["db/real.sql"]);
  assert.deepEqual(db.skipped.map((s) => s.path), ["db/linked"]);
  assert.equal(io.read("db/linked/leak.sql").code, "not-regular");
  const linked = collect(io, "linkedroot");
  assert.equal(linked.exists, false);
  assert.match(linked.skipped[0].reason, /not a real directory/);
});

test("io is frozen: an extractor cannot swap read or walk for the next one", () => {
  const io = makeExtractorIo(PKG);
  assert.ok(Object.isFrozen(io));
  assert.deepEqual(Object.keys(io).sort(), ["read", "walk"]);
});

test("POSIX: symlinks are never followed — a linked file, a file under a linked directory, a linked walk root", { skip: !POSIX && "symlinks need privileges on Windows" }, (t) => {
  const outside = scratch({ "secret.sql": "CREATE TABLE secret (id int);", "dir/leak.sql": "CREATE TABLE leak (id int);" });
  const root = scratch({ "db/real.sql": "CREATE TABLE real (id int);" });
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  symlinkSync(join(outside, "secret.sql"), join(root, "db", "linked.sql"));
  symlinkSync(join(outside, "dir"), join(root, "db", "linkdir"));
  symlinkSync(join(outside, "dir"), join(root, "linkedroot"));
  const io = makeExtractorIo(root);
  assert.equal(io.read("db/linked.sql").code, "not-regular");
  assert.equal(io.read("db/linkdir/leak.sql").code, "not-regular");
  const db = collect(io, "db");
  assert.deepEqual(db.files.map(([rel]) => rel), ["db/real.sql"]);
  assert.deepEqual(db.skipped.map((s) => s.path), ["db/linkdir", "db/linked.sql"]);
  const linked = collect(io, "linkedroot");
  assert.equal(linked.exists, false);
  assert.match(linked.skipped[0].reason, /not a real directory/);
});

test("POSIX: a name read() would refuse is skipped by walk, never handed out", { skip: !POSIX && "':' and '\\' are not filename characters on Windows" }, (t) => {
  const root = scratch({ "src/ok.cs": "", "src/a:b.cs": "", "src/c\\d.cs": "" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const src = collect(makeExtractorIo(root), "src");
  assert.deepEqual(src.files.map(([rel]) => rel), ["src/ok.cs"]);
  assert.equal(src.skipped.length, 2);
});

// The CLI seam: a local extractor receives io from derive.
const IO_EXTRACTOR = `export const FACTS_KEY_ORDER = { table: ["file"] };
export function derive({ io }) {
  if (!io) throw new Error("this extractor needs io");
  const records = [];
  const diagnostics = [];
  const walked = io.walk("db", (rel) => {
    if (!rel.endsWith(".sql")) return;
    const got = io.read(rel);
    if (!got.ok) return diagnostics.push(got.reason);
    for (const m of got.text.matchAll(/CREATE TABLE (\\w+)/g)) {
      records.push({ kind: "table", id: "table:" + m[1], title: m[1], description: "", resource: [rel], refs: [], facts: { file: rel }, filename: m[1] + ".json" });
    }
  });
  if (!walked.exists) diagnostics.push("db/ is missing — nothing to inventory");
  return { records, diagnostics };
}
`;

test("CLI: a local extractor is handed io; its records land; a bad io path fails derive naming the extractor", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-io-cli-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE_GREENFIELD, repo, { recursive: true });
  mkdirSync(join(repo, "zdd", "extractors"), { recursive: true });
  writeFileSync(join(repo, "zdd", "extractors", "rawsql.mjs"), IO_EXTRACTOR);
  mkdirSync(join(repo, "db"), { recursive: true });
  writeFileSync(join(repo, "db", "001.sql"), "CREATE TABLE orders (id int);\nCREATE TABLE customers (id int);\n");
  const configPath = join(repo, "zdd", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  writeFileSync(configPath, JSON.stringify({ ...config, localExtractorDir: "zdd/extractors", extractors: ["rawsql"] }, null, 2));
  const run = (args) => execFileSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(run(["derive"]), /Wrote 2 records \(2 tables\)/);
  const orders = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "table", "orders.json"), "utf8"));
  assert.deepEqual(orders.resource, ["db/001.sql"]);
  assert.match(run(["derive", "--check"]), /in sync \(2 records\)/);

  writeFileSync(join(repo, "zdd", "extractors", "rawsql.mjs"), IO_EXTRACTOR.replace('io.walk("db"', 'io.walk("../db"'));
  let err = "";
  try {
    run(["derive"]);
  } catch (e) {
    err = String(e.stderr);
  }
  assert.match(err, /Extractor 'rawsql' failed: rawsql: io\.walk directory '\.\.\/db' must be repo-relative POSIX/);
});
