// Ignored paths are never source (CAS-103 pick 1). The services extractor's
// default roots `["."]` read a gitignored `.claude/worktrees/` (another
// checkout of the same repo, created by the Claude desktop app) into DiO's
// and Cascade's service records: local `derive --check` passed, CI failed.
// Every walk now vetoes what git ignores — `.gitignore`, `.git/info/exclude`
// and the global excludes alike, since the worktree folder is excluded
// through `info/exclude`, not `.gitignore` — and the worktree folder is
// vetoed even where git is absent. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { gitIgnoredPredicate, ALWAYS_IGNORED } from "../src/lib/ignored.mjs";
import { makeExtractorIo } from "../src/lib/extractor-io.mjs";
import { derive as services } from "../src/extractors/external-services/index.mjs";
import { derive as nextjs } from "../src/extractors/nextjs/index.mjs";
import { derive as fastapi } from "../src/extractors/fastapi/index.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE_SERVICES = join(PKG, "test", "fixture-services");

const scratch = (files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-ign-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const walked = (io, dir) => {
  const out = [];
  io.walk(dir, (rel) => out.push(rel));
  return out;
};

test("without git: the worktree folder is vetoed by name, nothing else is", (t) => {
  const root = scratch({ "src/a.ts": "a", ".claude/worktrees/x/src/a.ts": "a", "dist/b.ts": "b" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const isIgnored = gitIgnoredPredicate(root);
  assert.equal(isIgnored.source, "none", "no repo: git reports nothing");
  assert.equal(isIgnored(".claude/worktrees"), true);
  assert.equal(isIgnored(".claude/worktrees/x/src/a.ts"), true);
  assert.equal(isIgnored("dist/b.ts"), false, "a build folder is an extractor's own veto, never a guess here");
  assert.deepEqual(ALWAYS_IGNORED, [".claude/worktrees"]);
  assert.deepEqual(walked(makeExtractorIo(root), "."), ["dist/b.ts", "src/a.ts"]);
});

test("with git: .gitignore, .git/info/exclude and ignored files are all vetoed; tracked and plain untracked files are not", (t) => {
  const root = scratch({
    "src/a.ts": "a",
    "src/generated.ts": "g",
    "secrets/key.ts": "k",
    "untracked/new.ts": "n",
    "worktree-like/src/a.ts": "a",
    ".gitignore": "secrets/\nsrc/generated.ts\n",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  writeFileSync(join(root, ".git", "info", "exclude"), "worktree-like/\n");
  git(root, "add", "src/a.ts", ".gitignore");
  const isIgnored = gitIgnoredPredicate(root);
  assert.equal(isIgnored.source, "git");
  assert.equal(isIgnored("secrets"), true, "an ignored directory");
  assert.equal(isIgnored("secrets/key.ts"), true, "a file under an ignored directory");
  assert.equal(isIgnored("src/generated.ts"), true, "an ignored file");
  assert.equal(isIgnored("worktree-like"), true, "info/exclude counts");
  assert.equal(isIgnored("worktree-like/src/a.ts"), true);
  assert.equal(isIgnored("untracked/new.ts"), false, "untracked is still source — a new file on the branch");
  assert.equal(isIgnored("src/a.ts"), false);
  assert.deepEqual(walked(makeExtractorIo(root), "."), [".gitignore", "src/a.ts", "untracked/new.ts"]);
});

test("a repo root inside a larger git repo asks git relative to the root it was given", (t) => {
  const outer = scratch({ "pkg/src/a.ts": "a", "pkg/skip/b.ts": "b", ".gitignore": "pkg/skip/\n" });
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  git(outer, "init", "-q");
  const isIgnored = gitIgnoredPredicate(join(outer, "pkg"));
  assert.equal(isIgnored.source, "git");
  assert.equal(isIgnored("skip"), true);
  assert.equal(isIgnored("skip/b.ts"), true);
  assert.equal(isIgnored("src/a.ts"), false);
});

test("services: a declared service under a worktree copy does not become usedBy, with or without git", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-ign-svc-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE_SERVICES, repo, { recursive: true });
  // A worktree is another checkout of the same repo: a full copy of the source.
  cpSync(join(FIXTURE_SERVICES, "apps"), join(repo, ".claude", "worktrees", "feat-x", "apps"), { recursive: true });
  const options = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).extractorOptions["external-services"];
  const before = services({ repoRoot: FIXTURE_SERVICES, options, io: makeExtractorIo(FIXTURE_SERVICES, "external-services") });
  const after = services({ repoRoot: repo, options, io: makeExtractorIo(repo, "external-services") });
  assert.deepEqual(after.records, before.records, "the worktree copy changed nothing");
  assert.ok(!JSON.stringify(after.records).includes("worktrees"));
});

test("nextjs and fastapi (the walkDir extractors) honour the same veto through io", (t) => {
  const root = scratch({
    "src/app/page.tsx": "export default function P() { return null }\n",
    "src/app/api/x/route.ts": "export async function GET() {}\n",
    ".claude/worktrees/w/src/app/api/y/route.ts": "export async function GET() {}\n",
    "api/main.py": "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/a')\ndef a(): ...\n",
    "vendored/main.py": "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/b')\ndef b(): ...\n",
    ".gitignore": "vendored/\n",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  const io = makeExtractorIo(root, "t");
  const next = nextjs({ repoRoot: root, options: { appDir: "src/app" }, io });
  assert.deepEqual(next.records.filter((r) => r.kind === "route").map((r) => r.id), ["route:/api/x"]);
  const py = fastapi({ repoRoot: root, options: { roots: ["."] }, io });
  assert.deepEqual(py.records.map((r) => r.id), ["route:/a"]);
});

test("CLI: derive on a repo with an ignored worktree copy writes the same records as without it", (t) => {
  const plain = mkdtempSync(join(tmpdir(), "zdd-ign-cli-a-"));
  const withTree = mkdtempSync(join(tmpdir(), "zdd-ign-cli-b-"));
  t.after(() => {
    rmSync(plain, { recursive: true, force: true });
    rmSync(withTree, { recursive: true, force: true });
  });
  for (const repo of [plain, withTree]) cpSync(FIXTURE_SERVICES, repo, { recursive: true });
  cpSync(join(FIXTURE_SERVICES, "apps"), join(withTree, ".claude", "worktrees", "feat-x", "apps"), { recursive: true });
  const run = (repo) => execFileSync(process.execPath, [BIN, "derive"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run(plain);
  run(withTree);
  const read = (repo, rel) => (existsSync(join(repo, "zdd", "metadata", rel)) ? readFileSync(join(repo, "zdd", "metadata", rel), "utf8") : null);
  for (const rel of ["external-service/sentry.json", "external-service/resend.json"]) {
    assert.ok(read(plain, rel), `${rel} exists`);
    assert.equal(read(withTree, rel), read(plain, rel), `${rel} byte-identical`);
  }
});
