// CAS-103 pick 2, C6, C7 and Rich's additions to pick 5: the script side of
// the plain-words install. `preflight` checks every piece of tech ZDD needs
// and says, in plain words, what is missing, what ZDD uses it for and how to
// get it (C7). `detect` names where the repo is hosted, and `apply` writes
// the GitHub workflow only on GitHub — elsewhere it says the merge gate is
// three commands for the adopter's own pipeline and offers the pre-push hook
// (C6). `estimate` sizes the repo for the three install scenarios and the
// backfill offer. Every file bootstrap writes has an explanation — what it
// is, why it exists, who writes it, whether it is ever hand-edited — and the
// narration prints it under the file (pick 2); a test binds each writer to
// its explanation. Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { explain, ARTIFACT_EXPLANATIONS, hostOf } from "../scripts/bootstrap.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const ENGINE_FIXTURES = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "test");

let scratch, home;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-plain-"));
  home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const run = (root, args) => execFileSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${home}`, "--date=2026-10-09"], { encoding: "utf8" });
const runJson = (root, args) => JSON.parse(run(root, [...args, "--json"]));
const spawn = (root, args) => spawnSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${home}`, "--date=2026-10-09"], { encoding: "utf8" });
// The preflight talks to stand-in servers that run on THIS test's event loop,
// so it must be awaited, never run with a blocking exec.
const execAsync = promisify(execFile);
const runAsync = async (root, args) => {
  try {
    const r = await execAsync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${home}`, "--date=2026-10-09"], { encoding: "utf8" });
    return { status: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    return { status: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};
const answers = (name, a) => {
  const p = join(scratch, `${name}.json`);
  writeFileSync(p, JSON.stringify(a));
  return p;
};
const fresh = (name) => {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commit = (cwd, msg, date) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", msg, `--date=${date}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_COMMITTER_DATE: date } });

// A local registry and GitHub stand-in: the pinned engine answers 200, a
// missing version 404.
const serve = (handler) =>
  new Promise((ok) => {
    const s = createServer(handler);
    s.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() }));
  });

// --- C7: preflight ------------------------------------------------------------------

test("preflight: every requirement checked, each said in plain words with what ZDD uses it for; all present → exit 0 and one line per check", async (t) => {
  const registry = await serve((req, res) => {
    if (req.url === `/@rich-rees%2fzdd-engine/${VERSION}`) res.writeHead(200).end("{}");
    else res.writeHead(404).end("{}");
  });
  const github = await serve((_req, res) => res.writeHead(200).end("ok"));
  t.after(() => {
    registry.close();
    github.close();
  });
  const repo = fresh("preflight-ok");
  git(repo, "init", "-q");
  const first = await runAsync(repo, ["preflight", `--registry=${registry.url}`, `--github=${github.url}`, "--json"]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const json = JSON.parse(first.stdout);
  assert.deepEqual(json.checks.map((c) => [c.name, c.ok]), [["node", true], ["npx", true], ["git", true], ["repo", true], ["github", true], ["registry", true], ["engine", true]]);
  assert.equal(json.ok, true);
  for (const c of json.checks) assert.ok(/ZDD/.test(c.uses), `${c.name}: says what ZDD uses it for — ${c.uses}`);
  const text = (await runAsync(repo, ["preflight", `--registry=${registry.url}`, `--github=${github.url}`])).stdout;
  assert.match(text, /^Before anything is written, the things ZDD needs:/m);
  assert.match(text, /^  ok +Node\.js \d+\.\d+\.\d+ — ZDD's scripts and its engine run on it \(20 or newer\)/m, text);
  assert.match(text, /^  ok +git — /m);
  assert.match(text, /^  ok +the npm registry .* the engine, @rich-rees\/zdd-engine@[\d.]+, is there to download/m, text);
  assert.match(text, /No account is needed anywhere\./, text);
});

test("preflight: an unreachable registry, a GitHub stand-in that is down, a missing engine version and a folder that is no git repository each fail with the plain-words reason, how to get it, and 'nothing was written'; exit 1", async (t) => {
  const registry = await serve((_req, res) => res.writeHead(404).end("{}"));
  t.after(() => registry.close());
  const repo = fresh("preflight-fail");
  const dead = "http://127.0.0.1:9"; // the discard port: nothing listens
  const r = await runAsync(repo, ["preflight", `--registry=${registry.url}`, `--github=${dead}`]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = r.stdout;
  assert.match(out, /^  MISSING +a git repository — this folder is not one\. ZDD reads the repo's history for freshness and locks a release by a git tag; run `git init`/m, out);
  assert.match(out, /^  MISSING +github\.com — could not be reached .* ZDD and Matt Pocock's skills are installed from public GitHub repositories/m, out);
  assert.match(out, /^  MISSING +the engine, @rich-rees\/zdd-engine@[\d.]+ — the npm registry answered but does not have this version/m, out);
  assert.match(out, /Nothing was written\. Fix what is missing and run bootstrap again\./, out);
  const json = JSON.parse((await runAsync(repo, ["preflight", `--registry=${dead}`, `--github=${dead}`, "--json"])).stdout);
  assert.equal(json.ok, false);
  assert.match(json.checks.find((c) => c.name === "registry").says, /could not be reached/);
  assert.equal(json.checks.find((c) => c.name === "engine").ok, false, "with no registry the engine check cannot pass");
  assert.match(json.checks.find((c) => c.name === "engine").says, /not checked: the registry could not be reached/);
});

// --- C6: where the repo is hosted decides the CI offer ------------------------------

test("hostOf reads the provider from a remote url; detect reports it; apply writes the GitHub workflow only on GitHub and otherwise prints the three commands and offers the pre-push hook", () => {
  assert.equal(hostOf("https://github.com/o/r.git").kind, "github");
  assert.equal(hostOf("git@github.com:o/r.git").kind, "github");
  assert.equal(hostOf("https://gitlab.com/o/r.git").kind, "gitlab");
  assert.equal(hostOf("https://dev.azure.com/o/p/_git/r").kind, "azure");
  assert.equal(hostOf("o@vs-ssh.visualstudio.com:v3/o/p/r").kind, "azure");
  assert.equal(hostOf("https://bitbucket.org/o/r.git").kind, "bitbucket");
  assert.equal(hostOf("https://git.example.com/o/r.git").kind, "other");
  assert.equal(hostOf(null).kind, "none");

  const gh = fresh("host-github");
  git(gh, "init", "-q");
  git(gh, "remote", "add", "origin", "https://github.com/o/r.git");
  assert.deepEqual(runJson(gh, ["detect"]).host, { kind: "github", remote: "https://github.com/o/r.git" });
  const j1 = runJson(gh, ["apply", `--answers=${answers("h1", { extractors: ["generic"] })}`]);
  assert.ok(j1.wrote.includes(".github/workflows/zdd.yml"));
  assert.equal(j1.optIns.ci, true);

  const gl = fresh("host-gitlab");
  git(gl, "init", "-q");
  git(gl, "remote", "add", "origin", "https://gitlab.com/o/r.git");
  const d = runJson(gl, ["detect"]);
  assert.equal(d.host.kind, "gitlab");
  const j2 = runJson(gl, ["apply", `--answers=${answers("h2", { extractors: ["generic"] })}`]);
  assert.ok(!j2.wrote.includes(".github/workflows/zdd.yml"), j2.wrote.join("\n"));
  assert.equal(j2.optIns.ci, false, "the CI opt-in is recorded as off, honestly");
  assert.ok(j2.wrote.includes(".githooks/pre-push"), "the fallback is offered and taken by default");
  assert.ok(j2.notes.some((n) => /CI workflow not written: this repo's origin is gitlab \(.*\), and the workflow ZDD ships runs only on GitHub Actions/.test(n)), j2.notes.join("\n"));
  const text = run(gl, ["apply", `--answers=${answers("h3", { optIns: { stop: true } })}`]);
  assert.match(text, /The merge gate for your own pipeline is three commands, run on every pull request:/, text);
  assert.match(text, new RegExp(`npx -y @rich-rees/zdd-engine@${VERSION.replace(/\\./g, "\\\\.")} derive --check`));
  assert.match(text, /lint --merge/);
  assert.doesNotMatch(text, /in branch protection, require the `zdd` check/, "no GitHub-only instruction on GitLab");

  const none = fresh("host-none");
  const j3 = runJson(none, ["apply", `--answers=${answers("h4", { extractors: ["generic"] })}`]);
  assert.ok(j3.wrote.includes(".github/workflows/zdd.yml"), "no remote yet: the GitHub default stands, and the skill asks");
});

// --- the install scenarios and the backfill offer ------------------------------------

test("estimate: greenfield, young and mature are told apart by source and history; the backfill offer carries an honest review-time estimate per artifact", () => {
  const empty = fresh("estimate-empty");
  const e0 = runJson(empty, ["estimate"]);
  assert.equal(e0.scenario, "greenfield");
  assert.equal(e0.sourceFiles, 0);
  assert.equal(e0.backfill, null, "nothing to backfill");

  const young = fresh("estimate-young");
  mkdirSync(join(young, "src"), { recursive: true });
  for (let i = 0; i < 40; i++) writeFileSync(join(young, "src", `m${i}.ts`), `export const v${i} = ${i};\n`);
  git(young, "init", "-q");
  commit(young, "start", "2026-05-01T10:00:00");
  commit(young, "more", "2026-10-01T10:00:00");
  const e1 = runJson(young, ["estimate"]);
  assert.equal(e1.scenario, "young");
  assert.equal(e1.sourceFiles, 40);
  assert.equal(e1.commits, 2);
  assert.equal(e1.ageMonths, 5);
  assert.deepEqual(Object.keys(e1.backfill), ["glossary", "blessings", "adrs", "total"]);
  assert.match(e1.backfill.total, /^about \d+ minutes$|^about an hour$|^about \d+ hours$/);
  const text = run(young, ["estimate"]);
  assert.match(text, /^A young app: 40 source files, 2 commits over about 5 months\./m, text);
  assert.match(text, /The backfill, if you want it, is about .+ of your review time:/, text);
  assert.match(text, /glossary .* one reviewable file/, text);
  assert.match(text, /decisions .* only the ones that would surprise a newcomer;.*you supply the why/, text);

  const mature = fresh("estimate-mature");
  mkdirSync(join(mature, "src"), { recursive: true });
  for (let i = 0; i < 400; i++) writeFileSync(join(mature, "src", `m${i}.ts`), `export const v${i} = ${i};\n`);
  git(mature, "init", "-q");
  commit(mature, "start", "2021-01-01T10:00:00");
  commit(mature, "later", "2026-10-01T10:00:00");
  const e2 = runJson(mature, ["estimate"]);
  assert.equal(e2.scenario, "mature");
  assert.ok(e2.ageMonths >= 60);
  assert.match(run(mature, ["estimate"]), /^A mature codebase: 400 source files/m);
});

// --- pick 2: every file bootstrap writes is explained ---------------------------------

test("every path a fresh apply writes has an explanation — what, why, who writes it, whether it is hand-edited — and the narration prints it under the file; the generated artifacts are explained too", () => {
  const repo = fresh("explain");
  const text = run(repo, ["apply", `--answers=${answers("x1", { extractors: ["generic"], codex: true, stack: ["FastAPI"], apps: ["Web"] })}`]);
  const json = runJson(repo, ["apply", `--answers=${answers("x2", { codex: true })}`]);
  for (const rel of [...json.wrote, ...json.kept]) {
    const path = rel.replace(/ \(.*\)$/, "");
    const e = explain(path);
    assert.ok(e, `no explanation for ${path}`);
    for (const key of ["what", "why", "who", "handEdited"]) assert.ok(typeof e[key] === "string" && e[key].length > 10, `${path}: ${key}`);
  }
  assert.match(text, /^  wrote   zdd\/config\.json\n {10}what: /m, text);
  assert.match(text, /^  wrote   zdd\/instructions\.md\n {10}what: .*\n {10}why: .*\n {10}who: ZDD .*\n {10}hand-edited: never/m, text);
  assert.match(text, /^  wrote   zdd\/glossary\.md[\s\S]*?who: you/m, text);
  for (const generated of ["zdd/metadata/", "zdd/graph.json", "zdd/agent-index.md", "zdd/adr-index.md", "zdd/blessing-index.md", "zdd/human-index.html"]) {
    const e = explain(generated);
    assert.ok(e && /never/i.test(e.handEdited), `${generated}: generated, never hand-edited`);
  }
  assert.ok(ARTIFACT_EXPLANATIONS.length >= 14);
});
