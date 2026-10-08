// CAS-93: ZDD pins one release of mattpocock-skills and brings it in as a
// dependency from its own marketplace. Two enabled copies of that plugin name
// load as ONE, silently, and the other copy can win — so `load`'s step 0 (and
// the session-start hook) warn when any other copy is switched on for this
// repo, naming both versions, where it is switched on, and the one-line fix.
// Also pins the plugin's Pocock record to the marketplace entry and the
// dependency declaration, so the three cannot drift.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = join(PLUGIN, "scripts", "check-pocock.mjs");
const POCOCK = JSON.parse(readFileSync(join(PLUGIN, "pocock.json"), "utf8"));
const OURS = `${POCOCK.plugin}@${POCOCK.marketplace}`;
const esc = (s) => s.replace(/[.@]/g, "\\$&");

let scratch, repo, home;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-pocock-"));
  repo = join(scratch, "repo");
  home = join(scratch, "home");
  mkdirSync(join(repo, "zdd"), { recursive: true });
  mkdirSync(join(repo, ".claude"), { recursive: true });
  mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"] }));
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const settings = (file, obj) => {
  const p = file === "user" ? join(home, ".claude", "settings.json") : join(repo, ".claude", file === "project" ? "settings.json" : "settings.local.json");
  if (obj === null) {
    if (existsSync(p)) rmSync(p);
    return;
  }
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
};
const installed = (obj) => writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify(obj));
const run = (...args) => {
  const r = spawnSync(process.execPath, [CHECK, `--root=${repo}`, `--home=${home}`, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  assert.equal(r.stderr, "");
  return r.stdout;
};
const reset = () => {
  for (const f of ["user", "project", "local"]) settings(f, null);
  installed({ version: 2, plugins: { "mattpocock-skills@claude-plugins-official": [{ scope: "user", version: "1.2.3" }], [OURS]: [{ scope: "user", version: POCOCK.version }] } });
};

test("pocock.json, the marketplace entry and the dependency agree: one pinned release, by tag and commit", () => {
  const market = JSON.parse(readFileSync(resolve(PLUGIN, "..", "..", ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(market.name, POCOCK.marketplace);
  const entry = market.plugins.find((p) => p.name === POCOCK.plugin);
  assert.ok(entry, "marketplace lists mattpocock-skills");
  assert.deepEqual(entry.source, { source: "url", url: POCOCK.repo, ref: POCOCK.ref, sha: POCOCK.sha }, "pinned by tag AND commit, over https (the github form clones over ssh)");
  assert.equal(entry.version, POCOCK.version);
  assert.equal(POCOCK.ref, `v${POCOCK.version}`);
  assert.match(POCOCK.sha, /^[0-9a-f]{40}$/);
  const manifest = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8"));
  assert.ok(manifest.dependencies.includes(POCOCK.plugin), "zdd depends on it, same marketplace");
  assert.deepEqual(POCOCK.otherCopies, ["mattpocock-skills@mattpocock", "mattpocock-skills@claude-plugins-official"]);
});

test("another copy enabled in user settings: one line names both versions, the user file, and the fix — never 'uninstall'", () => {
  reset();
  settings("user", { enabledPlugins: { "mattpocock-skills@claude-plugins-official": true, [OURS]: true } });
  const out = run();
  assert.equal(out.trimEnd().split("\n").length, 1, out);
  assert.match(out, /^ZDD: another copy of mattpocock-skills is switched on in this repo/, out);
  assert.match(out, /mattpocock-skills@claude-plugins-official 1\.2\.3 \(enabled in ~\/\.claude\/settings\.json, user settings\)/, out);
  assert.match(out, new RegExp(`${esc(OURS)} ${esc(POCOCK.version)}`), out);
  assert.match(out, /"mattpocock-skills@claude-plugins-official": false/, out);
  assert.match(out, /\.claude\/settings\.json/, out);
  assert.match(out, /Never uninstall/, "the fix is the settings line, and it says so");
  assert.doesNotMatch(out, /plugin uninstall|uninstall it,? then|run .*uninstall/i, out);
  assert.match(out, /other repos/, out);
});

test("project settings switching the other copy off silence the warning; local settings switching it back on are named as local", () => {
  reset();
  settings("user", { enabledPlugins: { "mattpocock-skills@claude-plugins-official": true } });
  settings("project", { enabledPlugins: { "mattpocock-skills@claude-plugins-official": false, [OURS]: true } });
  assert.equal(run(), "");
  settings("local", { enabledPlugins: { "mattpocock-skills@claude-plugins-official": true } });
  assert.match(run(), /enabled in \.claude\/settings\.local\.json, local settings/);
});

test("a copy from an unknown marketplace, with no install record, is still named — with 'unknown version'", () => {
  reset();
  settings("project", { enabledPlugins: { "mattpocock-skills@some-fork": true, [OURS]: true } });
  assert.match(run(), /mattpocock-skills@some-fork unknown version \(enabled in \.claude\/settings\.json, project settings\)/);
});

test("ZDD's own pinned copy switched off is its own line: zdd does not load until it is on", () => {
  reset();
  settings("project", { enabledPlugins: { [OURS]: false } });
  const out = run();
  assert.match(out, new RegExp(`^ZDD: ${esc(OURS)} is switched off in \\.claude/settings\\.json, project settings — zdd does not load`), out);
  assert.match(out, /true/, "names the fix");
});

test("silent and exit 0 on: only our copy; no settings at all; unreadable settings; a settings file that is not an object", () => {
  reset();
  settings("user", { enabledPlugins: { [OURS]: true } });
  assert.equal(run(), "");
  settings("user", null);
  assert.equal(run(), "");
  settings("project", "{ nope");
  assert.equal(run(), "");
  settings("project", "[1,2]");
  assert.equal(run(), "");
  settings("project", { enabledPlugins: "not an object" });
  assert.equal(run(), "");
});

test("--json lists every other copy with id, version and source, and whether ours is on", () => {
  reset();
  settings("user", { enabledPlugins: { "mattpocock-skills@claude-plugins-official": true } });
  const j = JSON.parse(run("--json"));
  assert.equal(j.pinned.id, OURS);
  assert.equal(j.pinned.version, POCOCK.version);
  assert.equal(j.pinned.enabled, true, "absent from every file means on (defaultEnabled)");
  assert.deepEqual(j.others, [{ id: "mattpocock-skills@claude-plugins-official", version: "1.2.3", source: "user" }]);
});

test("the Pocock check reads user settings and installs from CLAUDE_CONFIG_DIR when it is set (2.2.1, CAS-101 smoke)", () => {
  reset();
  settings("user", { enabledPlugins: { "mattpocock-skills@claude-plugins-official": true } });
  // A version only this profile holds, so the line proves which folder was read.
  installed({ version: 2, plugins: { "mattpocock-skills@claude-plugins-official": [{ scope: "user", version: "7.7.7" }], [OURS]: [{ scope: "user", version: POCOCK.version }] } });
  try {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: join(home, ".claude") };
    delete env.ZDD_HOME;
    const r = spawnSync(process.execPath, [CHECK, `--root=${repo}`], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    // Named by the file actually read, not the default's name (CR-204).
    assert.ok(r.stdout.includes(`mattpocock-skills@claude-plugins-official 7.7.7 (enabled in ${join(home, ".claude", "settings.json")}, user settings)`), r.stdout);
  } finally {
    reset();
  }
});
