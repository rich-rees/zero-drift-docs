// 0.14.1 campaign (CR-386, CR-388, CR-389; decision 0050): the pin-move
// route as one command, `bootstrap.mjs move-machine`. It runs the route's
// steps in order — a stray declaration removed, the catalogue re-pointed by a
// project-scope add, relock, each plugin updated or installed — and stops at
// the first that fails, checking before any plugin step that the catalogue is
// at the lock and the lock keeps auto-update off. A fake `claude` (a node
// script, through ZDD_CLAUDE_BIN) records each call and plays the add.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const POCOCK = JSON.parse(readFileSync(join(PLUGIN, "pocock.json"), "utf8"));
const REPO_ID = "rich-rees/zero-drift-docs";

// The fake: appends its argv to calls.log; `marketplace add <repo>#<tag>
// --scope project` does what Claude Code 2.1.312 does — the catalogue moves to
// the tag and the repo's declaration is rewritten without autoUpdate. FAKE_FAIL
// names a subcommand that exits 1; FAKE_NOMOVE leaves the catalogue where it is;
// FAKE_BREAK leaves the settings file unreadable.
const FAKE = `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const a = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, JSON.stringify(a) + "\\n");
if (process.env.FAKE_FAIL && a.join(" ").startsWith(process.env.FAKE_FAIL)) process.exit(1);
if (a[0] === "plugin" && a[1] === "marketplace" && a[2] === "add") {
  const [repo, ref] = a[3].split("#");
  if (!process.env.FAKE_NOMOVE) {
    const k = join(process.env.FAKE_PLUGINS, "known_marketplaces.json");
    writeFileSync(k, JSON.stringify({ "zero-drift-docs": { source: { source: "github", repo, ref } } }));
  }
  const s = join(process.cwd(), ".claude", "settings.json");
  const obj = JSON.parse(readFileSync(s, "utf8"));
  obj.extraKnownMarketplaces["zero-drift-docs"] = { source: { source: "github", repo, ref } };
  writeFileSync(s, process.env.FAKE_BREAK ? "{ not json" : JSON.stringify(obj, null, 2) + "\\n");
}
`;

function machine(t, { catalogueRef = "v1.3.1", zdd = "1.3.1", pocock = "1.3.1", lockRef = "v2.1.0", userDecl = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "zdd-move-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  const home = join(dir, "home");
  const plugins = join(home, ".claude", "plugins");
  mkdirSync(join(repo, ".claude"), { recursive: true });
  mkdirSync(join(repo, "zdd"), { recursive: true });
  mkdirSync(join(plugins, "marketplaces", "zero-drift-docs", ".claude-plugin"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"] }));
  writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "zdd@zero-drift-docs": true }, extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: REPO_ID, ref: lockRef }, autoUpdate: false } } }, null, 2) + "\n");
  if (catalogueRef) writeFileSync(join(plugins, "known_marketplaces.json"), JSON.stringify({ "zero-drift-docs": { source: { source: "github", repo: REPO_ID, ref: catalogueRef } } }));
  writeFileSync(join(plugins, "marketplaces", "zero-drift-docs", ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ name: "mattpocock-skills", version: POCOCK.version }] }));
  const row = (v) => (v === null ? [] : [{ scope: "project", projectPath: repo, version: v }]);
  writeFileSync(join(plugins, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "zdd@zero-drift-docs": row(zdd), "mattpocock-skills@zero-drift-docs": row(pocock) } }));
  if (userDecl) writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: REPO_ID, ref: userDecl } } } }));
  const fake = join(dir, "claude-fake.mjs");
  writeFileSync(fake, FAKE);
  const log = join(dir, "calls.log");
  const run = (env = {}) => {
    const e = { ...process.env, ZDD_CLAUDE_BIN: fake, FAKE_LOG: log, FAKE_PLUGINS: plugins, ...env };
    delete e.CLAUDECODE; // run from a plain terminal: the check's Claude Code gate never applies here
    delete e.CLAUDE_CONFIG_DIR;
    const r = spawnSync(process.execPath, [SCRIPT, "move-machine", `--root=${repo}`, `--home=${home}`], { cwd: repo, encoding: "utf8", env: e });
    const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { status: r.status, out: r.stdout + r.stderr, calls };
  };
  const settings = () => JSON.parse(readFileSync(join(repo, ".claude", "settings.json"), "utf8"));
  return { repo, home, run, settings };
}

test("move-machine runs the route in order — add at the lock, relock, each plugin — and ends naming the restart", (t) => {
  const m = machine(t);
  const r = m.run();
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.calls, [
    ["plugin", "marketplace", "add", `${REPO_ID}#v2.1.0`, "--scope", "project"],
    ["plugin", "update", "zdd@zero-drift-docs", "--scope", "project"],
    ["plugin", "update", "mattpocock-skills@zero-drift-docs", "--scope", "project"],
  ]);
  assert.equal(m.settings().extraKnownMarketplaces["zero-drift-docs"].autoUpdate, false, "relock ran between the add and the updates");
  assert.match(r.out, /restart Claude Code/);
});

test("a stray user declaration is removed first; a missing install is installed", (t) => {
  const m = machine(t, { pocock: null, userDecl: "v1.3.1" });
  const r = m.run();
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.calls.map((c) => c.slice(0, 3).join(" ")), ["plugin marketplace remove", "plugin marketplace add", "plugin update zdd@zero-drift-docs", "plugin install mattpocock-skills@zero-drift-docs"]);
  assert.deepEqual(r.calls[0], ["plugin", "marketplace", "remove", "zero-drift-docs", "--scope", "user"]);
});

test("the first step that fails stops the route: nothing after it runs, and the exit is not 0 (CR-386)", (t) => {
  const m = machine(t);
  const r = m.run({ FAKE_FAIL: "plugin marketplace add" });
  assert.equal(r.status, 1, r.out);
  assert.equal(r.calls.length, 1, JSON.stringify(r.calls));
  assert.match(r.out, /stopped/i);
  const u = machine(t, { catalogueRef: "v2.1.0", zdd: "2.0.0" });
  const r2 = u.run({ FAKE_FAIL: "plugin update zdd" });
  assert.equal(r2.status, 1, r2.out);
  assert.deepEqual(r2.calls.map((c) => c[2]), ["zdd@zero-drift-docs"], "the Pocock update never ran");
});

test("an add that leaves the catalogue elsewhere stops before any plugin step (CR-386)", (t) => {
  const m = machine(t);
  const r = m.run({ FAKE_NOMOVE: "1" });
  assert.equal(r.status, 1, r.out);
  assert.equal(r.calls.length, 1, JSON.stringify(r.calls));
  assert.match(r.out, /catalogue .*v1\.3\.1.*v2\.1\.0|v2\.1\.0.*v1\.3\.1/);
});

test("a lock relock cannot keep — the add left the settings file unreadable — stops before any plugin step, exit 1 (CR-386)", (t) => {
  const m = machine(t);
  const r = m.run({ FAKE_BREAK: "1" });
  assert.equal(r.status, 1, r.out);
  assert.equal(r.calls.length, 1, JSON.stringify(r.calls));
  assert.match(r.out, /auto-update off after relock/);
});

test("at the lock already: nothing runs, exit 0, and it says so", (t) => {
  const m = machine(t, { catalogueRef: "v2.1.0", zdd: "2.1.0", pocock: POCOCK.version });
  const r = m.run();
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.calls, []);
  assert.match(r.out, /nothing to move/);
});

// CR-405 (verify pass 1): with the catalogue already at the lock, the plan
// has no add, and so no relock step; the lock is still put right and checked
// before any plugin step — and when there is nothing to move at all.
test("the lock keeps auto-update off even when only a plugin moves, and when nothing does (CR-405)", (t) => {
  for (const [name, opts, calls] of [["update", { catalogueRef: "v2.1.0", zdd: "2.0.0" }, 1], ["none", { catalogueRef: "v2.1.0", zdd: "2.1.0", pocock: POCOCK.version }, 0]]) {
    const m = machine(t, opts);
    const s = m.settings();
    delete s.extraKnownMarketplaces["zero-drift-docs"].autoUpdate;
    writeFileSync(join(m.repo, ".claude", "settings.json"), JSON.stringify(s, null, 2) + "\n");
    const r = m.run();
    assert.equal(r.status, 0, `${name}: ${r.out}`);
    assert.equal(r.calls.length, calls, `${name}: ${JSON.stringify(r.calls)}`);
    assert.equal(m.settings().extraKnownMarketplaces["zero-drift-docs"].autoUpdate, false, name);
  }
});
