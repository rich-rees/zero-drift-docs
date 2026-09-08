// The Stop hook, observed as a process: stdin in, exit code + stdout out,
// against throwaway git repos. It blocks — the JSON `{"decision":"block"}`
// reply, exit 0 (decision 0007's lesson: exit 2 fails open in Codex) — only
// when the repo opted in, code changed against the base branch, nothing in
// the bundle moved, the host is not already continuing from a block, and it
// has not blocked this session before. Everything else is silent, exit 0.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

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
  commit(repo, "base");
  if (remote) {
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(repo, "remote", "add", "origin", repo);
  }
  git(repo, "checkout", "-q", "-b", "feature");
  return repo;
}
const run = (repo, input = {}, { projectDir = repo } = {}) => {
  const env = { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir) env.CLAUDE_PROJECT_DIR = projectDir;
  return spawnSync(process.execPath, [STOP], { input: typeof input === "string" ? input : JSON.stringify({ hook_event_name: "Stop", session_id: "s1", ...input }), encoding: "utf8", env, cwd: repo });
};
const silent = (r, msg) => {
  assert.equal(r.status, 0, `${msg}: exit ${r.status} ${r.stderr}`);
  assert.equal(r.stdout, "", `${msg}: stdout`);
  assert.equal(r.stderr, "", `${msg}: stderr`);
};
const blocked = (r, msg) => {
  assert.equal(r.status, 0, `${msg}: exit ${r.status} ${r.stderr}`);
  let reply;
  assert.doesNotThrow(() => (reply = JSON.parse(r.stdout)), `${msg}: stdout is exactly one JSON object`);
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
  const reply = blocked(run(repo, { session_id: "uncommitted" }), "uncommitted change");
  assert.match(reply.reason, /1 file changed on this branch \(e\.g\. src\/a\.ts\)/);
  commit(repo, "change a");
  blocked(run(repo, { session_id: "committed" }), "committed change");
  writeFileSync(join(repo, "src", "new.ts"), "");
  const many = blocked(run(repo, { session_id: "untracked" }), "untracked file counts");
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

test("never traps the agent: silent on the host's stop_hook_active flag, and after one block per session id", () => {
  const repo = mkRepo();
  touchCode(repo);
  silent(run(repo, { stop_hook_active: true }), "host already continuing from a block");
  blocked(run(repo, { session_id: "once" }), "first stop this session");
  silent(run(repo, { session_id: "once" }), "second stop, same session");
  silent(run(repo, { session_id: "once" }), "third");
  blocked(run(repo, { session_id: "another" }), "a different session gets its own prompt");
  assert.ok(readdirSync(join(tmp, "zdd-stop")).length >= 2, "markers live under the temp dir");
  // No session id: the host flag is the only guard, and the prompt is not suppressed by a marker.
  blocked(run(repo, { session_id: undefined }), "no session id still prompts");
});

test("silent without the opt-in (absent key, false, pre-1.1 hooks block), without a valid config, and on garbage input", () => {
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
});

test("silent where there is no git checkout; falls back to the local base branch, then to HEAD, when origin/<base> is absent", () => {
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
  blocked(run(detached, { session_id: "wt" }), "…but the working tree still can");
});

test("finds the adopter root from the hook's cwd (a monorepo package) when the host gives no project dir; a cwd outside the checkout is ignored", () => {
  const repo = mkRepo();
  const sub = join(repo, "packages", "app");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "index.ts"), "");
  blocked(run(repo, { cwd: sub }, { projectDir: null }), "walks up from the package");
  silent(run(repo, { cwd: scratch }, { projectDir: null }), "a cwd with no config above it is not adopted");
  // The adopter root may itself sit inside a larger git checkout: paths are
  // judged relative to that root, so its zdd/ is still recognised.
  const mono = join(scratch, "mono");
  mkdirSync(join(mono, "apps", "web", "zdd"), { recursive: true });
  writeFileSync(join(mono, "apps", "web", "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], hooks: { stop: true } }));
  writeFileSync(join(mono, "apps", "web", "a.ts"), "");
  git(mono, "init", "-q", "-b", "main");
  commit(mono, "base");
  git(mono, "checkout", "-q", "-b", "f");
  writeFileSync(join(mono, "apps", "web", "a.ts"), "changed");
  blocked(run(mono, {}, { projectDir: join(mono, "apps", "web") }), "nested adopter root");
  writeFileSync(join(mono, "apps", "web", "zdd", "glossary.md"), "# G\n");
  silent(run(mono, { session_id: "s2" }, { projectDir: join(mono, "apps", "web") }), "…and its zdd/ counts as moved");
  assert.ok(existsSync(join(mono, ".git")));
});
