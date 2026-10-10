// `lint --merge` reads the branch's commits since the base and WARNS on a
// ZDD record the tally cannot fully read (decision 0029): shape only, never
// a failure, never on absence; where git cannot answer, one NOTE and the
// check skips. A plain `lint` never runs git. Observed at the CLI seam on a
// scratch git repo built from the fixture, with a real `origin`.
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

let root, repo;
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const lint = (...args) => spawnSync(process.execPath, [BIN, "lint", ...args], { cwd: repo, encoding: "utf8" });
const commit = (msg) => {
  appendFileSync(join(repo, "touch.txt"), "x\n");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg);
};
const RECORD = /ZDD record/;
const ALL_NONE = "glossary:\n- none\nadrs:\n- none\nblessings:\n- none\nmap:\n- none\ncomments:\n- none\n";

before(() => {
  root = mkdtempSync(join(tmpdir(), "zdd-lintrec-"));
  repo = join(root, "repo");
  cpSync(FIXTURE, repo, { recursive: true });
  git("init", "-q", "-b", "main");
  commit("base");
  // A real origin: origin/main is what CI's checkout has, and it is read first.
  execFileSync("git", ["clone", "-q", "--bare", repo, join(root, "origin.git")], { cwd: root });
  git("remote", "add", "origin", join(root, "origin.git"));
  git("fetch", "-q", "origin");
  git("checkout", "-q", "-b", "work");
});
after(() => root && rmSync(root, { recursive: true, force: true }));

test("lint --merge: a branch with no record is silent about records; a well-formed record is silent too", () => {
  let r = lint("--merge");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, RECORD, r.stderr);
  commit("feat: good\n\nZDD record:\n" + ALL_NONE.replace("adrs:\n- none", "adrs:\n- confirmed: ADR-0002 says things, not widgets; I would have written widgets"));
  r = lint("--merge");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, RECORD, r.stderr);
});

test("lint --merge: a malformed record is a WARNING naming the commit and each shape problem, exit 0; the subject is sanitised; a plain lint runs no git", () => {
  commit("feat: bad ‮\x07\n\nZDD record:\nglossary:\n- none\nadrs:\n- turned: ADR-0002 is about things\nmap:\n- none\ncomments:\n- none\n");
  const r = lint("--merge");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING: [0-9a-f]{7} "feat: bad \?\?" carries a ZDD record the tally cannot fully read/, r.stderr);
  assert.match(r.stderr, /\n  section 'blessings' missing/, r.stderr);
  assert.match(r.stderr, /\n  adrs: 'turned' says nothing of what would otherwise have happened/, r.stderr);
  assert.match(r.stdout, /store lints passed/);
  // No git on PATH at all: a plain lint neither notes nor warns about records.
  const plain = spawnSync(process.execPath, [BIN, "lint"], { cwd: repo, encoding: "utf8", env: { ...process.env, PATH: "" } });
  assert.equal(plain.status, 0, plain.stderr);
  assert.doesNotMatch(plain.stderr, RECORD, plain.stderr);
  assert.doesNotMatch(plain.stderr, /record check skipped/, plain.stderr);
});

test("lint --merge: origin/<baseBranch> is the base when it exists — commits origin has not seen are read, commits it has are not; without a remote the local branch is the base", () => {
  // Push the branch's commits to origin's main: they leave the range.
  git("push", "-q", "origin", "work:main");
  git("fetch", "-q", "origin");
  let r = lint("--merge");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, RECORD, "everything is on origin/main now, nothing to read");
  commit("feat: after push\n\nZDD record:\nglossary:\n- none\n");
  r = lint("--merge");
  assert.match(r.stderr, /WARNING: [0-9a-f]{7} "feat: after push"/, r.stderr);
  // Local main is still at the base: without origin, every branch commit is in range.
  git("remote", "remove", "origin");
  r = lint("--merge");
  assert.match(r.stderr, /WARNING: [0-9a-f]{7} "feat: bad \?\?"/, "read against local main (CR-P3: the fallback, proven apart)");
  assert.match(r.stderr, /WARNING: [0-9a-f]{7} "feat: after push"/, r.stderr);
});

test("lint --merge: no git checkout → one NOTE, exit 0", (t) => {
  const plain = mkdtempSync(join(tmpdir(), "zdd-lintrec-nogit-"));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  cpSync(FIXTURE, plain, { recursive: true });
  const r = spawnSync(process.execPath, [BIN, "lint", "--merge"], { cwd: plain, encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(plain) } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /NOTE: ZDD record check skipped — no git checkout here/, r.stderr);
});
