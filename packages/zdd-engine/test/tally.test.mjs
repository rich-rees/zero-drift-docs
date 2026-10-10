// `zdd-engine tally` (decision 0029): records read out of git history,
// counted per section and verb; the ADRs, glossary terms and blessings in the
// stores as they are now that no record named; every shape problem named by
// commit. Observed at the CLI seam on a scratch git repo built from the
// fixture. Exit 0 whatever the checkout looks like.
// Run: node --test "test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, appendFileSync, rmSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { tally, readStores } from "../src/tally.mjs";
import { recordsInLog } from "../src/lib/zdd-record.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

let repo;
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const engine = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
const commit = (msg) => {
  appendFileSync(join(repo, "touch.txt"), "x\n");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg);
};
const EMPTY = "glossary:\n- none\nadrs:\n- none\nblessings:\n- none\nmap:\n- none\ncomments:\n- none\n";

before(() => {
  repo = mkdtempSync(join(tmpdir(), "zdd-tally-"));
  cpSync(FIXTURE, repo, { recursive: true });
  // A blessing in the map so the never-named list has one to check.
  mkdirSync(join(repo, "zdd", "map", "features"), { recursive: true });
  appendFileSync(join(repo, "zdd", "map", "features", "things.md"), "\n# Blessings\n\n- Adding a thing endpoint? Copy `src/app/api/things/route.ts` — never inline SQL (ADR-0002).\n- Logging a change? Copy `src/lib/audit.ts` because the trail is append-only.\n");
  git("init", "-q", "-b", "main");
  commit("base: no record");
  git("tag", "start");
  commit(`feat: one

ZDD record:
glossary:
- confirmed: the glossary says a "Thing" is a catalogued item, so the field is called thing, not widget
- stored: added the term "Stall" (a job that stopped reporting)
adrs:
- turned: ADR-0002 renamed widgets to things; I was about to call the table widgets
blessings:
- followed: "Adding a thing endpoint?" for the new PUT
map:
- reused: save_thing() already logs the change, so I did not write a second helper
- stored: the things page now lists the PUT route as its own
comments:
- none

Co-Authored-By: t <t@t>
`);
  commit(`fix: two

Pattern record:
- followed: things: Adding a thing endpoint? — the DELETE
- dropped candidate: Logging? — because one site
`);
  commit(`chore: three, malformed

ZDD record:
glossary:
- none
adrs:
- turned: ADR-0001 is about things
blessings:
- none
map:
- none
`);
});
after(() => repo && rmSync(repo, { recursive: true, force: true }));

test("tally: counts per section and verb over the branch, the legacy pattern record under blessings, never-named from the stores, shape problems named", () => {
  const r = engine("tally");
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.match(out, /^ZDD tally — 3 records in 4 commits \(the whole history of the current branch\), 2 shape problems\n/, out);
  assert.match(out, /\nglossary\s+0\s+1\s+-\s+1\n/, out);
  assert.match(out, /\nadrs\s+2\s+0\s+-\s+0\n/, "the malformed record's parseable turned line still counts");
  assert.match(out, /\nblessings\s+0\s+0\s+-\s+0\n  followed 2, departed 0, minted 0, dropped candidate 1, precedent 0, no blessing applied 0\n/, out);
  assert.match(out, /\nmap\s+0\s+0\s+1\s+1\n/, out);
  assert.match(out, /\ncomments\s+0\s+0\s+-\s+0\n/, out);
  assert.match(out, /\n  ADRs: none \(0 of 2\)\n/, "0001 named by the malformed record, 0002 by the first");
  assert.match(out, /\n  glossary terms: "Audit trail" \(1 of 2\)\n/, out);
  assert.match(out, /\n  blessings: "Adding a page\?", "Adding an endpoint for things\?", "Logging a change\?" \(3 of 4\)\n/, "the question named in a pattern record line counts; the fixture's own two are never named");
  assert.match(out, /Shape problems .*\n(  [0-9a-f]{7} chore: three, malformed: .*\n)*  [0-9a-f]{7} chore: three, malformed: section 'comments' missing/, out);
  assert.match(out, /'turned' says nothing of what would otherwise have happened/, out);
});

test("tally --since <ref>: only the commits after the ref; --since <date>: handed to git; --json carries the same numbers", () => {
  const r = engine("tally", "--since", "start");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ZDD tally — 3 records in 3 commits \(start\.\.HEAD\)/, r.stdout);
  const j = engine("tally", "--since", "start", "--json");
  assert.equal(j.status, 0, j.stderr);
  const parsed = JSON.parse(j.stdout);
  assert.equal(parsed.range, "start..HEAD");
  assert.equal(parsed.commits, 3);
  assert.equal(parsed.records, 3);
  assert.equal(parsed.counts.map.reused, 1);
  assert.deepEqual(parsed.neverNamed.terms, ["Audit trail"]);
  assert.equal(parsed.skipped.length, 2);
  const d = engine("tally", "--since", "2000-01-01");
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /\(since 2000-01-01\)/, d.stdout);
  const bad = engine("tally", "--since");
  assert.equal(bad.status, 0);
  assert.match(bad.stdout, /`--since` needs a ref or a date/);
});

test("tally: deterministic — two runs, identical bytes", () => {
  assert.equal(engine("tally").stdout, engine("tally").stdout);
});

test("tally: no git checkout → one line, exit 0 (text and --json)", (t) => {
  const plain = mkdtempSync(join(tmpdir(), "zdd-tally-nogit-"));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  cpSync(FIXTURE, plain, { recursive: true });
  const r = spawnSync(process.execPath, [BIN, "tally"], { cwd: plain, encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(plain) } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^No git checkout here — nothing to tally\.\n$/, r.stdout);
  const j = spawnSync(process.execPath, [BIN, "tally", "--json"], { cwd: plain, encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(plain) } });
  assert.deepEqual(JSON.parse(j.stdout), { note: "No git checkout here — nothing to tally." });
});

test("tally(): a record naming an ADR the stores no longer hold does not count it; terms match whole words only", () => {
  const stores = { adrs: ["0001"], terms: ["Thing"], blessings: [] };
  const commits = recordsInLog(`aaaaaaa\x1fx\n\nZDD record:\n${EMPTY.replace("adrs:\n- none", "adrs:\n- confirmed: ADR-0009 agreed; nothing changed")}\x1e`);
  const r = tally(commits, stores);
  assert.deepEqual(r.neverNamed.adrs, ["0001"]);
  assert.deepEqual(r.neverNamed.terms, ["Thing"], "'nothing' is not 'Thing'");
  assert.equal(r.records, 1);
});

test("readStores: ADR numbers, glossary terms and blessing questions from the fixture as it stands", () => {
  const s = readStores(repo, { adrDir: "zdd/adr", glossary: "zdd/glossary.md", mapDir: "zdd/map" });
  assert.deepEqual(s.adrs, ["0001", "0002"]);
  assert.deepEqual(s.terms, ["Thing", "Audit trail"]);
  assert.deepEqual(s.blessings, ["Adding a page?", "Adding an endpoint for things?", "Adding a thing endpoint?", "Logging a change?"]);
});

test("usage names tally", () => {
  const r = spawnSync(process.execPath, [BIN], { encoding: "utf8" });
  assert.match(r.stderr, /tally\s+the ZDD record counted over git history/);
});
