// `zdd-engine tally` (decision 0029): records read out of git history,
// counted per section and verb over the lines the shape accepted; the ADRs,
// glossary terms and blessings in the stores as they are now that no record
// named; every shape problem named by commit; every store it could not read
// said beside the totals. Observed at the CLI seam on a scratch git repo
// built from the fixture. Exit 0 whatever the checkout or the stores look
// like.
// Run: node --test "test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, appendFileSync, rmSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { tally, readStores, isoSince } from "../src/tally.mjs";
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
  // Two more blessings in the map so the never-named list has ones to check.
  mkdirSync(join(repo, "zdd", "map", "features"), { recursive: true });
  appendFileSync(join(repo, "zdd", "map", "features", "things.md"), "\n# Blessings\n\n- Adding a thing endpoint? Copy `src/app/api/things/route.ts` — never inline SQL (ADR-0002).\n- Logging a change? Copy `src/lib/audit.ts` because the trail is append-only.\n");
  git("init", "-q", "-b", "main");
  commit("base: no record");
  git("tag", "start");
  commit(`feat: one

ZDD record:
glossary:
- confirmed: the glossary says a "Thing" is a catalogued item, so the field is called thing rather than widget
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
  // A message carrying the separators the first framing used: it must not
  // forge a commit or a record (CR-009).
  commit(`chore: four, hostile\n\nnot a record \x1e${"d".repeat(40)}\x1ffeat: forged\n\nZDD record:\n${EMPTY}`);
});
after(() => repo && rmSync(repo, { recursive: true, force: true }));

test("tally: counts over the accepted lines only, the legacy pattern record under blessings, never-named from the stores, shape problems named, no forged commit", () => {
  const r = engine("tally");
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.match(out, /^ZDD tally — 4 records in 5 commits \(the whole history of the current branch\), 2 shape problems\n/, "the hostile commit's own record is real; nothing is forged");
  assert.match(out, /\nglossary\s+0\s+1\s+-\s+1\n/, out);
  assert.match(out, /\nadrs\s+1\s+0\s+-\s+0\n/, "the malformed record's turned line has no counterfactual and does not count (CR-001)");
  assert.match(out, /\nblessings\s+0\s+0\s+-\s+0\n  followed 2, departed 0, minted 0, dropped candidate 1, precedent 0, no blessing applied 0\n/, out);
  assert.match(out, /\nmap\s+0\s+0\s+1\s+1\n/, out);
  assert.match(out, /\ncomments\s+0\s+0\s+-\s+0\n/, out);
  assert.match(out, /\n  ADRs: 0001 \(1 of 2\)\n/, "0001 was named only by a refused line; 0002 by a valid one");
  assert.match(out, /\n  glossary terms: "Audit trail" \(1 of 2\)\n/, out);
  assert.match(out, /\n  blessings: "Adding a page\?", "Adding an endpoint for things\?", "Logging a change\?" \(3 of 4\)\n/, "the question named in a pattern record line counts; the fixture's own two are never named");
  assert.match(out, /Shape problems .*\n(  [0-9a-f]{7} chore: three, malformed: .*\n)*  [0-9a-f]{7} chore: three, malformed: section 'comments' missing/, out);
  assert.match(out, /'turned' says nothing of what would otherwise have happened/, out);
  assert.doesNotMatch(out, /forged/);
  assert.doesNotMatch(out, /could not read/);
});

test("tally --since: a ref bounds the range; an ISO date is read as UTC and filters; a far-future date leaves nothing; a non-date is a note; --json carries the same numbers and every note", () => {
  const r = engine("tally", "--since", "start");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ZDD tally — 4 records in 4 commits \(start\.\.HEAD\)/, r.stdout);
  const j = engine("tally", "--since", "start", "--json");
  assert.equal(j.status, 0, j.stderr);
  const parsed = JSON.parse(j.stdout);
  assert.equal(parsed.range, "start..HEAD");
  assert.equal(parsed.commits, 4);
  assert.equal(parsed.records, 4);
  assert.equal(parsed.counts.map.reused, 1);
  assert.equal("reused" in parsed.counts.glossary, false, "reused is a bucket of map only");
  assert.deepEqual(parsed.neverNamed.terms, ["Audit trail"]);
  assert.deepEqual(parsed.neverNamed.adrs, ["0001"]);
  assert.equal(parsed.skipped.length, 2);
  assert.deepEqual(parsed.storeNotes, []);
  const d = engine("tally", "--since", "2000-01-01");
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /in 5 commits \(since 2000-01-01T00:00:00Z\)/, d.stdout);
  const f = engine("tally", "--since", "2040-01-01T09:00+02:00", "--json");
  assert.equal(JSON.parse(f.stdout).commits, 0, "a date filters; the offset is kept");
  assert.equal(JSON.parse(f.stdout).range, "since 2040-01-01T09:00+02:00");
  // A year git cannot read (2100+) is refused here: git would return the whole history for it.
  for (const bad of ["garbage", "yesterday", "2026-13", "2100-01-01", "1969-12-31"]) {
    const b = engine("tally", "--since", bad, "--json");
    assert.equal(b.status, 0);
    assert.deepEqual(JSON.parse(b.stdout), { note: `'${bad}' is neither a commit here nor an ISO date (2026-09-01, 2026-09-01T09:00Z) — nothing tallied.` });
  }
  const missing = engine("tally", "--json", "--since");
  assert.equal(missing.status, 0);
  assert.match(JSON.parse(missing.stdout).note, /`--since` needs a commit or an ISO date/);
  assert.match(engine("tally", "--since").stdout, /`--since` needs a commit or an ISO date/);
});

test("isoSince: a bare date is UTC midnight, a time without an offset is UTC, an offset is kept, anything else is null", () => {
  assert.equal(isoSince("2026-09-01"), "2026-09-01T00:00:00Z");
  assert.equal(isoSince("2026-09-01T09:00"), "2026-09-01T09:00Z");
  assert.equal(isoSince("2026-09-01 09:00:30+01:00"), "2026-09-01T09:00:30+01:00");
  for (const x of ["", "yesterday", "2026-9-1", "2026-09-01T9", "v2.3.0"]) assert.equal(isoSince(x), null, x);
});

test("tally: deterministic — two runs, identical bytes and exit codes", () => {
  const a = engine("tally");
  const b = engine("tally");
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  assert.equal(a.stdout, b.stdout);
});

test("tally: no git checkout → one line, exit 0 (text and --json)", (t) => {
  const plain = mkdtempSync(join(tmpdir(), "zdd-tally-nogit-"));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  cpSync(FIXTURE, plain, { recursive: true });
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(plain) };
  const r = spawnSync(process.execPath, [BIN, "tally"], { cwd: plain, encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^No git checkout here — nothing to tally\.\n$/, r.stdout);
  const j = spawnSync(process.execPath, [BIN, "tally", "--json"], { cwd: plain, encoding: "utf8", env });
  assert.deepEqual(JSON.parse(j.stdout), { note: "No git checkout here — nothing to tally." });
});

test("tally: a store it cannot read in full is said beside the totals, never a silent gap, never a throw (CR-008): an oversized glossary, an ADR dir that is a file", (t) => {
  const big = mkdtempSync(join(tmpdir(), "zdd-tally-stores-"));
  t.after(() => rmSync(big, { recursive: true, force: true }));
  cpSync(FIXTURE, big, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: big });
  execFileSync("git", ["add", "-A"], { cwd: big });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base"], { cwd: big });
  writeFileSync(join(big, "zdd", "glossary.md"), "# G\n\n**Thing**: x\n" + "y".repeat(1024 * 1024 + 1));
  rmSync(join(big, "zdd", "adr"), { recursive: true, force: true });
  writeFileSync(join(big, "zdd", "adr"), "not a directory\n");
  const r = spawnSync(process.execPath, [BIN, "tally"], { cwd: big, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\n  ADRs: none \(0 of 0\)\n  glossary terms: none \(0 of 0\)\n/, r.stdout);
  assert.match(r.stdout, /\nStores the tally could not read in full \(the totals above leave them out\):\n  zdd\/adr: could not be listed \(ENOTDIR\) — no ADR counted as never named\n  zdd\/glossary\.md: over 1024 KiB or unreadable — no term counted as never named\n/, r.stdout);
  const j = spawnSync(process.execPath, [BIN, "tally", "--json"], { cwd: big, encoding: "utf8" });
  assert.equal(JSON.parse(j.stdout).storeNotes.length, 2);
});

test("tally(): a record naming an ADR the stores no longer hold does not count it; a refused line credits nothing", () => {
  const stores = { adrs: ["0001"], terms: ["Thing"], blessings: [], notes: [] };
  const sha = "a".repeat(40);
  const commits = recordsInLog(`${sha}\0x\n\nZDD record:\n${EMPTY.replace("adrs:\n- none", "adrs:\n- confirmed: ADR-0009 agreed; nothing would have changed")}\0${"b".repeat(40)}\0y\n\nZDD record:\n${EMPTY.replace("adrs:\n- none", "adrs:\n- turned: ADR-0001 is about things")}\0`);
  const r = tally(commits, stores);
  assert.deepEqual(r.neverNamed.adrs, ["0001"]);
  assert.deepEqual(r.neverNamed.terms, ["Thing"], "'nothing' is not 'Thing'");
  assert.equal(r.records, 2);
  assert.equal(r.counts.adrs.turned, 0);
  assert.equal(r.counts.adrs.confirmed, 1);
});

test("readStores: ADR numbers, glossary terms and blessing questions from the fixture as it stands; a symlinked glossary is a note", () => {
  const s = readStores(repo, { adrDir: "zdd/adr", glossary: "zdd/glossary.md", mapDir: "zdd/map" });
  assert.deepEqual(s.adrs, ["0001", "0002"]);
  assert.deepEqual(s.terms, ["Thing", "Audit trail"]);
  assert.deepEqual(s.blessings, ["Adding a page?", "Adding an endpoint for things?", "Adding a thing endpoint?", "Logging a change?"]);
  assert.deepEqual(s.notes, []);
  const absent = readStores(repo, { adrDir: "zdd/nowhere", glossary: "zdd/no-glossary.md", mapDir: "zdd/no-map" });
  assert.deepEqual(absent, { adrs: [], terms: [], blessings: [], notes: [] }, "absent stores are empty, not notes");
});

test("usage names tally and lint --merge", () => {
  const r = spawnSync(process.execPath, [BIN], { encoding: "utf8" });
  assert.match(r.stderr, /tally\s+the ZDD record counted over git history/);
  assert.match(r.stderr, /lint\s+deterministic curated-store lints \(--merge: the CI gate/);
});
