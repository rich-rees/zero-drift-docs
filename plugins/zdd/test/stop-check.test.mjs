// The Stop hook, observed as a process: stdin in, exit code + stdout out,
// against throwaway git repos. It blocks — the JSON `{"decision":"block"}`
// reply, exit 0 (decision 0007's lesson: exit 2 fails open in Codex) — only
// when the repo opted in, code changed against the base branch, nothing in
// the bundle moved, the host is not already continuing from a block, and it
// can PROVE it will not block again this session (a session id, and a marker
// it created itself). Everything else is silent, exit 0.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync, mkdirSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { gitRunner, classify } from "../scripts/stop-check.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STOP = join(PLUGIN, "scripts", "stop-check.mjs");

let scratch;
let tmp; // the hook's os.tmpdir(), redirected so session markers never leak
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-stop-"));
  tmp = join(scratch, "tmp");
  mkdirSync(tmp);
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (cwd, msg) => {
  git(cwd, "add", "-A");
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", msg);
};
// A repo with one commit on main (src/a.ts + a valid, opted-in config), on a
// feature branch, with a fake `origin/main` so the merge-base path is the
// real one.
let n = 0;
function mkRepo({ config = { extractors: ["generic"], hooks: { stop: true } }, remote = true } = {}) {
  const repo = join(scratch, `repo${n++}`);
  mkdirSync(join(repo, "zdd"), { recursive: true });
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(config));
  writeFileSync(join(repo, "zdd", "glossary.md"), "# Glossary\n");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "core.quotepath", "true"); // git's default: non-ASCII names are C-quoted in line output
  commit(repo, "base");
  if (remote) {
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(repo, "remote", "add", "origin", repo);
  }
  git(repo, "checkout", "-q", "-b", "feature");
  return repo;
}
let sid = 0;
const run = (repo, input = {}, { projectDir = repo, tmpDir = tmp, cwd = repo } = {}) => {
  const env = { ...process.env, TMPDIR: tmpDir, TMP: tmpDir, TEMP: tmpDir };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir) env.CLAUDE_PROJECT_DIR = projectDir;
  const payload = typeof input === "string" ? input : JSON.stringify({ hook_event_name: "Stop", session_id: `s${sid++}`, ...input });
  return spawnSync(process.execPath, [STOP], { input: payload, encoding: "utf8", env, cwd });
};
const silent = (r, msg) => {
  assert.equal(r.status, 0, `${msg}: exit ${r.status} ${r.stderr}`);
  assert.equal(r.stdout, "", `${msg}: stdout`);
  assert.equal(r.stderr, "", `${msg}: stderr`);
};
const blocked = (r, msg) => {
  assert.equal(r.status, 0, `${msg}: exit ${r.status} ${r.stderr}`);
  let reply;
  assert.doesNotThrow(() => (reply = JSON.parse(r.stdout)), `${msg}: stdout is exactly one JSON object (got ${JSON.stringify(r.stdout)})`);
  assert.equal(reply.decision, "block", msg);
  assert.match(reply.reason ?? "", /"update ZDD"/, `${msg}: names the ritual`);
  assert.match(reply.reason ?? "", /three-part/, `${msg}: names the honest alternative`);
  assert.match(reply.reason ?? "", /nothing under zdd\/ moved/, msg);
  assert.ok(!reply.reason.includes("\n"), `${msg}: one line`);
  assert.equal(r.stderr.trim(), reply.reason, `${msg}: reason mirrored on stderr`);
  return reply;
};
const touchCode = (repo, file = "src/a.ts") => writeFileSync(join(repo, file), `// changed ${Date.now()}\n`);

test("blocks once with the JSON block reply when code changed and nothing in zdd/ moved — committed or uncommitted, tracked or untracked", () => {
  const repo = mkRepo();
  silent(run(repo), "no changes yet");
  touchCode(repo);
  const reply = blocked(run(repo), "uncommitted change");
  assert.match(reply.reason, /1 file changed on this branch \(e\.g\. src\/a\.ts\)/);
  commit(repo, "change a");
  blocked(run(repo), "committed change");
  writeFileSync(join(repo, "src", "new.ts"), "");
  const many = blocked(run(repo), "untracked file counts");
  assert.match(many.reason, /2 files changed/);
});

test("silent when a ZDD artifact moved in the same diff — the ritual ran, or the answer was written down", () => {
  const repo = mkRepo();
  touchCode(repo);
  writeFileSync(join(repo, "zdd", "glossary.md"), "# Glossary\n\n**Thing**: a thing.\n");
  silent(run(repo), "glossary edited alongside");
  const moved = mkRepo({ config: { extractors: ["generic"], hooks: { stop: true }, paths: { adrDir: "docs/decisions" } } });
  touchCode(moved);
  mkdirSync(join(moved, "docs", "decisions"), { recursive: true });
  writeFileSync(join(moved, "docs", "decisions", "0001-x.md"), "# X\n");
  silent(run(moved), "a configured artifact path outside the bundle dir counts as ZDD");
  const onlyDocs = mkRepo();
  writeFileSync(join(onlyDocs, "zdd", "glossary.md"), "# Glossary\n\nmore\n");
  silent(run(onlyDocs), "a docs-only change is not code");
});

test("a non-ASCII artifact name (C-quoted in git's line output) is still a ZDD change; a non-ASCII code name is still code (CR-005)", () => {
  const repo = mkRepo();
  touchCode(repo);
  writeFileSync(join(repo, "zdd", "café.md"), "# é\n");
  silent(run(repo), "quoted zdd path recognised");
  const code = mkRepo();
  writeFileSync(join(code, "src", "café.ts"), "");
  const reply = blocked(run(code), "quoted code path");
  assert.match(reply.reason, /src\/café\.ts/, "the reason carries the real name, not the C-quoted one");
  if (process.platform !== "win32") {
    const ctrl = mkRepo();
    writeFileSync(join(ctrl, "src", "a\tb.ts"), "");
    assert.match(blocked(run(ctrl), "control character in a name").reason, /src\/a\?b\.ts/, "controls are neutralised in the reason");
  }
});

test("never traps the agent: silent on the host's stop_hook_active flag, after one block per session id, and without a usable session id (CR-001)", () => {
  const repo = mkRepo();
  touchCode(repo);
  silent(run(repo, { stop_hook_active: true }), "host already continuing from a block");
  blocked(run(repo, { session_id: "once" }), "first stop this session");
  silent(run(repo, { session_id: "once" }), "second stop, same session");
  silent(run(repo, { session_id: "once" }), "third");
  blocked(run(repo, { session_id: "another" }), "a different session gets its own prompt");
  assert.ok(readdirSync(join(tmp, "zdd-stop")).length >= 2, "markers live under the temp dir");
  // No session id, or one that cannot key a marker: nothing to promise "once" with, so no prompt at all.
  for (const session_id of [undefined, "", 42, { id: 1 }, "x".repeat(300)]) silent(run(repo, { session_id }), `session_id ${JSON.stringify(session_id)}`);
});

test("never traps the agent: a marker it cannot create exclusively means no block — unwritable temp dir, a pre-existing marker, a symlink in its place (CR-002)", (t) => {
  const repo = mkRepo();
  touchCode(repo);
  writeFileSync(join(scratch, "blocker-file"), "");
  silent(run(repo, {}, { tmpDir: join(scratch, "blocker-file", "tmp") }), "temp dir that cannot be created (a file in its path)");
  if (process.platform !== "win32") {
    const ro = join(scratch, "ro-tmp");
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    try {
      silent(run(repo, {}, { tmpDir: ro }), "read-only temp dir");
    } finally {
      chmodSync(ro, 0o700);
    }
  }
  // A file where the marker DIRECTORY should be: mkdir fails, so no block.
  const fileTmp = join(scratch, "file-tmp");
  mkdirSync(fileTmp);
  writeFileSync(join(fileTmp, "zdd-stop"), "");
  silent(run(repo, {}, { tmpDir: fileTmp }), "marker dir is a file");
  t.diagnostic("exclusive creation also refuses a pre-seeded symlink (O_EXCL) — covered by the once-per-session case above");
});

test("silent without the opt-in (absent key, false, pre-1.1 hooks block), without a valid config, and on garbage or oversized input (CR-003)", () => {
  for (const config of [{ extractors: ["generic"] }, { extractors: ["generic"], hooks: { stop: false } }, { extractors: ["generic"], hooks: { autoLoad: true, fence: true } }, "{ not json", "null"]) {
    const repo = mkRepo({ config: typeof config === "string" ? {} : config });
    if (typeof config === "string") writeFileSync(join(repo, "zdd", "config.json"), config);
    touchCode(repo);
    silent(run(repo), `config ${JSON.stringify(config)}`);
  }
  const repo = mkRepo();
  touchCode(repo);
  silent(run(repo, "not json at all"), "garbage stdin");
  silent(run(repo, ""), "empty stdin: no session to key a marker on, so no prompt");
  silent(run(repo, "[1]"), "a non-object payload");
  const big = JSON.stringify({ hook_event_name: "Stop", session_id: "big", pad: "x".repeat(300 * 1024) });
  const started = Date.now();
  silent(run(repo, big), "oversized payload");
  assert.ok(Date.now() - started < 5000, "rejected without reading it whole");
});

test("silent where there is no git checkout; falls back to the local base branch, then to HEAD, when origin/<base> is absent; an invalid baseBranch means main (CR-007)", () => {
  const noGit = join(scratch, "nogit");
  mkdirSync(join(noGit, "zdd"), { recursive: true });
  writeFileSync(join(noGit, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], hooks: { stop: true } }));
  writeFileSync(join(noGit, "a.ts"), "");
  silent(run(noGit), "no .git");

  const local = mkRepo({ remote: false });
  touchCode(local);
  commit(local, "change");
  blocked(run(local), "merge-base with the local main");

  const detached = mkRepo({ remote: false, config: { extractors: ["generic"], hooks: { stop: true }, baseBranch: "nonesuch" } });
  touchCode(detached);
  commit(detached, "committed change is invisible against HEAD alone");
  silent(run(detached), "no base at all: committed work cannot be judged");
  touchCode(detached);
  blocked(run(detached), "…but the working tree still can");

  // A value git would refuse as a branch name falls back to main instead of silently degrading to HEAD-only.
  for (const baseBranch of [".", "a..b", "-x", "a b", 42]) {
    const bad = mkRepo({ config: { extractors: ["generic"], hooks: { stop: true }, baseBranch } });
    touchCode(bad);
    commit(bad, "committed");
    blocked(run(bad), `baseBranch ${JSON.stringify(baseBranch)} → main`);
  }
});

test("finds the adopter root from the hook's cwd (a monorepo package) when the host gives no project dir; a cwd outside the checkout is ignored", () => {
  const repo = mkRepo();
  const sub = join(repo, "packages", "app");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "index.ts"), "");
  blocked(run(repo, { cwd: sub }, { projectDir: null }), "walks up from the package");
  silent(run(repo, { cwd: scratch }, { projectDir: null, cwd: scratch }), "a cwd with no config above it is not adopted");
});

test("nested adopter root inside a larger checkout: its zdd/ counts as moved, and a sibling package's changes are not its code (CR-009)", () => {
  const mono = join(scratch, "mono");
  mkdirSync(join(mono, "apps", "web", "zdd"), { recursive: true });
  mkdirSync(join(mono, "apps", "api"), { recursive: true });
  writeFileSync(join(mono, "apps", "web", "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], hooks: { stop: true } }));
  writeFileSync(join(mono, "apps", "web", "a.ts"), "");
  writeFileSync(join(mono, "apps", "api", "b.ts"), "");
  git(mono, "init", "-q", "-b", "main");
  commit(mono, "base");
  git(mono, "checkout", "-q", "-b", "f");
  const web = join(mono, "apps", "web");
  writeFileSync(join(mono, "apps", "api", "b.ts"), "changed");
  silent(run(mono, {}, { projectDir: web }), "sibling package only");
  writeFileSync(join(mono, "apps", "web", "a.ts"), "changed");
  const reply = blocked(run(mono, {}, { projectDir: web }), "nested adopter root");
  assert.match(reply.reason, /\(e\.g\. a\.ts\)/, "paths are adopter-relative in the reason");
  writeFileSync(join(mono, "apps", "web", "zdd", "glossary.md"), "# G\n");
  silent(run(mono, {}, { projectDir: web }), "…and its zdd/ counts as moved");
  assert.ok(existsSync(join(mono, ".git")));
});

test("root trust (CR-010): a payload cwd naming another adopted repo is ignored; a UNC project dir is never probed", () => {
  const mine = mkRepo();
  const other = mkRepo();
  touchCode(other);
  // The process runs in `mine` (no changes); the payload points at `other` (changes). Nothing may leak from `other`.
  silent(run(mine, { cwd: other }, { projectDir: null, cwd: mine }), "foreign cwd ignored");
  // A UNC/device CLAUDE_PROJECT_DIR is dropped, not probed (the walk starts from the process cwd instead).
  touchCode(mine);
  const started = Date.now();
  blocked(run(mine, {}, { projectDir: "\\\\nowhere.invalid\\share\\proj", cwd: mine }), "UNC project dir ignored, cwd walk still finds the repo");
  assert.ok(Date.now() - started < 5000, "no network round-trip");
});

test("the git runner shares one deadline across calls; classify folds case on Windows (CR-004, CR-006)", () => {
  const expired = gitRunner(Date.now() - 1);
  assert.throws(() => expired(process.cwd(), "rev-parse", "--show-toplevel"), /deadline/);
  const live = gitRunner(Date.now() + 5000);
  assert.ok(live(process.cwd(), "rev-parse", "--show-toplevel").length > 0);
  const split = classify({ top: "C:/r", paths: ["ZDD/map/x.md", "src/a.ts"] }, "C:/r", { extractors: ["generic"] });
  if (process.platform === "win32") assert.deepEqual(split, { zdd: ["ZDD/map/x.md"], code: ["src/a.ts"] });
  else assert.deepEqual(split, { zdd: [], code: ["ZDD/map/x.md", "src/a.ts"] });
});
