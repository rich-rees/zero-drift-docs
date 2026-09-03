// Seam 2 — the bootstrap runbook observed as files on disk. The skill is the
// conversation; scripts/bootstrap.mjs is what reads the stack and writes the
// repo, so it is driven here with scripted answer sets against fixture repos
// (throwaway copies of the engine's fixtures) and the results asserted on
// disk. No LLM in the loop; with --date pinned, same bytes in ⇒ same files out.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, cpSync, mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const ENGINE_BIN = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "bin", "zdd-engine.mjs");
const ENGINE_FIXTURES = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "test");
const PLUGIN_VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const OWNER = "Managed by Zero-Drift Docs (zdd)";
const DATE = "2026-09-04";

let scratch;
let fakeHome; // no mattpocock-skills here
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-bootstrap-"));
  fakeHome = join(scratch, "home");
  mkdirSync(fakeHome, { recursive: true });
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const bootstrap = (root, args) =>
  execFileSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${fakeHome}`, `--date=${DATE}`], { encoding: "utf8" });
const bootstrapFails = (root, args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${fakeHome}`, `--date=${DATE}`], { encoding: "utf8" });
  assert.equal(r.status, 1, `expected failure: ${r.stdout}`);
  return r.stderr;
};
const engine = (root, args) => execFileSync(process.execPath, [ENGINE_BIN, ...args, `--root=${root}`], { encoding: "utf8" });

function answersFile(name, answers) {
  const p = join(scratch, `${name}.json`);
  writeFileSync(p, JSON.stringify(answers));
  return p;
}
const applyJson = (repo, name, answers) => JSON.parse(bootstrap(repo, ["apply", `--answers=${answersFile(name, answers)}`, "--json"]));
function fresh(name, from) {
  const dir = join(scratch, name);
  if (from) cpSync(from, dir, { recursive: true });
  else mkdirSync(dir, { recursive: true });
  return dir;
}
// Path-aware content hash of a tree (or one file).
function hashTree(root) {
  const h = createHash("sha256");
  const rec = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) rec(p);
      else h.update(relative(root, p)).update("\0").update(readFileSync(p)).update("\0");
    }
  };
  if (!existsSync(root)) return "absent";
  if (statSync(root).isDirectory()) rec(root);
  else h.update(readFileSync(root));
  return h.digest("hex");
}
const fastapiRepo = (name) => {
  const repo = fresh(name, join(ENGINE_FIXTURES, "fixture-fastapi"));
  rmSync(join(repo, "zdd"), { recursive: true });
  return repo;
};

// --- detect --------------------------------------------------------------------

test("detect: names the evidence for each proposed extractor (FastAPI + Supabase)", () => {
  const repo = fastapiRepo("detect");
  const text = bootstrap(repo, ["detect"]);
  assert.match(text, /Mode: EXISTING/);
  assert.match(text, /SQL migrations under `supabase\/migrations`/);
  assert.match(text, /`APIRouter` under `api\/routes`/);
  assert.match(text, /`FastAPI\(\)` app at the repo root/);
  const json = JSON.parse(bootstrap(repo, ["detect", "--json"]));
  assert.deepEqual(json.proposals.map((p) => p.name), ["supabase", "fastapi"]);
  assert.deepEqual(json.proposals[0].options, { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] });
  assert.deepEqual(json.proposals[1].options, { roots: ["api", "main.py"] });
  assert.equal(json.pocock.installed, false);
});

test("detect: Next.js App Router + middleware + migrations (the engine's Next.js fixture)", () => {
  const repo = fresh("detect-next", join(ENGINE_FIXTURES, "fixture"));
  rmSync(join(repo, "zdd"), { recursive: true });
  const json = JSON.parse(bootstrap(repo, ["detect", "--json"]));
  assert.deepEqual(json.proposals.map((p) => p.name), ["supabase", "nextjs"]);
  assert.deepEqual(json.proposals[0].options.migrationNamespaces, [{ name: "db", dir: "migrations" }]);
  assert.deepEqual(json.proposals[1].options, { appDir: "src/app", apiPrefix: "/api", middlewarePath: "src/middleware.ts" });
  assert.ok(json.proposals[1].evidence.some((e) => e.includes("App Router tree at `src/app`")));
  // dependency-only Next.js: no tree yet, `next` in package.json
  const bare = fresh("detect-next-dep");
  writeFileSync(join(bare, "package.json"), JSON.stringify({ dependencies: { next: "15", expo: "52", "react-router-dom": "7" } }));
  writeFileSync(join(bare, "index.ts"), "");
  const j2 = JSON.parse(bootstrap(bare, ["detect", "--json"]));
  assert.deepEqual(j2.proposals.map((p) => p.name), ["nextjs"]);
  assert.equal(j2.proposals[0].options.appDir, "src/app");
  assert.deepEqual(j2.apps.map((a) => a.name), ["Mobile (Expo)", "Web (React)"]);
});

test("detect: several migration dirs get distinct namespace names; symlinked dirs are not followed", (t) => {
  const repo = fresh("detect-multi");
  for (const d of ["apps/a/supabase/migrations", "apps/b/supabase/migrations"]) {
    mkdirSync(join(repo, d), { recursive: true });
    writeFileSync(join(repo, d, "0001.sql"), "create table t(id int);");
  }
  const json = JSON.parse(bootstrap(repo, ["detect", "--json"]));
  assert.deepEqual(json.proposals[0].options.migrationNamespaces, [
    { name: "apps-a", dir: "apps/a/supabase/migrations" },
    { name: "apps-b", dir: "apps/b/supabase/migrations" },
  ]);
  const outside = fresh("detect-outside");
  mkdirSync(join(outside, "api"), { recursive: true });
  writeFileSync(join(outside, "api", "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n");
  try {
    symlinkSync(join(outside, "api"), join(repo, "linked"), "junction");
  } catch {
    return t.diagnostic("symlink creation not permitted here — symlink case skipped");
  }
  const j2 = JSON.parse(bootstrap(repo, ["detect", "--json"]));
  assert.ok(!j2.proposals.some((p) => p.name === "fastapi"), "code behind a link is not inventoried");
});

// --- existing codebase ---------------------------------------------------------

test("apply on the FastAPI+Supabase fixture with all defaults: config, owned workflow, hook registrations, snippet, dated ADR-0001", () => {
  const repo = fastapiRepo("existing");
  const out = bootstrap(repo, ["apply", `--answers=${answersFile("existing", { name: "Fixture FastAPI" })}`]);

  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(config.extractors, ["supabase", "fastapi"]);
  assert.deepEqual(config.extractorOptions.supabase.migrationNamespaces, [{ name: "db", dir: "supabase/migrations" }]);
  assert.deepEqual(config.extractorOptions.fastapi.roots, ["api", "main.py"]);
  assert.equal(config.engine, PLUGIN_VERSION);
  assert.deepEqual(config.hooks, { autoLoad: true, fence: true }, "auto-load + fence registrations recorded");

  const wf = readFileSync(join(repo, ".github", "workflows", "zdd.yml"), "utf8");
  assert.ok(wf.includes(`@rich-rees/zdd-engine@${PLUGIN_VERSION}`));
  assert.ok(wf.includes(OWNER), "workflow carries the ownership line");
  assert.ok(!existsSync(join(repo, ".githooks", "pre-push")), "pre-push not written when CI accepted");

  const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  assert.ok(claude.startsWith("<!-- zdd:begin -->\n"), "exact begin marker");
  assert.ok(claude.includes('"load ZDD"') && claude.includes('"update ZDD"'), "leads with the spoken verbs");
  assert.ok(!existsSync(join(repo, "AGENTS.md")), "AGENTS.md only for Codex users");

  const adr = readFileSync(join(repo, "zdd", "adr", "0001-adopt-zero-drift-docs.md"), "utf8");
  assert.ok(adr.includes(`(${DATE})`), "ADR-0001 carries the date");
  assert.ok(!adr.includes("<DATE>"));
  assert.ok(existsSync(join(repo, "zdd", "glossary.md")));
  assert.match(out, /branch protection/i, "branch protection is the printed step");
  assert.match(out, /mattpocock-skills: NOT installed/);
  assert.match(out, /plugin install/);

  // The written config actually drives the engine against the detected tree.
  assert.match(engine(repo, ["derive"]), /Wrote \d+ records/);
  assert.match(engine(repo, ["derive", "--check"]), /in sync/);
});

test("apply is idempotent and byte-stable: a second run keeps everything; two fresh runs produce identical trees", () => {
  const a = fastapiRepo("stable-a");
  const b = fastapiRepo("stable-b");
  bootstrap(a, ["apply", `--answers=${answersFile("stable", { name: "X" })}`]);
  bootstrap(b, ["apply", `--answers=${answersFile("stable", { name: "X" })}`]);
  assert.equal(hashTree(a), hashTree(b), "same answers, same bytes");

  writeFileSync(join(a, "zdd", "glossary.md"), "# Glossary\n\n**Job**: a listing.\n");
  const before = hashTree(join(a, "zdd"));
  const claudeBefore = readFileSync(join(a, "CLAUDE.md"), "utf8");
  const json = applyJson(a, "again", {});
  assert.equal(json.mode, "repair");
  assert.deepEqual(json.wrote, [], `second run wrote: ${json.wrote}`);
  assert.ok(json.kept.includes("zdd/config.json"));
  assert.ok(json.kept.includes("zdd/glossary.md"));
  assert.equal(hashTree(join(a, "zdd")), before);
  assert.equal(readFileSync(join(a, "CLAUDE.md"), "utf8"), claudeBefore);
});

test("repair: an omitted opt-in keeps the current choice; an explicit one changes it", () => {
  const repo = fresh("repair-optins");
  applyJson(repo, "r1", { optIns: { autoLoad: false, fence: false, ci: false, prePush: false } });
  const j1 = applyJson(repo, "r2", {});
  assert.deepEqual(j1.optIns, { autoLoad: false, fence: false, ci: false, prePush: false }, "omitted answers inherit");
  assert.ok(!existsSync(join(repo, ".github", "workflows", "zdd.yml")));
  assert.deepEqual(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).hooks, { autoLoad: false, fence: false });
  const j2 = applyJson(repo, "r3", { optIns: { fence: true } });
  assert.deepEqual(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).hooks, { autoLoad: false, fence: true });
  assert.ok(j2.wrote.includes("zdd/config.json"));
  // A pre-opt-in config (no hooks key) reads as autoLoad on, fence off.
  const legacy = fresh("repair-legacy");
  mkdirSync(join(legacy, "zdd"));
  writeFileSync(join(legacy, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"] }));
  const j3 = applyJson(legacy, "r4", {});
  assert.deepEqual(j3.optIns, { autoLoad: true, fence: false, ci: false, prePush: false });
  assert.equal(JSON.parse(readFileSync(join(legacy, "zdd", "config.json"), "utf8")).hooks, undefined, "config untouched when nothing changed");
});

test("apply refuses to write when an existing config cannot be read, or points outside the checkout", () => {
  const repo = fresh("bad-config");
  mkdirSync(join(repo, "zdd"));
  writeFileSync(join(repo, "zdd", "config.json"), "{ truncated");
  assert.match(bootstrapFails(repo, ["apply", `--answers=${answersFile("bc", {})}`]), /does not parse/);
  assert.equal(readFileSync(join(repo, "zdd", "config.json"), "utf8"), "{ truncated", "left exactly as it was");
  assert.ok(!existsSync(join(repo, "CLAUDE.md")) && !existsSync(join(repo, "zdd", "glossary.md")), "nothing else written");
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], paths: { adrDir: "../../shared" } }));
  assert.match(bootstrapFails(repo, ["apply", `--answers=${answersFile("bc", {})}`]), /paths\.adrDir/);
  assert.ok(!existsSync(join(scratch, "shared")));
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], paths: { glossary: "C:/tmp/g.md" } }));
  assert.match(bootstrapFails(repo, ["apply", `--answers=${answersFile("bc", {})}`]), /paths\.glossary/);
});

test("apply validates the whole answer set before the first write", () => {
  const repo = fresh("bad-answers");
  for (const [answers, re] of [
    [{ apps: {} }, /apps must be/],
    [{ apps: [null] }, /apps must be/],
    [{ apps: ["Web\nAdmin"] }, /apps must be/],
    [{ optIns: { ci: "yes" } }, /optIns\.ci/],
    [{ optIns: { fences: true } }, /not an opt-in/],
    [{ extractors: "supabase" }, /extractors must be/],
    [{ extractors: ["supabase", "supabase"] }, /twice/],
    [{ stack: [{ name: "FastAPI", path: "../api" }] }, /must not contain/],
    [{ repoBase: "ftp://x" }, /repoBase/],
    [{ codex: "true" }, /codex must be/],
    [[], /must be a JSON object/],
  ]) {
    assert.match(bootstrapFails(repo, ["apply", `--answers=${answersFile("ba", answers)}`]), re, JSON.stringify(answers));
  }
  assert.deepEqual(readdirSync(repo), [], "nothing written by any of them");
});

// --- greenfield ------------------------------------------------------------------

test("apply on an empty repo with the greenfield stack: extractors at the future paths, map skeleton names the apps, engine checks pass on empty metadata", () => {
  const repo = fresh("greenfield");
  const answers = answersFile("greenfield", { name: "Foodbank", stack: ["FastAPI", "Supabase", "React web", "Expo"] });
  assert.match(bootstrap(repo, ["detect"]), /Mode: GREENFIELD/);
  bootstrap(repo, ["apply", `--answers=${answers}`]);

  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(config.extractors, ["fastapi", "supabase"]);
  assert.deepEqual(config.extractorOptions.fastapi, { roots: ["api"] });
  assert.deepEqual(config.extractorOptions.supabase, { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] });
  assert.equal(config.render.storeChanges, false, "no .git → render without git");

  const apps = readdirSync(join(repo, "zdd", "map", "apps")).sort();
  assert.deepEqual(apps, [".gitkeep", "mobile.md", "web.md"]);
  assert.ok(readFileSync(join(repo, "zdd", "map", "apps", "web.md"), "utf8").includes('title: "Web (React)"'));
  assert.ok(readFileSync(join(repo, "zdd", "map", "apps", "mobile.md"), "utf8").includes('title: "Mobile (Expo)"'));

  engine(repo, ["derive"]);
  assert.match(engine(repo, ["derive", "--check"]), /in sync/);
  engine(repo, ["render"]);
  assert.match(engine(repo, ["render", "--check"]), /in sync/);
  assert.ok(existsSync(join(repo, "zdd", "agent-index.md")));
});

test("dedupe never collides with a raw name already in the set (CR-047), and a second stack entry for the same extractor adds its path (CR-042)", () => {
  const repo = fresh("dedupe");
  bootstrap(repo, ["apply", `--answers=${answersFile("dd", { stack: ["FastAPI", { name: "FastAPI", path: "workers" }, { name: "Supabase", path: "db/a/migrations" }, { name: "Supabase", path: "db/b/migrations" }], apps: ["foo-2", "foo", "foo"] })}`]);
  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(config.extractorOptions.fastapi.roots, ["api", "workers"]);
  assert.deepEqual(config.extractorOptions.supabase.migrationNamespaces.map((m) => m.name), ["db", "db-2"]);
  assert.deepEqual(readdirSync(join(repo, "zdd", "map", "apps")).sort(), [".gitkeep", "foo-2.md", "foo-3.md", "foo.md"]);
  const conflict = fresh("dedupe-conflict");
  assert.match(bootstrapFails(conflict, ["apply", `--answers=${answersFile("dc", { stack: [{ name: "Next.js", path: "app" }, { name: "Next.js", path: "src/app" }] })}`]), /different nextjs\.appDir/);
  assert.deepEqual(readdirSync(conflict), [], "nothing written");
});

test("stack entries may carry their future path; app names are YAML-safe and slugs never collide", () => {
  const repo = fresh("greenfield-paths");
  bootstrap(repo, ["apply", `--answers=${answersFile("gp", { stack: [{ name: "FastAPI", path: "backend/app" }, { name: "Supabase", path: "db/migrations" }], apps: ["Web: Admin", "Mobile", "Mobile (Expo)", "日本語"] })}`]);
  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(config.extractorOptions.fastapi.roots, ["backend/app"]);
  assert.equal(config.extractorOptions.supabase.migrationNamespaces[0].dir, "db/migrations");
  assert.deepEqual(readdirSync(join(repo, "zdd", "map", "apps")).sort(), [".gitkeep", "app.md", "mobile-2.md", "mobile.md", "web-admin.md"]);
  assert.ok(readFileSync(join(repo, "zdd", "map", "apps", "web-admin.md"), "utf8").includes('title: "Web: Admin"'));
  engine(repo, ["render"]); // the frontmatter parses
});

test("existing repo with React/Expo dependencies: detected apps land in the map skeleton", () => {
  const repo = fresh("apps-detected");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ dependencies: { expo: "52" } }));
  writeFileSync(join(repo, "index.ts"), "");
  bootstrap(repo, ["apply", `--answers=${answersFile("ad", {})}`]);
  assert.deepEqual(readdirSync(join(repo, "zdd", "map", "apps")).sort(), [".gitkeep", "mobile.md"]);
});

// --- opt-ins -------------------------------------------------------------------------

test("CI declined: no workflow, owned pre-push written, closing text says the guarantee is weaker", () => {
  const repo = fastapiRepo("no-ci");
  const out = bootstrap(repo, ["apply", `--answers=${answersFile("no-ci", { optIns: { ci: false, prePush: true } })}`]);
  assert.ok(!existsSync(join(repo, ".github", "workflows", "zdd.yml")));
  const hook = readFileSync(join(repo, ".githooks", "pre-push"), "utf8");
  assert.ok(hook.startsWith("#!/bin/sh"));
  assert.ok(hook.includes(OWNER));
  assert.ok(hook.includes(`@rich-rees/zdd-engine@${PLUGIN_VERSION}`));
  assert.match(out, /weaker without CI/);
  assert.match(out, /core\.hooksPath/, "no .git in the fixture → the git config step is printed");
});

test("CI declined and pre-push declined: neither written, still narrated", () => {
  const repo = fresh("no-ci-no-hook");
  const json = applyJson(repo, "nn", { optIns: { ci: false, prePush: false, fence: false } });
  assert.ok(!existsSync(join(repo, ".githooks", "pre-push")));
  assert.ok(json.skipped.some((s) => s.startsWith(".githooks/pre-push")));
  assert.deepEqual(json.config.hooks, { autoLoad: true, fence: false });
});

test("a same-named file the plugin does not own is kept and called out, never overwritten", () => {
  const repo = fresh("unowned");
  mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
  writeFileSync(join(repo, ".github", "workflows", "zdd.yml"), "name: mine\n");
  mkdirSync(join(repo, ".githooks"));
  writeFileSync(join(repo, ".githooks", "pre-push"), "#!/bin/sh\necho mine\n");
  const j1 = applyJson(repo, "u1", {});
  assert.equal(readFileSync(join(repo, ".github", "workflows", "zdd.yml"), "utf8"), "name: mine\n");
  // The ownership phrase in the body is not a header: still not ours.
  writeFileSync(join(repo, ".github", "workflows", "zdd.yml"), "name: mine\n\n\n\n# mentions Managed by Zero-Drift Docs (zdd) in prose\n");
  const j1b = JSON.parse(bootstrap(repo, ["upgrade", "--json"]));
  assert.ok(j1b.kept.some((k) => k.startsWith(".github/workflows/zdd.yml") && k.includes("not managed")), JSON.stringify(j1b.kept));
  assert.ok(j1.notes.some((n) => n.includes("zdd.yml") && n.includes("not managed by zdd")));
  const j2 = applyJson(repo, "u2", { optIns: { ci: false, prePush: true } });
  assert.equal(readFileSync(join(repo, ".githooks", "pre-push"), "utf8"), "#!/bin/sh\necho mine\n");
  assert.ok(j2.notes.some((n) => n.includes("pre-push") && n.includes("not managed by zdd")));
});

test("repair never inherits or activates an adopter's own workflow/hook (CR-048)", (t) => {
  const git = (repo, ...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  const repo = fresh("unowned-repair");
  if (git(repo, "init", "-q").status !== 0) return t.skip("git unavailable");
  mkdirSync(join(repo, ".githooks"));
  writeFileSync(join(repo, ".githooks", "pre-push"), "#!/bin/sh\necho mine\n");
  applyJson(repo, "ur1", { optIns: { ci: false, prePush: false } });
  const j = applyJson(repo, "ur2", {});
  assert.equal(j.optIns.prePush, false, "an unowned pre-push is not a ZDD opt-in");
  assert.equal(git(repo, "config", "--get", "core.hooksPath").stdout.trim(), "", "hooksPath never pointed at someone else's hook");
  const j2 = applyJson(repo, "ur3", { optIns: { prePush: true } });
  assert.equal(git(repo, "config", "--get", "core.hooksPath").stdout.trim(), "", "explicitly selected but the file is not ours: still not activated");
  assert.ok(j2.notes.some((n) => n.includes("not managed by zdd")));
});

test("pre-push: an existing hook manager's core.hooksPath is left alone; a free one is set; an already-owned one is set on repair too", (t) => {
  const git = (repo, ...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  const repo = fresh("hookspath");
  if (git(repo, "init", "-q").status !== 0) return t.skip("git unavailable");
  git(repo, "config", "core.hooksPath", ".husky");
  const j1 = applyJson(repo, "hp1", { optIns: { ci: false, prePush: true } });
  assert.equal(git(repo, "config", "--get", "core.hooksPath").stdout.trim(), ".husky", "not displaced");
  assert.ok(j1.notes.some((n) => n.includes(".husky")));
  git(repo, "config", "--unset", "core.hooksPath");
  const j2 = applyJson(repo, "hp2", {}); // repair: pre-push already present → still configured
  assert.equal(git(repo, "config", "--get", "core.hooksPath").stdout.trim(), ".githooks");
  assert.ok(j2.notes.some((n) => n.includes("core.hooksPath .githooks")));
});

test("Codex user: AGENTS.md carries the same block as CLAUDE.md, leading with the verbs; CRLF files keep CRLF", () => {
  const repo = fresh("codex");
  writeFileSync(join(repo, "CLAUDE.md"), "# My repo\r\n\r\nSome rules.\r\n");
  bootstrap(repo, ["apply", `--answers=${answersFile("codex", { codex: true })}`]);
  const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
  assert.ok(claude.startsWith("# My repo\r\n\r\nSome rules.\r\n"), "existing CLAUDE.md content kept, block appended");
  assert.ok(!/[^\r]\n/.test(claude), "no bare LF introduced into a CRLF file");
  const block = (s) => s.replace(/\r\n/g, "\n").slice(s.replace(/\r\n/g, "\n").indexOf("<!-- zdd:begin -->"));
  assert.equal(block(claude), block(agents));
  const verbs = agents.indexOf('"load ZDD"');
  assert.ok(verbs !== -1 && verbs < agents.indexOf("Never hand-edit"), "verbs lead the block");
});

test("Pocock recommendation: names the plugin, the install route, and the consequence; present → installed with its location", () => {
  const repo = fresh("pocock");
  const out = bootstrap(repo, ["detect"]);
  assert.match(out, /mattpocock-skills: NOT installed/);
  assert.match(out, /plugin marketplace add mattpocock\/skills/);
  assert.match(out, /only be as good as the design sessions/);
  const home = join(scratch, "home-with-pocock");
  const skill = join(home, ".claude", "plugins", "cache", "skills", "mattpocock-skills", "1.0.0", "skills", "domain-modeling");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: domain-modeling\n---\n");
  const out2 = execFileSync(process.execPath, [SCRIPT, "detect", `--root=${repo}`, `--home=${home}`], { encoding: "utf8" });
  assert.match(out2, /mattpocock-skills: installed \(pluginCache:/);
  const codexHome = join(scratch, "home-codex");
  mkdirSync(join(codexHome, ".codex", "skills", "domain-modeling"), { recursive: true });
  writeFileSync(join(codexHome, ".codex", "skills", "domain-modeling", "SKILL.md"), "");
  assert.match(execFileSync(process.execPath, [SCRIPT, "detect", `--root=${repo}`, `--home=${codexHome}`], { encoding: "utf8" }), /installed \(codexSkill:/);
});

// --- upgrade ---------------------------------------------------------------------------

const legacySnippet = "## Documentation — Zero-Drift Docs (ZDD)\n\nThis repo uses ZDD.\n\n- **Before building:** run `/zdd:orient`.\n- **Before finishing:** run `/zdd:update`.\n\n";

test("upgrade a v0.3.1 repo: adapter → extractors, every owned file rewritten and named, curated + generated artifacts untouched", () => {
  const repo = fresh("upgrade", join(ENGINE_FIXTURES, "fixture"));
  engine(repo, ["derive"]); // populate metadata + generated artifacts so "untouched" means something
  engine(repo, ["render"]);
  const configBefore = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.equal(configBefore.adapter, "nextjs-supabase");
  configBefore.viewer = { nonAreaTags: ["react-flow"], defaultFocus: "map/features/things" };
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(configBefore, null, 2) + "\n");
  writeFileSync(join(repo, "CLAUDE.md"), "# Fixture\n\n" + legacySnippet + "## Other section\n\nkeep me\n");
  mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
  writeFileSync(join(repo, ".github", "workflows", "zdd.yml"), `# ${OWNER}\nenv:\n  ZDD_ENGINE: "@rich-rees/zdd-engine@0.3.1"\n`);
  mkdirSync(join(repo, ".githooks"), { recursive: true });
  writeFileSync(join(repo, ".githooks", "pre-push"), readFileSync(join(PLUGIN, "templates", "pre-push"), "utf8").replace(/@rich-rees\/zdd-engine@[0-9.]+/, "@rich-rees/zdd-engine@0.3.1"));
  const CANARY = ["glossary.md", "adr", "map", "metadata", "graph.json", "agent-index.md", "adr-index.md", "human-index.html"];
  const untouched = CANARY.map((p) => hashTree(join(repo, "zdd", p)));
  assert.ok(!untouched.includes("absent"), "every canary exists before upgrade");

  const out = bootstrap(repo, ["upgrade"]);
  const json = JSON.parse(bootstrap(repo, ["upgrade", "--json"])); // second run: nothing to do

  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(config.extractors, ["supabase", "nextjs"]);
  assert.equal(config.adapter, undefined);
  assert.equal(config.adapterOptions, undefined);
  assert.deepEqual(config.extractorOptions.supabase.migrationNamespaces, [{ name: "db", dir: "migrations" }]);
  assert.deepEqual(config.extractorOptions.supabase.externalBuckets, [{ name: "cdn-assets", namespace: "db" }]);
  assert.equal(config.extractorOptions.nextjs.appDir, "src/app");
  assert.equal(config.extractorOptions.nextjs.migrationNamespaces, undefined);
  assert.deepEqual(config.nonAreaTags, ["react-flow"]);
  assert.deepEqual(config.viewer, { defaultFocus: "map/features/things" });
  assert.equal(config.engine, PLUGIN_VERSION);

  for (const f of ["zdd/config.json", ".github/workflows/zdd.yml", ".githooks/pre-push", "CLAUDE.md"]) assert.match(out, new RegExp(`changed ${f.replace(/[./]/g, "\\$&")}`), out);
  assert.match(out, /adapter "nextjs-supabase" → extractors/);
  assert.ok(readFileSync(join(repo, ".github", "workflows", "zdd.yml"), "utf8").includes(`@rich-rees/zdd-engine@${PLUGIN_VERSION}`));
  assert.ok(readFileSync(join(repo, ".githooks", "pre-push"), "utf8").includes(`@rich-rees/zdd-engine@${PLUGIN_VERSION}`));
  const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  assert.ok(claude.includes("<!-- zdd:begin -->") && !claude.includes("/zdd:orient") && claude.includes("## Other section\n\nkeep me"), claude);

  assert.deepEqual(CANARY.map((p) => hashTree(join(repo, "zdd", p))), untouched, "curated + generated untouched");
  assert.deepEqual(json.wrote, [], "second upgrade is a no-op");

  assert.match(engine(repo, ["derive"]), /Wrote \d+ records/);
  assert.ok(!engine(repo, ["derive"]).includes("deprecated"), "no deprecation note after migration");
  assert.match(engine(repo, ["derive", "--check"]), /in sync/, "migrated config derives the same bytes");
});

test("upgrade leaves alone what it does not own: a customised legacy section, an unmarked pre-push, malformed markers", () => {
  const repo = fresh("upgrade-unowned");
  mkdirSync(join(repo, "zdd"));
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], engine: PLUGIN_VERSION }));
  const custom = "# Repo\n\n## Documentation — Zero-Drift Docs (ZDD)\n\nOur own house rules about docs, nothing to do with the stock snippet.\n\n## Next\n\nx\n";
  writeFileSync(join(repo, "CLAUDE.md"), custom);
  mkdirSync(join(repo, ".githooks"));
  const hook = "#!/bin/sh\nnpx -y @rich-rees/zdd-engine@0.3.1 lint\n";
  writeFileSync(join(repo, ".githooks", "pre-push"), hook);
  const j = JSON.parse(bootstrap(repo, ["upgrade", "--json"]));
  const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  assert.ok(claude.startsWith(custom.trimEnd()), "customised section kept verbatim");
  assert.ok(claude.includes("<!-- zdd:begin -->"), "fresh block appended instead");
  assert.equal(readFileSync(join(repo, ".githooks", "pre-push"), "utf8"), hook, "unmarked hook untouched");
  assert.ok(j.kept.some((k) => k.startsWith(".githooks/pre-push") && k.includes("not managed")));

  for (const bad of ["<!-- zdd:begin -->\nx\n<!-- zdd:begin -->\ny\n<!-- zdd:end -->\n", "<!-- zdd:begin --> extra\nx\n<!-- zdd:end -->\n", "<!-- zdd:end -->\nx\n<!-- zdd:begin -->\n", "<!-- zdd:begin -->\nx\n<!-- zdd:end -->\nsee <!-- zdd:begin --> above\n", "<!-- zdd:begin --> \nx\n<!-- zdd:end -->\n"]) {
    writeFileSync(join(repo, "AGENTS.md"), bad);
    const j2 = JSON.parse(bootstrap(repo, ["upgrade", "--json"]));
    assert.equal(readFileSync(join(repo, "AGENTS.md"), "utf8"), bad, JSON.stringify(bad));
    assert.ok(j2.notes.some((n) => n.includes("AGENTS.md") && n.includes("refused")), JSON.stringify(bad));
  }
});

test("upgrade refuses a repo that never adopted, a config it cannot read, and a mixed adapter+extractors config", () => {
  const repo = fresh("never");
  assert.match(bootstrapFails(repo, ["upgrade"]), /nothing to upgrade/);
  mkdirSync(join(repo, "zdd"));
  writeFileSync(join(repo, "zdd", "config.json"), "{");
  assert.match(bootstrapFails(repo, ["upgrade"]), /does not parse/);
  const mixed = JSON.stringify({ adapter: "nextjs-supabase", extractors: ["supabase"] });
  writeFileSync(join(repo, "zdd", "config.json"), mixed);
  assert.match(bootstrapFails(repo, ["upgrade"]), /both 'adapter' and 'extractors'/);
  assert.equal(readFileSync(join(repo, "zdd", "config.json"), "utf8"), mixed, "untouched");
});
