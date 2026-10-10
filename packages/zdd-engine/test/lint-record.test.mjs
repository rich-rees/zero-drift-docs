// `lint --merge` reads the branch's commits since the base and WARNS on a
// ZDD record the tally cannot fully read (decision 0029): shape only, never
// a failure, never on absence; where git cannot answer, one NOTE and the
// check skips. A plain `lint` never reads git. Observed at the CLI seam on a
// scratch git repo built from the fixture.
// Run: node --test "test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

let repo;
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const lint = (...args) => spawnSync(process.execPath, [BIN, "lint", ...args], { cwd: repo, encoding: "utf8" });
const commit = (msg) => {
  appendFileSync(join(repo, "touch.txt"), "x\n");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg);
};
const RECORD = /ZDD record/;

before(() => {
  repo = mkdtempSync(join(tmpdir(), "zdd-lintrec-"));
  cpSync(FIXTURE, repo, { recursive: true });
  git("init", "-q", "-b", "main");
  commit("base");
  git("checkout", "-q", "-b", "work");
});
after(() => repo && rmSync(repo, { recursive: true, force: true }));

test("lint --merge: a branch with no record is silent about records; a well-formed record is silent too", () => {
  let r = lint("--merge");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, RECORD, r.stderr);
  commit("feat: good\n\nZDD record:\nglossary:\n- none\nadrs:\n- confirmed: ADR-0002 says things, not widgets; I would have written widgets\nblessings:\n- none\nmap:\n- none\ncomments:\n- none\n");
  r = lint("--merge");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, RECORD, r.stderr);
});

test("lint --merge: a malformed record is a WARNING naming the commit and each shape problem, exit 0; a plain lint says nothing", () => {
  commit("feat: bad\n\nZDD record:\nglossary:\n- none\nadrs:\n- turned: ADR-0002 is about things\nmap:\n- none\ncomments:\n- none\n");
  const r = lint("--merge");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING: [0-9a-f]{7} "feat: bad" carries a ZDD record the tally cannot fully read/, r.stderr);
  assert.match(r.stderr, /\n  section 'blessings' missing/, r.stderr);
  assert.match(r.stderr, /\n  adrs: 'turned' says nothing of what would otherwise have happened/, r.stderr);
  assert.match(r.stdout, /store lints passed/);
  const plain = lint();
  assert.equal(plain.status, 0);
  assert.doesNotMatch(plain.stderr, RECORD, "a plain lint never reads git");
});

test("lint --merge: the base is origin/<baseBranch> first, then <baseBranch>; on main itself the range is empty and nothing is said", () => {
  git("checkout", "-q", "main");
  const r = lint("--merge");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, RECORD, r.stderr);
  git("checkout", "-q", "work");
});

test("lint --merge: no git checkout → one NOTE, exit 0", (t) => {
  const plain = mkdtempSync(join(tmpdir(), "zdd-lintrec-nogit-"));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  cpSync(FIXTURE, plain, { recursive: true });
  const r = spawnSync(process.execPath, [BIN, "lint", "--merge"], { cwd: plain, encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(plain) } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /NOTE: ZDD record check skipped — no git checkout here/, r.stderr);
});
