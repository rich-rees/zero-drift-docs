// CAS-93: ZDD pins and brings in one release of mattpocock-skills (its own
// marketplace entry; zdd declares the dependency). Two enabled copies of the
// same plugin name load silently as ONE — and in the experiment the other copy
// won. So bootstrap switches the other copies off in the repo's committed
// project settings, in advance, and enables ZDD's. Never a user or local
// settings file. Observed at the file seam like the rest of bootstrap.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const ENGINE_FIXTURES = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "test");
const PLUGIN_VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const DATE = "2026-10-06";

const PLUGIN_SETTINGS = {
  "zdd@zero-drift-docs": true,
  "mattpocock-skills@zero-drift-docs": true,
  "mattpocock-skills@mattpocock": false,
  "mattpocock-skills@claude-plugins-official": false,
};

let scratch, fakeHome;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-settings-"));
  fakeHome = join(scratch, "home");
  mkdirSync(fakeHome, { recursive: true });
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const bootstrap = (root, args) => execFileSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${fakeHome}`, `--date=${DATE}`], { encoding: "utf8" });
const answersFile = (name, answers) => {
  const p = join(scratch, `${name}.json`);
  writeFileSync(p, JSON.stringify(answers));
  return p;
};
const applyJson = (repo, name, answers) => JSON.parse(bootstrap(repo, ["apply", `--answers=${answersFile(name, answers)}`, "--json"]));
const fastapiRepo = (name) => {
  const repo = join(scratch, name);
  cpSync(join(ENGINE_FIXTURES, "fixture-fastapi"), repo, { recursive: true });
  rmSync(join(repo, "zdd"), { recursive: true });
  return repo;
};
const settingsPath = (repo) => join(repo, ".claude", "settings.json");

test("apply writes .claude/settings.json: ZDD and its pinned Pocock on, the other Pocock copies off, narrated", () => {
  const repo = fastapiRepo("fresh");
  const out = bootstrap(repo, ["apply", `--answers=${answersFile("fresh", { name: "X" })}`]);
  assert.match(out, /wrote\s+\.claude\/settings\.json/, out);
  assert.match(out, /switched off your other Pocock cop/i, out);
  assert.match(out, /still works? in your other repos/i, out);
  assert.deepEqual(JSON.parse(readFileSync(settingsPath(repo), "utf8")), { enabledPlugins: PLUGIN_SETTINGS });
  assert.ok(!existsSync(join(repo, ".claude", "settings.local.json")), "never a local settings file");
});

test("an existing .claude/settings.json keeps every other key and its order; the merge is idempotent", () => {
  const repo = fastapiRepo("merge");
  mkdirSync(join(repo, ".claude"));
  const before = { permissions: { allow: ["Bash(npm test)"] }, enabledPlugins: { "mattpocock-skills@claude-plugins-official": true, "other@market": true }, model: "opus" };
  writeFileSync(settingsPath(repo), JSON.stringify(before, null, 2) + "\n");
  const json = applyJson(repo, "merge", { name: "X" });
  assert.ok(json.wrote.includes(".claude/settings.json"), json.wrote.join("\n"));
  const after = JSON.parse(readFileSync(settingsPath(repo), "utf8"));
  assert.deepEqual(Object.keys(after), ["permissions", "enabledPlugins", "model"], "top-level order kept");
  assert.deepEqual(after.permissions, before.permissions);
  assert.equal(after.model, "opus");
  assert.equal(after.enabledPlugins["other@market"], true, "unrelated plugin kept");
  assert.equal(after.enabledPlugins["mattpocock-skills@claude-plugins-official"], false, "the other copy switched off");
  assert.equal(after.enabledPlugins["zdd@zero-drift-docs"], true);
  assert.equal(after.enabledPlugins["mattpocock-skills@zero-drift-docs"], true);
  const bytes = readFileSync(settingsPath(repo));
  const again = applyJson(repo, "merge-again", {});
  assert.deepEqual(again.wrote, [], again.wrote.join("\n"));
  assert.ok(again.kept.includes(".claude/settings.json"), again.kept.join("\n"));
  assert.deepEqual(readFileSync(settingsPath(repo)), bytes, "second run: byte-identical");
});

test("a .claude/settings.json that is not a JSON object is left untouched and named; settings.local.json is never read or written", () => {
  const repo = fastapiRepo("bad");
  mkdirSync(join(repo, ".claude"));
  writeFileSync(settingsPath(repo), "{ not json\n");
  const local = JSON.stringify({ enabledPlugins: { "mattpocock-skills@claude-plugins-official": true } }, null, 2) + "\n";
  writeFileSync(join(repo, ".claude", "settings.local.json"), local);
  const json = applyJson(repo, "bad", { name: "X" });
  assert.ok(!json.wrote.includes(".claude/settings.json"));
  assert.ok(json.notes.some((n) => /\.claude\/settings\.json: .*not valid JSON.*left untouched/i.test(n)), json.notes.join("\n"));
  assert.equal(readFileSync(settingsPath(repo), "utf8"), "{ not json\n");
  assert.equal(readFileSync(join(repo, ".claude", "settings.local.json"), "utf8"), local, "local settings untouched");
});

test("upgrade writes the same plugin settings to an existing adopter and narrates them", () => {
  const repo = join(scratch, "upgrade");
  mkdirSync(join(repo, "zdd"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], engine: PLUGIN_VERSION }));
  const out = bootstrap(repo, ["upgrade"]);
  assert.match(out, /changed \.claude\/settings\.json/, out);
  assert.match(out, /switched off your other Pocock cop/i, out);
  assert.deepEqual(JSON.parse(readFileSync(settingsPath(repo), "utf8")), { enabledPlugins: PLUGIN_SETTINGS });
  const again = JSON.parse(bootstrap(repo, ["upgrade", "--json"]));
  assert.deepEqual(again.wrote, []);
});
