// Seam 2 — the bootstrap runbook observed as files on disk. The skill is the
// conversation; scripts/bootstrap.mjs is what reads the stack and writes the
// repo, so it is driven here with scripted answer sets against fixture repos
// (throwaway copies of the engine's fixtures) and the results asserted on
// disk. No LLM in the loop, same bytes in ⇒ same files out.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const ENGINE_BIN = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "bin", "zdd-engine.mjs");
const ENGINE_FIXTURES = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "test");
const PLUGIN_VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

let scratch;
let fakeHome; // no mattpocock-skills here
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-bootstrap-"));
  fakeHome = join(scratch, "home");
  mkdirSync(fakeHome, { recursive: true });
});
after(() => rmSync(scratch, { recursive: true, force: true }));

const bootstrap = (root, args, opts = {}) =>
  execFileSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${fakeHome}`], { encoding: "utf8", ...opts });
const engine = (root, args) => execFileSync(process.execPath, [ENGINE_BIN, ...args, `--root=${root}`], { encoding: "utf8" });

function answersFile(name, answers) {
  const p = join(scratch, `${name}.json`);
  writeFileSync(p, JSON.stringify(answers));
  return p;
}
function fresh(name, from) {
  const dir = join(scratch, name);
  if (from) cpSync(from, dir, { recursive: true });
  else mkdirSync(dir, { recursive: true });
  return dir;
}
function hashTree(dir) {
  const h = createHash("sha256");
  const rec = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) rec(p);
      else h.update(n).update(readFileSync(p));
    }
  };
  if (existsSync(dir) && statSync(dir).isDirectory()) rec(dir);
  else if (existsSync(dir)) h.update(readFileSync(dir));
  return h.digest("hex");
}

// --- existing codebase: FastAPI + Supabase fixture, no zdd/ --------------------

test("detect: names the evidence for each proposed extractor", () => {
  const repo = fresh("detect", join(ENGINE_FIXTURES, "fixture-fastapi"));
  rmSync(join(repo, "zdd"), { recursive: true });
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

test("apply on the FastAPI+Supabase fixture with all defaults: config, workflow, hook registrations, snippet, dated ADR-0001", () => {
  const repo = fresh("existing", join(ENGINE_FIXTURES, "fixture-fastapi"));
  rmSync(join(repo, "zdd"), { recursive: true });
  const answers = answersFile("existing", { name: "Fixture FastAPI", confirmed: true });
  const out = bootstrap(repo, ["apply", `--answers=${answers}`]);

  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(config.extractors, ["supabase", "fastapi"]);
  assert.deepEqual(config.extractorOptions.supabase.migrationNamespaces, [{ name: "db", dir: "supabase/migrations" }]);
  assert.deepEqual(config.extractorOptions.fastapi.roots, ["api", "main.py"]);
  assert.equal(config.engine, PLUGIN_VERSION);
  assert.deepEqual(config.hooks, { autoLoad: true, fence: true }, "auto-load + fence registrations recorded");

  assert.ok(existsSync(join(repo, ".github", "workflows", "zdd.yml")), "CI workflow written");
  assert.ok(readFileSync(join(repo, ".github", "workflows", "zdd.yml"), "utf8").includes(`@rich-rees/zdd-engine@${PLUGIN_VERSION}`));
  assert.ok(!existsSync(join(repo, ".githooks", "pre-push")), "pre-push not written when CI accepted");

  const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  assert.ok(claude.includes("<!-- zdd:begin"), "snippet block present");
  assert.ok(claude.includes('"load ZDD"') && claude.includes('"update ZDD"'), "leads with the spoken verbs");
  assert.ok(!existsSync(join(repo, "AGENTS.md")), "AGENTS.md only for Codex users");

  const adr = readFileSync(join(repo, "zdd", "adr", "0001-adopt-zero-drift-docs.md"), "utf8");
  assert.ok(adr.includes(`(${today()})`), "ADR-0001 carries today's date");
  assert.ok(!adr.includes("<DATE>"));
  assert.ok(existsSync(join(repo, "zdd", "glossary.md")));
  assert.match(out, /branch protection/i, "branch protection is the printed step");
  assert.match(out, /mattpocock-skills: NOT installed/);
  assert.match(out, /plugin install/);

  // The written config actually drives the engine against the detected tree.
  assert.match(engine(repo, ["derive"]), /Wrote \d+ records/);
  assert.match(engine(repo, ["derive", "--check"]), /in sync/);
});

test("apply is idempotent: a second run keeps everything and overwrites nothing curated", () => {
  const repo = join(scratch, "existing");
  writeFileSync(join(repo, "zdd", "glossary.md"), "# Glossary\n\n**Job**: a listing.\n");
  const before = hashTree(join(repo, "zdd"));
  const claudeBefore = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  const json = JSON.parse(bootstrap(repo, ["apply", `--answers=${answersFile("again", {})}`, "--json"]));
  assert.equal(json.mode, "repair");
  assert.deepEqual(json.wrote, [], `second run wrote: ${json.wrote}`);
  assert.ok(json.kept.includes("zdd/config.json"));
  assert.ok(json.kept.includes("zdd/glossary.md"));
  assert.equal(hashTree(join(repo, "zdd")), before);
  assert.equal(readFileSync(join(repo, "CLAUDE.md"), "utf8"), claudeBefore);
});

// --- greenfield ---------------------------------------------------------------

test("apply on an empty repo with the greenfield stack: extractors at the future paths, map skeleton names the apps, engine checks pass on empty metadata", () => {
  const repo = fresh("greenfield");
  const answers = answersFile("greenfield", { name: "Foodbank", stack: ["FastAPI", "Supabase", "React web", "Expo"] });
  const text = bootstrap(repo, ["detect"]);
  assert.match(text, /Mode: GREENFIELD/);
  bootstrap(repo, ["apply", `--answers=${answers}`]);

  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(config.extractors, ["fastapi", "supabase"]);
  assert.deepEqual(config.extractorOptions.fastapi, { roots: ["api"] });
  assert.deepEqual(config.extractorOptions.supabase, { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] });
  assert.equal(config.render.storeChanges, false, "no .git → render without git");

  const apps = readdirSync(join(repo, "zdd", "map", "apps")).sort();
  assert.deepEqual(apps, [".gitkeep", "mobile.md", "web.md"]);
  assert.ok(readFileSync(join(repo, "zdd", "map", "apps", "web.md"), "utf8").includes("title: Web (React)"));
  assert.ok(readFileSync(join(repo, "zdd", "map", "apps", "mobile.md"), "utf8").includes("title: Mobile (Expo)"));

  engine(repo, ["derive"]);
  assert.match(engine(repo, ["derive", "--check"]), /in sync/);
  engine(repo, ["render"]);
  assert.match(engine(repo, ["render", "--check"]), /in sync/);
  assert.ok(existsSync(join(repo, "zdd", "agent-index.md")));
});

test("stack entries may carry their future path", () => {
  const repo = fresh("greenfield-paths");
  bootstrap(repo, ["apply", `--answers=${answersFile("gp", { stack: [{ name: "FastAPI", path: "backend/app" }, { name: "Supabase", path: "db/migrations" }] })}`]);
  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(config.extractorOptions.fastapi.roots, ["backend/app"]);
  assert.equal(config.extractorOptions.supabase.migrationNamespaces[0].dir, "db/migrations");
});

// --- opt-ins --------------------------------------------------------------------

test("CI declined: no workflow, pre-push offered and written, closing text says the guarantee is weaker", () => {
  const repo = fresh("no-ci", join(ENGINE_FIXTURES, "fixture-fastapi"));
  rmSync(join(repo, "zdd"), { recursive: true });
  const out = bootstrap(repo, ["apply", `--answers=${answersFile("no-ci", { optIns: { ci: false, prePush: true } })}`]);
  assert.ok(!existsSync(join(repo, ".github", "workflows", "zdd.yml")));
  const hook = readFileSync(join(repo, ".githooks", "pre-push"), "utf8");
  assert.ok(hook.startsWith("#!/bin/sh"));
  assert.ok(hook.includes(`@rich-rees/zdd-engine@${PLUGIN_VERSION}`));
  assert.match(out, /weaker without CI/);
  assert.match(out, /core\.hooksPath/, "no .git in the fixture → the git config step is printed");
});

test("CI declined and pre-push declined: neither written, still narrated", () => {
  const repo = fresh("no-ci-no-hook");
  const json = JSON.parse(bootstrap(repo, ["apply", `--answers=${answersFile("nn", { optIns: { ci: false, prePush: false, fence: false } })}`, "--json"]));
  assert.ok(!existsSync(join(repo, ".githooks", "pre-push")));
  assert.ok(json.skipped.some((s) => s.startsWith(".githooks/pre-push")));
  assert.deepEqual(json.config.hooks, { autoLoad: true, fence: false });
});

test("Codex user: AGENTS.md carries the same block as CLAUDE.md, leading with the verbs", () => {
  const repo = fresh("codex");
  writeFileSync(join(repo, "CLAUDE.md"), "# My repo\n\nSome rules.\n");
  bootstrap(repo, ["apply", `--answers=${answersFile("codex", { codex: true })}`]);
  const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
  assert.ok(claude.startsWith("# My repo\n\nSome rules.\n"), "existing CLAUDE.md content kept, block appended");
  const block = (s) => s.slice(s.indexOf("<!-- zdd:begin"), s.indexOf("<!-- zdd:end -->") + "<!-- zdd:end -->".length);
  assert.equal(block(claude), block(agents));
  const verbs = agents.indexOf('"load ZDD"');
  assert.ok(verbs !== -1 && verbs < agents.indexOf("Never hand-edit"), "verbs lead the block");
});

test("Pocock recommendation: names the plugin, the install route, and the consequence; present → installed", () => {
  const repo = fresh("pocock");
  const out = bootstrap(repo, ["detect"]);
  assert.match(out, /mattpocock-skills: NOT installed/);
  assert.match(out, /plugin marketplace add mattpocock\/skills/);
  assert.match(out, /only be as good as the design sessions/);
  // Stage the plugin-cache install shape grill/SKILL.md documents.
  const home = join(scratch, "home-with-pocock");
  const skill = join(home, ".claude", "plugins", "cache", "skills", "mattpocock-skills", "1.0.0", "skills", "domain-modeling");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: domain-modeling\n---\n");
  const out2 = execFileSync(process.execPath, [SCRIPT, "detect", `--root=${repo}`, `--home=${home}`], { encoding: "utf8" });
  assert.match(out2, /mattpocock-skills: installed/);
});

// --- upgrade --------------------------------------------------------------------

test("upgrade a v0.3.1 repo: adapter → extractors, every changed file named, curated artifacts untouched", () => {
  const repo = fresh("upgrade", join(ENGINE_FIXTURES, "fixture"));
  // v0.3.1 shape: legacy adapter config (the fixture's own), old unmarked
  // snippet, an old workflow pin, a managed pre-push at an old pin.
  const configBefore = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.equal(configBefore.adapter, "nextjs-supabase");
  configBefore.viewer = { nonAreaTags: ["react-flow"], defaultFocus: "map/features/things" };
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(configBefore, null, 2) + "\n");
  writeFileSync(join(repo, "CLAUDE.md"), "# Fixture\n\n## Documentation — Zero-Drift Docs (ZDD)\n\nold snippet text\n\n- old bullet\n\n## Other section\n\nkeep me\n");
  mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
  writeFileSync(join(repo, ".github", "workflows", "zdd.yml"), 'env:\n  ZDD_ENGINE: "@rich-rees/zdd-engine@0.3.1"\n');
  mkdirSync(join(repo, ".githooks"), { recursive: true });
  writeFileSync(join(repo, ".githooks", "pre-push"), readFileSync(join(PLUGIN, "templates", "pre-push"), "utf8").replace(/@rich-rees\/zdd-engine@[0-9.]+/, "@rich-rees/zdd-engine@0.3.1"));
  const curated = ["glossary.md", "adr", "map"].map((p) => hashTree(join(repo, "zdd", p)));

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

  for (const f of ["zdd/config.json", ".github/workflows/zdd.yml", ".githooks/pre-push", "CLAUDE.md"]) assert.match(out, new RegExp(`changed ${f.replace(/[.\/]/g, "\\$&")}`), out);
  assert.match(out, /adapter .* → extractors/);
  assert.ok(readFileSync(join(repo, ".github", "workflows", "zdd.yml"), "utf8").includes(`@rich-rees/zdd-engine@${PLUGIN_VERSION}`));
  assert.ok(readFileSync(join(repo, ".githooks", "pre-push"), "utf8").includes(`@rich-rees/zdd-engine@${PLUGIN_VERSION}`));
  const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  assert.ok(claude.includes("<!-- zdd:begin") && !claude.includes("old snippet text") && claude.includes("## Other section\n\nkeep me"), claude);

  assert.deepEqual(["glossary.md", "adr", "map"].map((p) => hashTree(join(repo, "zdd", p))), curated, "curated artifacts untouched");
  assert.deepEqual(json.wrote, [], "second upgrade is a no-op");

  // The migrated config is what the engine now runs — byte-identical to the legacy expansion (the engine's golden pins that).
  assert.match(engine(repo, ["derive"]), /Wrote \d+ records/);
  assert.ok(!engine(repo, ["derive"]).includes("deprecated"), "no deprecation note after migration");
});

test("upgrade refuses a repo that never adopted", () => {
  const repo = fresh("never");
  assert.throws(() => bootstrap(repo, ["upgrade"], { stdio: "pipe" }), /nothing to upgrade/);
});
