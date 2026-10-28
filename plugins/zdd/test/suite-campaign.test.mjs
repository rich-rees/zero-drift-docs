// The slice 5 campaign's findings at the plugin seam (CR-120, CR-123,
// CR-133, CR-134, CR-140, CR-141, CR-147): one test per finding, each shown
// red without its fix. Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addSuiteStep, SUITE_CHECK_COUNT, ciCommands, narrateApply } from "../scripts/bootstrap.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = resolve(PLUGIN, "..", "..", "packages", "zdd-engine");
const ENGINE_BIN = join(ENGINE, "bin", "zdd-engine.mjs");
const BOOTSTRAP = join(PLUGIN, "scripts", "bootstrap.mjs");
const SCAFFOLD = join(PLUGIN, "scripts", "scaffold-extractor.mjs");

const tmp = (t, prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const run = (repo, args) => spawnSync(process.execPath, [BOOTSTRAP, ...args, `--root=${repo}`], { encoding: "utf8" });
const config = (repo) => JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
const writeConfig = (repo, c) => writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(c, null, 2) + "\n");
function adopted(t) {
  const repo = tmp(t, "zdd-suite-cr-plugin-");
  cpSync(join(ENGINE, "test", "fixture-fastapi"), repo, { recursive: true });
  rmSync(join(repo, "zdd"), { recursive: true });
  const answers = join(tmp(t, "zdd-ans-"), "a.json");
  writeFileSync(answers, JSON.stringify({ name: "Suite" }));
  assert.equal(run(repo, ["apply", `--answers=${answers}`]).status, 0);
  return repo;
}

test("CR-120: with no freshness step, the suite step goes after the whole lint step — its env, timeout and a multi-line run stay its own", () => {
  const wf = [
    "jobs:",
    "  zero-drift:",
    "    steps:",
    "      - name: Store lints",
    '        run: npx -y "$ZDD_ENGINE" lint --merge',
    "        env:",
    '          REQUIRED_FOR_LINT: "1"',
    "        timeout-minutes: 5",
    "",
    "      - name: Something of the team's",
    "        run: |",
    "          echo one",
    "          echo two",
    "",
  ].join("\n");
  const out = addSuiteStep(wf);
  assert.equal(out.how, "added");
  assert.match(out.text, /timeout-minutes: 5\n\n {6}# The adapters this repo wrote itself[\s\S]*? {6}- name: Your own adapters pass the standard suite\n {8}run: npx -y "\$ZDD_ENGINE" suite\n\n {6}- name: Something of the team's/);
  // The last step of the file: the suite step goes at the end.
  const last = addSuiteStep(wf.split("\n\n      - name: Something")[0] + "\n");
  assert.match(last.text, /timeout-minutes: 5\n\n {6}# The adapters[\s\S]*suite\n$/);
});

test("CR-134: the managed pre-push hook, the CI stand-in, runs the suite too", () => {
  const hook = readFileSync(join(PLUGIN, "templates", "pre-push"), "utf8");
  assert.match(hook, /npx -y "\$ZDD_ENGINE" lint &&\n {2}npx -y "\$ZDD_ENGINE" suite\s*$/);
});

test("CR-133: the schema's suiteChecks stops at the suite's count, as the engine does", () => {
  const schema = JSON.parse(readFileSync(join(PLUGIN, "templates", "config.schema.json"), "utf8"));
  assert.equal(schema.properties.suiteChecks.maximum, SUITE_CHECK_COUNT);
  assert.equal(schema.properties.suiteChecks.minimum, 0);
});

test("CR-140: off GitHub, bootstrap names the four commands it prints and what the suite gate is for", () => {
  const text = narrateApply({ mode: "existing", version: "2.5.0", config: { extractors: [] }, optIns: { ci: false, prePush: true }, host: { kind: "gitlab", remote: "x" }, ciCommands: ciCommands("2.5.0"), wrote: [], kept: [], skipped: [], notes: [], pocock: { installed: false, hits: [] } });
  assert.match(text, /The merge gate for your own pipeline is four commands, run on every pull request:/);
  for (const c of ciCommands("2.5.0")) assert.ok(text.includes(`  ${c}`), c);
  assert.match(text, /the fourth runs the standard suite on this repo's own adapters/);
});

test("CR-123 (plugin): adapters --raise refuses while a configured adapter of the repo's own cannot be found", (t) => {
  const repo = adopted(t);
  const c = config(repo);
  c.extractors.push("acme-gone");
  c.localExtractorDir = "zdd/extractors";
  delete c.suiteChecks;
  writeConfig(repo, c);
  mkdirSync(join(repo, "zdd", "extractors"), { recursive: true });
  const r = run(repo, ["adapters", "--raise"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /acme-gone/);
  assert.equal(config(repo).suiteChecks, undefined);
  assert.match(run(repo, ["adapters"]).stdout, /acme-gone: not found/);
});

test("CR-141: the scaffold's module declares CONTRACT 1, the comment mark of its syntax for each extension, and its fixture options", async (t) => {
  for (const [syntax, extensions, mark] of [["c-like", [".cs", ".java"], "//"], ["python", [".py"], "#"], ["sql", [".sql"], "--"], ["mysql", [".sql"], "#"]]) {
    const repo = tmp(t, "zdd-scaffold-cr141-");
    cpSync(join(ENGINE, "test", "fixture-greenfield"), repo, { recursive: true });
    const answers = join(tmp(t, "zdd-ans-"), "a.json");
    const name = `acme-${syntax}`;
    writeFileSync(answers, JSON.stringify({ name, evidence: "x", shapedLike: "fastapi", kinds: ["route"], idExample: "route:/x", refs: [], roots: ["src"], extensions, syntax }));
    const r = spawnSync(process.execPath, [SCAFFOLD, "apply", `--answers=${answers}`, `--root=${repo}`], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const mod = await import(pathToFileURL(join(repo, "zdd", "extractors", name, "index.mjs")).href);
    assert.equal(mod.CONTRACT, 1, syntax);
    assert.deepEqual(mod.COMMENT, Object.fromEntries(extensions.map((e) => [e, mark])), syntax);
    assert.deepEqual(mod.SUITE, { options: { roots: ["src"], extensions } }, syntax);
  }
});

test("CR-147: upgrade with no adapter of the repo's own writes a suiteChecks the engine reads back; a single-file module of the repo's own counts as one", (t) => {
  const repo = adopted(t);
  const c = config(repo);
  delete c.suiteChecks;
  writeConfig(repo, c);
  assert.equal(run(repo, ["upgrade"]).status, 0);
  const s = spawnSync(process.execPath, [ENGINE_BIN, "suite", "--json", `--root=${repo}`], { encoding: "utf8" });
  assert.equal(JSON.parse(s.stdout).suiteChecks, SUITE_CHECK_COUNT);

  const flat = adopted(t);
  const f = config(flat);
  delete f.suiteChecks;
  f.extractors.push("acme-flat");
  f.localExtractorDir = "zdd/extractors";
  writeConfig(flat, f);
  mkdirSync(join(flat, "zdd", "extractors"), { recursive: true });
  writeFileSync(join(flat, "zdd", "extractors", "acme-flat.mjs"), "export const CONTRACT = 1;\nexport function derive() { return { records: [], diagnostics: [] }; }\n");
  const up = run(flat, ["upgrade"]);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(config(flat).suiteChecks, undefined);
  assert.match(up.stdout, /this repo's own adapters \(acme-flat\)/);
});

test("CR-135 (scaffold): the scaffolded test treats only fixture/, fixture-deep/ and fixture-trap/ as test data", () => {
  const tmpl = readFileSync(join(PLUGIN, "templates", "extractor", "extractor.test.mjs.tmpl"), "utf8");
  assert.equal(tmpl.split("fixture(?:-deep|-trap)?").length - 1, 2);
  assert.ok(!tmpl.includes("fixture(?:-[^"), "no folder named fixture-<anything> is skipped");
});
