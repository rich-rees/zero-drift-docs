// Bootstrap after the adapters are attached (decision 0039): the first map
// check is owed (`mapCheck` in the config) until it is done together; on a
// greenfield repo it waits for the first derive that finds records, and
// `check --status` says when it is due. `check` reads the engine's coverage
// report; `check --done` clears it. `preview` renders the chosen adapters'
// examples outside the repo. Bootstrap runs the engine of its own release:
// ZDD_ENGINE_BIN when set, else the engine beside it at the same version,
// else the pinned package under npx. Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = resolve(PLUGIN, "..", "..", "packages", "zdd-engine");
const ENGINE_BIN = join(ENGINE, "bin", "zdd-engine.mjs");
const BOOTSTRAP = join(PLUGIN, "scripts", "bootstrap.mjs");

const tmp = (t, prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const run = (repo, args, env = process.env) => execFileSync(process.execPath, [BOOTSTRAP, ...args, `--root=${repo}`], { encoding: "utf8", env });
const engine = (repo, args) => execFileSync(process.execPath, [ENGINE_BIN, ...args, `--root=${repo}`], { encoding: "utf8" });
const applyDefaults = (t, repo) => {
  const answers = join(tmp(t, "zdd-ans-"), "a.json");
  writeFileSync(answers, JSON.stringify({ name: "Check" }));
  run(repo, ["apply", `--answers=${answers}`]);
};

test("the first map check: owed after apply, silent until derive finds records, then due; check names the unlinked; --done clears it", (t) => {
  const repo = tmp(t, "zdd-check-");
  cpSync(join(ENGINE, "test", "fixture-fastapi"), repo, { recursive: true });
  rmSync(join(repo, "zdd"), { recursive: true });
  applyDefaults(t, repo);
  assert.equal(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).mapCheck, "owed");
  assert.equal(run(repo, ["check", "--status"]), "", "no records yet: nothing to say");
  engine(repo, ["derive"]);
  assert.match(run(repo, ["check", "--status"]), /^The first map check is owed: derive now finds records/);
  const report = run(repo, ["check"]);
  assert.match(report, /- 2 routes; 2 link to a table/, report);
  assert.match(report, /does this all look right, and is any link missing\?/);
  const json = JSON.parse(run(repo, ["check", "--json"]));
  assert.deepEqual(json.coverage.find((k) => k.kind === "table").reachedByNothing.count, 0);
  assert.match(run(repo, ["check", "--done"]), /mapCheck cleared/);
  assert.equal(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).mapCheck, undefined);
  assert.equal(run(repo, ["check", "--status"]), "", "done: never asked again");
});

test("greenfield: the check stays owed and silent while there is no code", (t) => {
  const repo = tmp(t, "zdd-check-green-");
  applyDefaults(t, repo);
  assert.equal(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).mapCheck, "owed");
  assert.deepEqual(JSON.parse(run(repo, ["check", "--status", "--json"])), { owed: true, records: false, due: false });
});

test("preview: the examples render outside the repo, and nothing is written into it", (t) => {
  const repo = tmp(t, "zdd-preview-repo-");
  const r = JSON.parse(run(repo, ["preview", "--extractors=fastapi,supabase", "--json"]));
  t.after(() => rmSync(r.out, { recursive: true, force: true }));
  assert.deepEqual(r.used, ["fastapi", "supabase"]);
  assert.ok(existsSync(r.humanIndex));
  assert.ok(!resolve(r.out).startsWith(resolve(repo)));
  assert.deepEqual(readdirSync(repo), []);
  const bad = spawnSync(process.execPath, [BOOTSTRAP, "preview", "--extractors=../x", `--root=${repo}`], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /is not an adapter name/);
});

test("the engine bootstrap runs: ZDD_ENGINE_BIN when set, else the sibling engine of the same version", async (t) => {
  const { engineCommand } = await import(pathToFileURL(BOOTSTRAP).href);
  const before = process.env.ZDD_ENGINE_BIN;
  t.after(() => (before === undefined ? delete process.env.ZDD_ENGINE_BIN : (process.env.ZDD_ENGINE_BIN = before)));
  delete process.env.ZDD_ENGINE_BIN;
  assert.deepEqual(engineCommand(), { cmd: process.execPath, pre: [ENGINE_BIN], shell: false }, "this checkout ships the engine at the plugin's version");
  process.env.ZDD_ENGINE_BIN = "/elsewhere/bin/zdd-engine.mjs";
  assert.deepEqual(engineCommand().pre, ["/elsewhere/bin/zdd-engine.mjs"]);
  // A bin that is not there: detection fails loudly, naming the engine, and writes nothing.
  const repo = tmp(t, "zdd-noengine-");
  const r = spawnSync(process.execPath, [BOOTSTRAP, "detect", `--root=${repo}`], { encoding: "utf8", env: { ...process.env, ZDD_ENGINE_BIN: join(repo, "missing.mjs") } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /detection could not run — the engine said/);
});
