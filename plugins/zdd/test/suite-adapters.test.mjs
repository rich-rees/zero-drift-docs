// The standard suite and the adapter contract at the plugin seam (decision
// 0040). Whatever the engine's suite reads, bootstrap writes: a fresh
// install writes `suiteChecks`, the upgrade raises it where the repo has no
// adapter of its own and adds the CI step, and `adapters --raise` raises it
// once the repo's own adapters pass — each bound here to the engine reading
// it back. `adapters` is the interview's material: the questions for the
// contract steps an adapter is behind on (their text travels in the core
// release) and what to fix for each failing check.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addSuiteStep, SUITE_CHECK_COUNT, narrateAdapters } from "../scripts/bootstrap.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = resolve(PLUGIN, "..", "..", "packages", "zdd-engine");
const ENGINE_BIN = join(ENGINE, "bin", "zdd-engine.mjs");
const BOOTSTRAP = join(PLUGIN, "scripts", "bootstrap.mjs");
const TEMPLATE = readFileSync(join(PLUGIN, "templates", "zdd.yml"), "utf8");

const tmp = (t, prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const run = (repo, args, env = process.env) => spawnSync(process.execPath, [BOOTSTRAP, ...args, `--root=${repo}`], { encoding: "utf8", env });
const engineSuite = (repo) => {
  const r = spawnSync(process.execPath, [ENGINE_BIN, "suite", "--json", `--root=${repo}`], { encoding: "utf8" });
  return { status: r.status, json: JSON.parse(r.stdout) };
};
const config = (repo) => JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
const writeConfig = (repo, c) => writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(c, null, 2) + "\n");

// A repo's own adapter, shaped like the engine suite tests' good one.
const ADAPTER = `export const CONTRACT = 1;
export const COMMENT = { ".txt": "#" };
export const SUITE = { options: { roots: ["routes"] } };
export function derive({ options, io }) {
  const records = [];
  const diagnostics = [];
  for (const root of options.roots ?? ["routes"]) {
    const walked = io.walk(root, (rel) => {
      const got = io.read(rel);
      if (!got.ok) return diagnostics.push(got.reason);
      for (const line of got.text.split("\\n")) {
        const m = /^GET (\\/\\S*)$/.exec(line.replace(/#.*$/, "").trim());
        if (m) records.push({ kind: "route", id: "route:" + m[1], title: m[1], description: "", resource: [rel], refs: [], facts: {}, filename: m[1].replace(/\\//g, "-") + ".json" });
      }
    });
    if (!walked.exists) diagnostics.push(root + " is missing — nothing to inventory");
  }
  return { records, diagnostics };
}
`;
function withOwnAdapter(repo, text = ADAPTER) {
  mkdirSync(join(repo, "zdd", "extractors", "acme-routes", "fixture", "routes"), { recursive: true });
  writeFileSync(join(repo, "zdd", "extractors", "acme-routes", "index.mjs"), text);
  writeFileSync(join(repo, "zdd", "extractors", "acme-routes", "fixture", "routes", "a.txt"), "GET /things\n# GET /old\n");
  const c = config(repo);
  c.extractors = [...c.extractors, "acme-routes"];
  c.extractorOptions["acme-routes"] = { roots: ["routes"] };
  c.localExtractorDir = "zdd/extractors";
  writeConfig(repo, c);
}

function adopted(t) {
  const repo = tmp(t, "zdd-suite-plugin-");
  cpSync(join(ENGINE, "test", "fixture-fastapi"), repo, { recursive: true });
  rmSync(join(repo, "zdd"), { recursive: true });
  const answers = join(tmp(t, "zdd-ans-"), "a.json");
  writeFileSync(answers, JSON.stringify({ name: "Suite" }));
  const r = run(repo, ["apply", `--answers=${answers}`]);
  assert.equal(r.status, 0, r.stderr);
  return repo;
}

test("the plugin's mirror of the suite's check count equals the engine's", async () => {
  const { SUITE_CHECK_COUNT: engineCount } = await import(pathToFileURL(join(ENGINE, "src", "core", "lib", "suite.mjs")).href);
  assert.equal(SUITE_CHECK_COUNT, engineCount);
});

test("writer to reader: a fresh install writes suiteChecks, and the engine's suite holds the repo to every check", (t) => {
  const repo = adopted(t);
  assert.equal(config(repo).suiteChecks, SUITE_CHECK_COUNT);
  const s = engineSuite(repo);
  assert.equal(s.status, 0);
  assert.equal(s.json.suiteChecks, SUITE_CHECK_COUNT);
  // The workflow bootstrap wrote runs it.
  assert.match(readFileSync(join(repo, ".github", "workflows", "zdd.yml"), "utf8"), /run: npx -y "\$ZDD_ENGINE" suite\n/);
});

test("upgrade: with no adapter of the repo's own, suiteChecks is raised at once; with one, it stays (absent: every check warns) and the note names it", (t) => {
  const repo = adopted(t);
  const c = config(repo);
  delete c.suiteChecks;
  writeConfig(repo, c);
  const up = run(repo, ["upgrade"]);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /suiteChecks \(none\) → 5: no adapter of this repo's own/);
  assert.equal(config(repo).suiteChecks, SUITE_CHECK_COUNT);

  const own = adopted(t);
  withOwnAdapter(own);
  const c2 = config(own);
  delete c2.suiteChecks;
  writeConfig(own, c2);
  const up2 = run(own, ["upgrade"]);
  assert.equal(up2.status, 0, up2.stderr);
  assert.equal(config(own).suiteChecks, undefined);
  assert.match(up2.stdout, /this repo's own adapters \(acme-routes\): run `bootstrap\.mjs adapters`/);
  assert.equal(engineSuite(own).json.suiteChecks, 0, "the engine reads absent as: nothing blocks yet");
});

test("adapters: a failing check is named with its fix and --raise refuses; once it passes, --raise writes the count the engine then enforces", (t) => {
  const repo = adopted(t);
  // Reads commented-out lines: check 4 fails.
  withOwnAdapter(repo, ADAPTER.replace('line.replace(/#.*$/, "").trim()', 'line.replace(/^#\\s*/, "").trim()'));
  const c = config(repo);
  delete c.suiteChecks;
  writeConfig(repo, c);
  const r = run(repo, ["adapters"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /acme-routes — written for contract 1/);
  assert.match(r.stdout, /Fails check 4 \(warns only\): commented-out code/);
  assert.match(r.stdout, /Fix: decide structure on text with its comments and strings masked/);
  const refused = run(repo, ["adapters", "--raise"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /suiteChecks stays at 0: acme-routes does not pass the standard suite yet/);
  assert.equal(config(repo).suiteChecks, undefined);

  writeFileSync(join(repo, "zdd", "extractors", "acme-routes", "index.mjs"), ADAPTER);
  const ok = run(repo, ["adapters", "--raise"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /suiteChecks \(none\) → 5/);
  assert.equal(config(repo).suiteChecks, SUITE_CHECK_COUNT);
  // The engine now blocks on a regression.
  writeFileSync(join(repo, "zdd", "extractors", "acme-routes", "index.mjs"), ADAPTER.replace('line.replace(/#.*$/, "").trim()', 'line.replace(/^#\\s*/, "").trim()'));
  const s = engineSuite(repo);
  assert.equal(s.status, 1);
  assert.ok(s.json.adapters[0].checks.find((x) => x.n === 4).blocking);
});

test("adapters: no CONTRACT line is a question from the core's table, and --raise waits for it", (t) => {
  const repo = adopted(t);
  withOwnAdapter(repo, ADAPTER.replace("export const CONTRACT = 1;\n", ""));
  const r = run(repo, ["adapters", "--json"]);
  const a = JSON.parse(r.stdout).adapters[0];
  assert.equal(a.declared, null);
  assert.equal(a.ask[0].step, "CONTRACT");
  assert.match(a.ask[0].ask, /Add `export const CONTRACT = 1`/);
  assert.equal(run(repo, ["adapters", "--raise"]).status, 1);
});

test("the interview: an adapter behind on a newer contract is asked the core's question for each step, required ones first-class", () => {
  // The engine's report for a contract-2 engine, as `suite --json` shapes it.
  const text = narrateAdapters({
    contract: 2,
    count: 5,
    suiteChecks: 5,
    clean: false,
    raised: false,
    adapters: [{ name: "acme-routes", declared: 1, loadError: null, contractFail: null, ask: [{ step: "queues", required: false, since: 2, ask: "ZDD can now show message queues; does your stack have any?" }], fix: [] }],
  });
  assert.match(text, /acme-routes — written for contract 1/);
  assert.match(text, /Ask \(optional, queues\): ZDD can now show message queues; does your stack have any\?/);
  assert.match(text, /Ask the questions one at a time/);
});

test("the upgrade adds the suite step to an owned workflow from an earlier release, in the template's words; present, it is left; with nothing to anchor on, it is named", () => {
  const lines = TEMPLATE.split("\n");
  const at = lines.findIndex((l) => l.trim() === "- name: Your own adapters pass the standard suite");
  let from = at;
  while (lines[from - 1].trim().startsWith("#")) from--;
  const older = [...lines.slice(0, from), ...lines.slice(at + 3)].join("\n"); // the block and the blank after it
  assert.ok(!/ suite\n/.test(older));
  const added = addSuiteStep(older);
  assert.equal(added.how, "added");
  assert.equal(added.text, TEMPLATE, "an upgraded 2.5 workflow equals a fresh one");
  assert.equal(addSuiteStep(TEMPLATE).how, "present");
  // A team that dropped the freshness step: after the lint step.
  const noFresh = older.replace(/\n {6}- name: Semantic-map freshness[\s\S]*$/, "\n");
  const placed = addSuiteStep(noFresh);
  assert.equal(placed.how, "added");
  assert.match(placed.text, /lint --merge\n\n {6}# The adapters this repo wrote itself[\s\S]* {6}- name: Your own adapters pass the standard suite\n {8}run: npx -y "\$ZDD_ENGINE" suite/);
  // CRLF kept.
  assert.ok(!/(?<!\r)\n/.test(addSuiteStep(older.replace(/\n/g, "\r\n")).text));
  // A commented-out suite line is not a step.
  assert.equal(addSuiteStep(older.replace("lint --merge\n", 'lint --merge\n      # run: npx -y "$ZDD_ENGINE" suite\n')).how, "added");
  assert.equal(addSuiteStep("jobs: {}\n").how, "absent");
});
