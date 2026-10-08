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
const CHECK_RELEASE = join(PLUGIN, "scripts", "check-release.mjs");

const PLUGIN_SETTINGS = {
  "zdd@zero-drift-docs": true,
  "mattpocock-skills@zero-drift-docs": true,
  "mattpocock-skills@mattpocock": false,
  "mattpocock-skills@claude-plugins-official": false,
};
// Decision 0021 (CAS-101): the lock — this release's tag, auto-update off.
const LOCK = { "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref: `v${PLUGIN_VERSION}` }, autoUpdate: false } };

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
  assert.deepEqual(JSON.parse(readFileSync(settingsPath(repo), "utf8")), { enabledPlugins: PLUGIN_SETTINGS, extraKnownMarketplaces: LOCK });
  assert.match(out, /locked this repo to ZDD v\d+\.\d+\.\d+/, out);
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
  assert.deepEqual(Object.keys(after), ["permissions", "enabledPlugins", "model", "extraKnownMarketplaces"], "top-level order kept; the lock appended");
  assert.deepEqual(after.extraKnownMarketplaces, LOCK);
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

// ---- the lock (decision 0021, CAS-101) ------------------------------------
const settingsRepo = (name, settings, config = { extractors: ["generic"], engine: "2.0.0" }) => {
  const repo = join(scratch, name);
  mkdirSync(join(repo, "zdd"), { recursive: true });
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(config));
  if (settings !== undefined) writeFileSync(settingsPath(repo), JSON.stringify(settings, null, 2) + "\n");
  return repo;
};
const readSettings = (repo) => JSON.parse(readFileSync(settingsPath(repo), "utf8"));

test("apply keeps an existing lock (ours at another tag, or a fork) and names it — moving a lock is upgrade's job", () => {
  const repo = fastapiRepo("lock-kept");
  mkdirSync(join(repo, ".claude"));
  const fork = { "zero-drift-docs": { source: { source: "github", repo: "someone/zdd-fork", ref: "v9.9.9" } }, other: { source: { source: "github", repo: "o/r" } } };
  writeFileSync(settingsPath(repo), JSON.stringify({ enabledPlugins: PLUGIN_SETTINGS, extraKnownMarketplaces: fork }, null, 2) + "\n");
  const json = applyJson(repo, "lock-kept", { name: "X" });
  assert.deepEqual(readSettings(repo).extraKnownMarketplaces, fork, "a declaration that is not this marketplace's repository is the adopter's");
  assert.ok(json.notes.some((n) => /declares zero-drift-docs from someone\/zdd-fork.*not this plugin's repository.*left as it is/i.test(n)), json.notes.join("\n"));
});

test("upgrade moves our lock's ref to this release, keeps its other fields and every other marketplace, and says what the team does next", () => {
  const settings = { extraKnownMarketplaces: { other: { source: { source: "github", repo: "o/r" } }, "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref: "v1.3.1" }, autoUpdate: false } }, enabledPlugins: PLUGIN_SETTINGS };
  const repo = settingsRepo("lock-move", settings);
  const json = JSON.parse(bootstrap(repo, ["upgrade", "--json"]));
  const after = readSettings(repo);
  assert.deepEqual(Object.keys(after), ["extraKnownMarketplaces", "enabledPlugins"]);
  assert.deepEqual(Object.keys(after.extraKnownMarketplaces), ["other", "zero-drift-docs"]);
  assert.equal(after.extraKnownMarketplaces["zero-drift-docs"].source.ref, `v${PLUGIN_VERSION}`);
  assert.equal(after.extraKnownMarketplaces["zero-drift-docs"].autoUpdate, false);
  assert.ok(json.notes.some((n) => n.includes(`lock moved v1.3.1 → v${PLUGIN_VERSION}.`)), json.notes.join("\n"));
  assert.ok(json.notes.some((n) => /after this PR merges.*next session/i.test(n)), json.notes.join("\n"));
  const again = JSON.parse(bootstrap(repo, ["upgrade", "--json"]));
  assert.ok(!again.wrote.includes(".claude/settings.json"), "idempotent");
});

test("upgrade on a repo with no lock names the gap and writes nothing until --lock; with --lock it writes ours", () => {
  const repo = settingsRepo("lock-absent", { enabledPlugins: PLUGIN_SETTINGS });
  const json = JSON.parse(bootstrap(repo, ["upgrade", "--json"]));
  assert.equal(readSettings(repo).extraKnownMarketplaces, undefined);
  assert.ok(json.notes.some((n) => /no lock.*--lock/i.test(n)), json.notes.join("\n"));
  const locked = JSON.parse(bootstrap(repo, ["upgrade", "--lock", "--json"]));
  assert.ok(locked.wrote.includes(".claude/settings.json"));
  assert.deepEqual(readSettings(repo).extraKnownMarketplaces, LOCK);
});

test("upgrade never rewrites a fork's declaration, even with --lock", () => {
  const fork = { "zero-drift-docs": { source: { source: "git", url: "https://example.com/mirror.git", ref: "v1.0.0" } } };
  const repo = settingsRepo("lock-fork", { enabledPlugins: PLUGIN_SETTINGS, extraKnownMarketplaces: fork });
  const json = JSON.parse(bootstrap(repo, ["upgrade", "--lock", "--json"]));
  assert.deepEqual(readSettings(repo).extraKnownMarketplaces, fork);
  assert.ok(json.notes.some((n) => /not this plugin's repository/i.test(n)), json.notes.join("\n"));
});

test("writer binds to reader: a freshly bootstrapped repo's lock is what the release check reads — silent at a matching install, loud at a stale one", () => {
  const repo = fastapiRepo("bind");
  applyJson(repo, "bind", { name: "X" });
  const home = join(scratch, "bind-home");
  const plugins = join(home, ".claude", "plugins");
  mkdirSync(join(plugins, "marketplaces", "zero-drift-docs", ".claude-plugin"), { recursive: true });
  const pocock = JSON.parse(readFileSync(join(PLUGIN, "pocock.json"), "utf8")).version;
  const machine = (ref, zdd) => {
    writeFileSync(join(plugins, "known_marketplaces.json"), JSON.stringify({ "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref } } }));
    writeFileSync(join(plugins, "marketplaces", "zero-drift-docs", ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ name: "mattpocock-skills", version: pocock }] }));
    const row = (version) => [{ scope: "project", projectPath: repo, version }];
    writeFileSync(join(plugins, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "zdd@zero-drift-docs": row(zdd), "mattpocock-skills@zero-drift-docs": row(pocock) } }));
  };
  const check = () => execFileSync(process.execPath, [CHECK_RELEASE, `--root=${repo}`, `--home=${home}`], { encoding: "utf8" });
  machine(`v${PLUGIN_VERSION}`, PLUGIN_VERSION);
  assert.equal(check(), "", "silent at the release bootstrap locked");
  machine("v1.3.1", "1.3.1");
  assert.ok(check().startsWith(`ZDD release mismatch: the catalogue on this machine is at v1.3.1, this repo locks v${PLUGIN_VERSION};`), "loud at a stale machine");
});
