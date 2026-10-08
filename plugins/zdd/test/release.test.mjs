// CAS-97 (from CAS-37): the session-start release check. A repo locks one
// ZDD release tag in its project settings; this machine may hold another in
// its catalogue or have another installed for the project. One loud line
// names expected and found and the exact fix; silent when all match or when
// the repo locks nothing. Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = join(PLUGIN, "scripts", "check-release.mjs");
const INJECT = join(PLUGIN, "scripts", "inject-agent-index.mjs");
const POCOCK = JSON.parse(readFileSync(join(PLUGIN, "pocock.json"), "utf8"));

let scratch, repo, home;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-release-"));
  repo = join(scratch, "repo");
  home = join(scratch, "home");
  mkdirSync(join(repo, "zdd"), { recursive: true });
  mkdirSync(join(repo, ".claude"), { recursive: true });
  mkdirSync(join(home, ".claude", "plugins", "marketplaces", "zero-drift-docs", ".claude-plugin"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"] }));
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const lock = (ref) => writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify(ref === null ? {} : { extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref }, autoUpdate: false } } }));
const catalogue = (ref, pocockVersion = POCOCK.version) => {
  writeFileSync(join(home, ".claude", "plugins", "known_marketplaces.json"), JSON.stringify(ref === null ? {} : { "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref }, autoUpdate: false } }));
  writeFileSync(join(home, ".claude", "plugins", "marketplaces", "zero-drift-docs", ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "zero-drift-docs", plugins: [{ name: "zdd", version: ref ? ref.slice(1) : "0.0.0" }, { name: "mattpocock-skills", version: pocockVersion }] }));
};
const installed = (zdd, pocock, projectPath = repo) => {
  const row = (v) => (v === null ? [] : [{ scope: "project", projectPath, version: v }]);
  writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "zdd@zero-drift-docs": row(zdd), "mattpocock-skills@zero-drift-docs": row(pocock) } }));
};
// The check speaks only under Claude Code, which sets CLAUDECODE in its hooks
// and shells (CAS-101 CR-001); `host` lets a test stand in for Codex.
const run = (script = CHECK, ...args) => {
  const host = args[0] === "@codex" ? (args.shift(), {}) : { CLAUDECODE: "1" };
  const env = { ...process.env, ZDD_HOME: home, CLAUDE_PROJECT_DIR: repo, ...host };
  if (!host.CLAUDECODE) delete env.CLAUDECODE;
  const r = spawnSync(process.execPath, [script, `--root=${repo}`, `--home=${home}`, ...args], { encoding: "utf8", env });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  assert.equal(r.stderr, "");
  return r.stdout;
};

test("everything at the lock: silent", () => {
  lock("v2.1.0");
  catalogue("v2.1.0", "1.3.1");
  installed("2.1.0", "1.3.1");
  assert.equal(run(), "");
});

test("the machine has an older zdd installed for this project: one line, expected and found, the update command, restart (CAS-99: an installed plugin is updated, never reinstalled)", () => {
  lock("v2.1.0");
  catalogue("v2.1.0", "1.3.1");
  installed("2.0.0", "1.3.1");
  const out = run();
  assert.equal(out.trimEnd().split("\n").length, 1, out);
  assert.match(out, /^ZDD release mismatch: zdd@zero-drift-docs expected 2\.1\.0, found 2\.0\.0\./, out);
  assert.match(out, /Fix, from this repo's folder: claude plugin update zdd@zero-drift-docs; then restart Claude Code\./, out);
  assert.doesNotMatch(out, /marketplace|plugin install|restart Claude Code \(/, "the catalogue is right: no catalogue step, no first restart");
  assert.match(out, /Installed is not loaded/, "names the known limit");
});

test("the catalogue is at another tag: the pin-move route — restart (the catalogue follows the lock), update, restart again; no marketplace step on a machine with no stray declaration, never an add or update (CAS-99; decision 0022)", () => {
  lock("v2.1.0");
  catalogue("v1.3.1", "1.3.1");
  installed("1.3.1", "1.3.1");
  const out = run();
  assert.match(out, /the catalogue on this machine is at v1\.3\.1, this repo locks v2\.1\.0/, out);
  assert.match(out, /Fix, from this repo's folder: restart Claude Code \(the catalogue follows this repo's lock on restart\); claude plugin update zdd@zero-drift-docs; claude plugin update mattpocock-skills@zero-drift-docs; then restart Claude Code again\./, out);
  assert.doesNotMatch(out, /marketplace|plugin install/, out);
  // The Pocock expectation falls back to the running plugin's pin when the catalogue is not at the lock.
  const j = JSON.parse(run(CHECK, "--json"));
  assert.equal(j.expected.pocock, POCOCK.version);
});

test("only the catalogue is behind: restart, then update every installed plugin, then restart — the locked release may move Pocock, which a stale catalogue cannot show (CAS-99 CR-006, replacing the one-restart route)", () => {
  lock("v2.1.0");
  catalogue("v1.3.1", POCOCK.version);
  installed("2.1.0", POCOCK.version);
  const out = run();
  assert.match(out, /Fix, from this repo's folder: restart Claude Code \(the catalogue follows this repo's lock on restart\); claude plugin update zdd@zero-drift-docs; claude plugin update mattpocock-skills@zero-drift-docs; then restart Claude Code again\./, out);
  assert.doesNotMatch(out, /plugin install|marketplace/, out);
});

test("neither plugin installed for this project (another project's install does not count): both named as not installed", () => {
  lock("v2.1.0");
  catalogue("v2.1.0", "1.3.1");
  installed("2.1.0", "1.3.1", join(scratch, "other-repo"));
  const out = run();
  assert.match(out, /zdd@zero-drift-docs expected 2\.1\.0, not installed for this project/, out);
  assert.match(out, /mattpocock-skills@zero-drift-docs expected 1\.3\.1, not installed for this project/, out);
  assert.match(out, /Fix, from this repo's folder: claude plugin install zdd@zero-drift-docs --scope project; claude plugin install mattpocock-skills@zero-drift-docs --scope project; then restart Claude Code\./, out, "nothing to update: a missing install is installed");
});

test("the Pocock expectation comes from the catalogue's marketplace.json when the catalogue is at the lock", () => {
  lock("v2.1.0");
  catalogue("v2.1.0", "1.4.0");
  installed("2.1.0", "1.3.1");
  const out = run();
  assert.match(out, /mattpocock-skills@zero-drift-docs expected 1\.4\.0, found 1\.3\.1/, out);
  assert.doesNotMatch(out, /zdd@zero-drift-docs expected/, out);
  assert.match(out, /Fix, from this repo's folder: claude plugin update mattpocock-skills@zero-drift-docs; then restart Claude Code\./, out);
});

test("silent when the repo locks nothing, when the lock is not a tag, when the home files are missing or malformed", () => {
  lock(null);
  catalogue("v1.0.0");
  installed("1.0.0", "1.0.0");
  assert.equal(run(), "");
  writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ extraKnownMarketplaces: { "zero-drift-docs": { source: { ref: "main\u0007" } } } }));
  assert.equal(run(), "");
  lock("v2.1.0");
  rmSync(join(home, ".claude", "plugins", "installed_plugins.json"));
  writeFileSync(join(home, ".claude", "plugins", "known_marketplaces.json"), "{ nope");
  const out = run();
  assert.match(out, /the catalogue on this machine is at no recorded ref/, out);
  assert.match(out, /not installed for this project/, out);
  assert.doesNotMatch(out, /[\x00-\x09\x0b-\x1f]/, "control characters never reach the terminal");
});

test("the SessionStart hook prints the mismatch line even when the repo has opted out of the auto-load", () => {
  lock("v2.1.0");
  catalogue("v2.1.0", "1.3.1");
  installed("2.0.0", "1.3.1");
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], hooks: { autoLoad: false } }));
  const out = run(INJECT);
  assert.match(out, /^ZDD release mismatch:/, out);
  assert.doesNotMatch(out, /<zdd-agent-index>/, "no index when autoLoad is off");
  installed("2.1.0", "1.3.1");
  assert.equal(run(INJECT), "");
});

// CAS-101 (decision 0022): a plain `claude plugin marketplace add` also
// declares the marketplace in the user's settings, and that declaration pins
// the catalogue — a restart then never follows the repo's lock (reproduced on
// two clean profiles, Claude Code 2.1.289/2.1.295). The route removes the
// stray declaration first, by scope, and only where one exists.
const userDecl = (ref) => {
  const f = join(home, ".claude", "settings.json");
  if (ref === null) return rmSync(f, { force: true });
  writeFileSync(f, JSON.stringify({ theme: "dark", extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref } } } }));
};
const localDecl = (ref) => {
  const f = join(repo, ".claude", "settings.local.json");
  if (ref === null) return rmSync(f, { force: true });
  writeFileSync(f, JSON.stringify({ extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref } } } }));
};

test("a user-level declaration with the catalogue behind: remove it by scope first, then the pin-move route (decision 0022)", () => {
  lock("v2.1.0");
  catalogue("v1.3.1", "1.3.1");
  installed("1.3.1", "1.3.1");
  userDecl("v1.3.1");
  try {
    const out = run();
    assert.equal(out.trimEnd().split("\n").length, 1, out);
    assert.match(out, /your user settings \(~\/\.claude\/settings\.json\) also declare zero-drift-docs at v1\.3\.1, which holds the catalogue there/, out);
    assert.match(out, /Fix, from this repo's folder: claude plugin marketplace remove zero-drift-docs --scope user; restart Claude Code \(the catalogue follows this repo's lock on restart\); claude plugin update zdd@zero-drift-docs; claude plugin update mattpocock-skills@zero-drift-docs; then restart Claude Code again\./, out);
    assert.doesNotMatch(out, /marketplace add|marketplace update|--scope local/, out);
    const j = JSON.parse(run(CHECK, "--json"));
    assert.deepEqual(j.strayDeclarations, [{ scope: "user", ref: "v1.3.1", ours: true, source: "rich-rees/zero-drift-docs" }]);
  } finally {
    userDecl(null);
  }
});

test("a local declaration (any ref, or none) with the catalogue behind: removed with --scope local", () => {
  lock("v2.1.0");
  catalogue("v2.0.0", "1.3.1");
  installed("2.0.0", "1.3.1");
  localDecl("v2.1.0");
  try {
    const out = run();
    assert.match(out, /this repo's local settings \(\.claude\/settings\.local\.json\) also declare zero-drift-docs at v2\.1\.0/, out);
    assert.match(out, /Fix, from this repo's folder: claude plugin marketplace remove zero-drift-docs --scope local; restart Claude Code/, out);
  } finally {
    localDecl(null);
  }
});

test("a stray declaration while the catalogue is at the lock: silent — it is advisory about a mismatch, never noise", () => {
  lock("v2.1.0");
  catalogue("v2.1.0", "1.3.1");
  installed("2.1.0", "1.3.1");
  userDecl("v2.1.0");
  try {
    assert.equal(run(), "");
  } finally {
    userDecl(null);
  }
});

test("a malformed or oversized user settings file is no declaration", () => {
  lock("v2.1.0");
  catalogue("v1.3.1", "1.3.1");
  installed("1.3.1", "1.3.1");
  writeFileSync(join(home, ".claude", "settings.json"), "{ nope");
  try {
    const out = run();
    assert.doesNotMatch(out, /marketplace remove/, out);
    assert.match(out, /^ZDD release mismatch: the catalogue on this machine is at v1\.3\.1/, out);
  } finally {
    userDecl(null);
  }
});

test("under Codex (no CLAUDECODE) the check is silent — Codex has no Claude catalogue or installs to compare, and the lock is Claude Code's (CR-001)", () => {
  lock("v2.1.0");
  catalogue(null);
  rmSync(join(home, ".claude", "plugins", "installed_plugins.json"), { force: true });
  assert.match(run(), /^ZDD release mismatch:/, "Claude Code: loud");
  assert.equal(run(CHECK, "@codex"), "", "Codex: silent");
  assert.equal(run(INJECT, "@codex").includes("ZDD release mismatch"), false, "the SessionStart hook under Codex: silent");
});

test("a stray declaration from a fork or mirror is named, never removed by the route — it is the user's, and other repos may use it (CR-007)", () => {
  lock("v2.1.0");
  catalogue("v1.3.1", "1.3.1");
  installed("1.3.1", "1.3.1");
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: "me/zdd-fork", ref: "v1.3.1" } } } }));
  try {
    const out = run();
    assert.match(out, /your user settings \(~\/\.claude\/settings\.json\) declare zero-drift-docs from me\/zdd-fork, not rich-rees\/zero-drift-docs — yours to resolve by hand before the rest/, out);
    assert.doesNotMatch(out, /marketplace remove/, out);
    assert.match(out, /restart Claude Code \(the catalogue follows this repo's lock on restart\)/, out);
  } finally {
    userDecl(null);
  }
});

test("a local declaration with no ref is still stray; an oversized user settings file is no declaration (CR-020: the cases the earlier names claimed)", () => {
  lock("v2.1.0");
  catalogue("v1.3.1", "1.3.1");
  installed("1.3.1", "1.3.1");
  writeFileSync(join(repo, ".claude", "settings.local.json"), JSON.stringify({ extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs" } } } }));
  try {
    const out = run();
    assert.match(out, /this repo's local settings \(\.claude\/settings\.local\.json\) also declare zero-drift-docs, which holds the catalogue there/, out);
    assert.match(out, /claude plugin marketplace remove zero-drift-docs --scope local/, out);
  } finally {
    localDecl(null);
  }
  const huge = { extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref: "v1.3.1" } } }, pad: "x".repeat(2 * 1024 * 1024) };
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify(huge));
  try {
    assert.doesNotMatch(run(), /marketplace remove/, "over the size cap: not read");
  } finally {
    userDecl(null);
  }
});
