// CAS-101: the guided upgrade at the file seam. `upgrade --plan` shows what
// would change and writes nothing; the notes say what is new since the repo's
// engine pin, per release, and every minor has one; 2.1's note re-runs
// detection and names the opt-in extractors with their evidence, never adding
// one; text in CLAUDE.md / AGENTS.md outside the managed block that the block
// now covers is named, and removed only by `--drop`; `release-status` finds
// the newest release tag; `upgrade --to` moves only the lock to a newer
// release. Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { UPGRADE_NOTES, newestTag } from "../scripts/bootstrap.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const ENGINE_FIXTURES = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "test");
const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const MINOR = VERSION.split(".").slice(0, 2).join(".");
const LOCK = (ref) => ({ "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref }, autoUpdate: false } });

let scratch, home;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-upgrade-"));
  home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const run = (root, args) => execFileSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${home}`], { encoding: "utf8" });
const runJson = (root, args) => JSON.parse(run(root, [...args, "--json"]));
const fails = (root, args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${home}`], { encoding: "utf8" });
  assert.equal(r.status, 1, `expected failure: ${r.stdout}`);
  return r.stderr;
};
const adopted = (name, { engine = "2.0.0", extractors = ["generic"], claude, settings = { extraKnownMarketplaces: LOCK("v2.0.0") }, fixture } = {}) => {
  const repo = join(scratch, name);
  if (fixture) {
    cpSync(join(ENGINE_FIXTURES, fixture), repo, { recursive: true });
    rmSync(join(repo, "zdd"), { recursive: true });
  }
  mkdirSync(join(repo, "zdd"), { recursive: true });
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors, ...(engine ? { engine } : {}) }, null, 2) + "\n");
  if (settings) writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  if (claude !== undefined) writeFileSync(join(repo, "CLAUDE.md"), claude);
  return repo;
};
const snapshot = (dir) => {
  const out = {};
  const walk = (d, rel = "") => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), r);
      else out[r] = readFileSync(join(d, e.name), "utf8");
    }
  };
  walk(dir);
  return out;
};

test("upgrade --plan writes nothing and names exactly what the real upgrade then changes", () => {
  const repo = adopted("plan", { claude: "# Mine\n\nHello.\n" });
  const before = snapshot(repo);
  const plan = runJson(repo, ["upgrade", "--plan"]);
  assert.equal(plan.plan, true);
  assert.deepEqual(snapshot(repo), before, "nothing written");
  assert.ok(plan.wrote.includes("zdd/config.json") && plan.wrote.includes(".claude/settings.json"), plan.wrote.join("\n"));
  const text = run(repo, ["upgrade", "--plan"]);
  assert.match(text, /^Upgrade plan for plugin \d+\.\d+\.\d+ — nothing written yet/m, text);
  assert.match(text, /would change zdd\/config\.json/, text);
  const real = runJson(repo, ["upgrade"]);
  assert.deepEqual(real.wrote, plan.wrote);
});

test("every minor from 1.1 to this plugin's has an upgrade note — a release without one fails here (the checklist, backed)", () => {
  assert.ok(UPGRADE_NOTES[`${MINOR}.0`], `no upgrade note for ${MINOR}: add one to UPGRADE_NOTES in scripts/bootstrap.mjs and an "Upgrading to ${MINOR}" section to skills/upgrade/SKILL.md`);
  for (const m of ["1.1.0", "1.3.0", "2.0.0", "2.1.0"]) assert.ok(UPGRADE_NOTES[m], m);
  const skill = readFileSync(join(PLUGIN, "skills", "upgrade", "SKILL.md"), "utf8");
  assert.match(skill, new RegExp(`^#+ Upgrading to ${MINOR.replace(".", "\\.")}\\b`, "m"), `skills/upgrade/SKILL.md needs an "Upgrading to ${MINOR}" section`);
});

test("the notes say what is new since the repo's engine pin: from 2.0 no 1.x or 2.0 notes; from 1.3.1 the 2.0 notes too; an unpinned repo hears everything", () => {
  const from20 = runJson(adopted("from-2-0", { engine: "2.0.0" }), ["upgrade", "--plan"]).notes.join("\n");
  assert.match(from20, /^2\.1 /m, from20);
  assert.match(from20, new RegExp(`^${MINOR.replace(".", "\\.")} `, "m"), from20);
  assert.doesNotMatch(from20, /^2\.0 |^1\.1 /m, from20);
  const from13 = runJson(adopted("from-1-3", { engine: "1.3.1" }), ["upgrade", "--plan"]).notes.join("\n");
  assert.match(from13, /^2\.0 adds "choose patterns"/m, from13);
  assert.doesNotMatch(from13, /^1\.1 /m, from13);
  const unpinned = runJson(adopted("unpinned", { engine: null }), ["upgrade", "--plan"]).notes.join("\n");
  assert.match(unpinned, /^1\.1 /m, unpinned);
});

test("2.1's note re-runs detection: an opt-in extractor the evidence shows is offered with that evidence, never added", () => {
  const repo = adopted("detect-2-1", { fixture: "fixture-jobs", extractors: ["supabase"] });
  const json = runJson(repo, ["upgrade"]);
  const notes = json.notes.join("\n");
  assert.match(notes, /^2\.1 offers the opt-in extractor `jobs`.*`Procfile` runs a process/m, notes);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).extractors, ["supabase"], "never added silently");
  assert.match(notes, /^2\.1 .*`\*` in a scanned url: it no longer matches a fixed route segment/m, notes);
});

const CLAUDE_WITH_DUPES = [
  "# Project",
  "",
  "Intro.",
  "",
  "## Loading ZDD",
  "",
  'Say "load ZDD" before work. Never hand-edit zdd/graph.json.',
  "",
  "## Workflow",
  "",
  "Branch off main.",
  "",
  "### Docs",
  "",
  'Run "update ZDD" before finishing.',
  "",
  "### Testing",
  "",
  "Run the tests.",
  "",
  "## Unrelated",
  "",
  "Nothing here.",
  "",
  "<!-- zdd:begin -->",
  "## Documentation — Zero-Drift Docs (ZDD)",
  "old block",
  "<!-- zdd:end -->",
  "",
].join("\n");

test("text outside the managed block that the block now covers is named with its lines — a section with an unrelated child is never named whole", () => {
  const repo = adopted("dupes", { claude: CLAUDE_WITH_DUPES });
  const plan = runJson(repo, ["upgrade", "--plan"]);
  assert.deepEqual(
    plan.duplicates.map((d) => [d.id, d.file, d.heading, d.from, d.to]),
    [
      [1, "CLAUDE.md", "## Loading ZDD", 5, 8],
      [2, "CLAUDE.md", "### Docs", 13, 16],
    ],
  );
  const text = run(repo, ["upgrade", "--plan"]);
  assert.match(text, /outside the ZDD block: \[1\] CLAUDE\.md lines 5–8 "## Loading ZDD"/, text);
});

test("a passing mention is not a duplicate: the document's title, and a section that names ZDD once, are never named (CAS-101 smoke: `# Bookmarks … smoke-test the ZDD plugin`)", async () => {
  const { findDuplicates } = await import("../scripts/bootstrap.mjs");
  const text = [
    "# Bookmarks",
    "",
    "A tiny app used to smoke-test the ZDD plugin.",
    "",
    "<!-- zdd:begin -->",
    "## Documentation — Zero-Drift Docs (ZDD)",
    "<!-- zdd:end -->",
    "",
    "## Deploying",
    "",
    "Push to main; the ZDD check runs in CI.",
    "",
    "## Documentation",
    "",
    "Load ZDD first. Never hand-edit zdd/graph.json.",
    "",
  ].join("\n");
  assert.deepEqual(findDuplicates(text).map((d) => d.heading), ["## Documentation"]);
});

test("--drop removes only the named sections, after the block is refreshed; ids out of range are refused before any write", () => {
  const repo = adopted("drop", { claude: CLAUDE_WITH_DUPES });
  assert.match(fails(repo, ["upgrade", "--drop=3"]), /--drop: no duplicate 3/);
  assert.equal(readFileSync(join(repo, "CLAUDE.md"), "utf8"), CLAUDE_WITH_DUPES, "refused before writing");
  const json = runJson(repo, ["upgrade", "--drop=1"]);
  const after = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  assert.doesNotMatch(after, /## Loading ZDD/);
  assert.match(after, /### Docs/, "not dropped: not named");
  assert.match(after, /<!-- zdd:begin -->[\s\S]*<!-- zdd:end -->/, "the block is there");
  assert.match(after, /^Intro\.$/m);
  assert.ok(json.notes.some((n) => /CLAUDE\.md: removed "## Loading ZDD" \(lines 5–8\), on the user's word/.test(n)), json.notes.join("\n"));
  assert.deepEqual(runJson(repo, ["upgrade", "--plan"]).duplicates.map((d) => d.heading), ["### Docs"]);
});

test("newestTag: the highest release tag by semver, ignoring pre-releases and junk", () => {
  const lines = ["abc\trefs/tags/v2.1.1", "def\trefs/tags/v2.10.0", "123\trefs/tags/v2.9.9", "456\trefs/tags/v3.0.0-rc.1", "789\trefs/tags/nightly", "000\trefs/tags/v2.2.0^{}"];
  assert.equal(newestTag(lines.join("\n")), "v2.10.0");
  assert.equal(newestTag(""), null);
});

test("release-status reads the lock, the running plugin and the newest tag on the remote (a local repo stands in for GitHub)", () => {
  const remote = join(scratch, "remote");
  mkdirSync(remote);
  const git = (...a) => execFileSync("git", a, { cwd: remote, encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
  for (const t of ["v2.1.1", "v9.0.0", "v9.0.1-rc.1"]) git("tag", t);
  const repo = adopted("status", { settings: { extraKnownMarketplaces: LOCK("v2.1.1") } });
  const s = runJson(repo, ["release-status", `--remote=${remote}`]);
  assert.deepEqual(s, { lock: "v2.1.1", running: VERSION, newest: "v9.0.0", newer: true });
  const text = run(repo, ["release-status", `--remote=${remote}`]);
  assert.match(text, /ZDD v9\.0\.0 is out; this repo locks v2\.1\.1 and this session runs \d+\.\d+\.\d+/, text);
});

test("upgrade --to a newer release moves only the lock and names the route; never backwards, never an absent or foreign lock", () => {
  const repo = adopted("to", { settings: { extraKnownMarketplaces: LOCK("v2.0.0") } });
  const before = readFileSync(join(repo, "zdd", "config.json"), "utf8");
  const json = runJson(repo, ["upgrade", "--to=v9.0.0"]);
  assert.deepEqual(json.wrote, [".claude/settings.json"]);
  assert.equal(JSON.parse(readFileSync(join(repo, ".claude", "settings.json"), "utf8")).extraKnownMarketplaces["zero-drift-docs"].source.ref, "v9.0.0");
  assert.equal(readFileSync(join(repo, "zdd", "config.json"), "utf8"), before, "the rest waits for the new release's own upgrade");
  assert.ok(json.notes.some((n) => /restart Claude Code.*say "upgrade ZDD" again/i.test(n)), json.notes.join("\n"));
  assert.match(fails(repo, ["upgrade", "--to=v1.0.0"]), /older than this plugin/);
  assert.match(fails(repo, ["upgrade", "--to=latest"]), /--to must be a release tag/);
  const none = adopted("to-none", { settings: {} });
  assert.match(fails(none, ["upgrade", "--to=v9.0.0"]), /no lock/);
});
