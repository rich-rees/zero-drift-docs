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
import { tmpdir, homedir } from "node:os";
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
  assert.deepEqual(real.notes, plan.notes, "the user approves the plan's notes; the run says the same (CR-018)");
  assert.deepEqual(real.kept, plan.kept);
});

test("every release from 1.1 on (the README's Versioning list) has an upgrade note, and this minor an Upgrading section — a release without one fails here (the checklist, backed)", () => {
  assert.ok(UPGRADE_NOTES[`${MINOR}.0`], `no upgrade note for ${MINOR}: add one to UPGRADE_NOTES in scripts/bootstrap.mjs and an "Upgrading to ${MINOR}" section to skills/upgrade/SKILL.md`);
  // Every release the README's Versioning lists from 1.1 on — patches too — has a note (CR-017):
  // the list comes from the README, so a release cannot be added there and forgotten here.
  const readme = readFileSync(join(PLUGIN, "..", "..", "README.md"), "utf8");
  const released = [...readme.matchAll(/^- \*\*`(\d+\.\d+\.\d+)` —/gm)].map((m) => m[1]).filter((v) => v !== "1.0.0");
  assert.ok(released.includes("1.2.0") && released.includes("1.3.1") && released.includes(VERSION), released.join(", "));
  for (const v of released) assert.ok(UPGRADE_NOTES[v], `UPGRADE_NOTES has no entry for ${v}`);
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
    plan.duplicates.map((d) => [d.file, d.heading, d.from, d.to]),
    [
      ["CLAUDE.md", "## Loading ZDD", 5, 8],
      ["CLAUDE.md", "### Docs", 13, 16],
    ],
  );
  // The id is the section's content hash (CR-014): stable across runs, distinct per section.
  for (const d of plan.duplicates) assert.match(d.id, /^[0-9a-f]{8}$/);
  assert.notEqual(plan.duplicates[0].id, plan.duplicates[1].id);
  assert.deepEqual(runJson(repo, ["upgrade", "--plan"]).duplicates.map((d) => d.id), plan.duplicates.map((d) => d.id));
  const text = run(repo, ["upgrade", "--plan"]);
  assert.ok(text.includes(`outside the ZDD block: [${plan.duplicates[0].id}] CLAUDE.md lines 5–8 "## Loading ZDD"`), text);
});

test("no well-formed block, no duplicates: a lone, doubled or reversed marker (the refresh is refused) or no block at all names nothing, and --drop cannot reach in (CR-002)", async () => {
  const { findDuplicates } = await import("../scripts/bootstrap.mjs");
  const body = ["## Loading ZDD", "", 'Say "load ZDD" first.', ""];
  const shapes = {
    none: body,
    lone: ["<!-- zdd:begin -->", ...body],
    reversed: ["<!-- zdd:end -->", ...body, "<!-- zdd:begin -->"],
    doubled: ["<!-- zdd:begin -->", "<!-- zdd:end -->", ...body, "<!-- zdd:begin -->", "<!-- zdd:end -->"],
  };
  for (const [name, lines] of Object.entries(shapes)) assert.deepEqual(findDuplicates(lines.join("\n")), [], name);
  const repo = adopted("drop-malformed", { claude: shapes.reversed.join("\n") });
  assert.deepEqual(runJson(repo, ["upgrade", "--plan"]).duplicates, []);
  assert.match(fails(repo, ["upgrade", "--drop=0123abcd"]), /--drop: no duplicate 0123abcd/);
  assert.equal(readFileSync(join(repo, "CLAUDE.md"), "utf8"), shapes.reversed.join("\n"));
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

test("--drop removes only the named sections, after the block is refreshed; an id the plan did not name — or a section edited since the plan — is refused before any write (CR-014)", () => {
  const repo = adopted("drop", { claude: CLAUDE_WITH_DUPES });
  const [loading] = runJson(repo, ["upgrade", "--plan"]).duplicates;
  assert.match(fails(repo, ["upgrade", "--drop=0123abcd"]), /--drop: no duplicate 0123abcd/);
  assert.match(fails(repo, ["upgrade", "--drop=1"]), /--drop takes the ids upgrade --plan printed/);
  assert.equal(readFileSync(join(repo, "CLAUDE.md"), "utf8"), CLAUDE_WITH_DUPES, "refused before writing");
  // The user approved the section as planned; it changes before the write: refused.
  writeFileSync(join(repo, "CLAUDE.md"), CLAUDE_WITH_DUPES.replace('Say "load ZDD" before work.', 'Say "load ZDD" before any work.'));
  assert.match(fails(repo, ["upgrade", `--drop=${loading.id}`]), new RegExp(`--drop: no duplicate ${loading.id}`));
  writeFileSync(join(repo, "CLAUDE.md"), CLAUDE_WITH_DUPES);
  const json = runJson(repo, ["upgrade", `--drop=${loading.id}`]);
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

// A local repo with release tags stands in for the marketplace's GitHub repo.
let remoteDir;
const remote = () => {
  if (remoteDir) return remoteDir;
  remoteDir = join(scratch, "tags-remote");
  mkdirSync(remoteDir);
  const git = (...a) => execFileSync("git", a, { cwd: remoteDir, encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
  for (const t of [`v${VERSION}`, "v9.0.0", "v9.1.0"]) git("tag", t);
  return remoteDir;
};
const settingsOf = (repo) => JSON.parse(readFileSync(join(repo, ".claude", "settings.json"), "utf8"));

test("upgrade --to a newer release moves only the lock (auto-update off) and names the route", () => {
  const repo = adopted("to", { settings: { extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref: "v2.0.0" }, autoUpdate: true } } } });
  const before = readFileSync(join(repo, "zdd", "config.json"), "utf8");
  const json = runJson(repo, ["upgrade", "--to=v9.0.0", `--remote=${remote()}`]);
  assert.deepEqual(json.wrote, [".claude/settings.json"]);
  assert.deepEqual(settingsOf(repo).extraKnownMarketplaces["zero-drift-docs"], LOCK("v9.0.0")["zero-drift-docs"]);
  assert.equal(readFileSync(join(repo, "zdd", "config.json"), "utf8"), before, "the rest waits for the new release's own upgrade");
  assert.ok(json.notes.some((n) => /restart Claude Code.*say "upgrade ZDD" again/i.test(n)), json.notes.join("\n"));
  assert.match(run(repo, ["upgrade", "--to=v9.0.0", `--remote=${remote()}`]), /^Lock move to v9\.0\.0/, "narration names the target");
});

test("upgrade --to refuses before writing: a tag the remote does not have, one below this plugin or below the repo's lock, a non-tag, an absent or foreign lock (CR-003)", () => {
  const repo = adopted("to-refuse", { settings: { extraKnownMarketplaces: LOCK("v9.1.0") } });
  const bytes = readFileSync(join(repo, ".claude", "settings.json"), "utf8");
  assert.match(fails(repo, ["upgrade", "--to=v9.2.0", `--remote=${remote()}`]), /v9\.2\.0 is not a release tag on/);
  assert.match(fails(repo, ["upgrade", "--to=v1.0.0", `--remote=${remote()}`]), /older than this plugin/);
  assert.match(fails(repo, ["upgrade", "--to=v9.0.0", `--remote=${remote()}`]), /older than this repo's lock \(v9\.1\.0\)/);
  assert.match(fails(repo, ["upgrade", "--to=latest", `--remote=${remote()}`]), /--to must be a release tag/);
  assert.equal(readFileSync(join(repo, ".claude", "settings.json"), "utf8"), bytes);
  assert.match(fails(adopted("to-none", { settings: {} }), ["upgrade", "--to=v9.0.0", `--remote=${remote()}`]), /no lock .*--lock/);
  const fork = adopted("to-fork", { settings: { extraKnownMarketplaces: { "zero-drift-docs": { source: { source: "github", repo: "me/fork", ref: "v2.0.0" } } } } });
  assert.match(fails(fork, ["upgrade", "--to=v9.0.0", "--lock", `--remote=${remote()}`]), /not this plugin's repository/);
});

test("upgrade --to: with --lock an absent lock is written at the target; --plan writes nothing; --to the running release is lock-only too (CR-004, CR-008)", () => {
  const none = adopted("to-lock", { settings: { enabledPlugins: {} } });
  const planned = runJson(none, ["upgrade", "--to=v9.0.0", "--lock", "--plan", `--remote=${remote()}`]);
  assert.deepEqual(planned.wrote, [".claude/settings.json"]);
  assert.equal(settingsOf(none).extraKnownMarketplaces, undefined, "--plan wrote nothing");
  runJson(none, ["upgrade", "--to=v9.0.0", "--lock", `--remote=${remote()}`]);
  assert.deepEqual(settingsOf(none).extraKnownMarketplaces, LOCK("v9.0.0"));
  const same = adopted("to-same", { engine: "2.0.0", settings: { extraKnownMarketplaces: LOCK("v2.0.0") } });
  const config = readFileSync(join(same, "zdd", "config.json"), "utf8");
  const json = runJson(same, ["upgrade", `--to=v${VERSION}`, `--remote=${remote()}`]);
  assert.deepEqual(json.wrote, [".claude/settings.json"], "only the lock");
  assert.equal(readFileSync(join(same, "zdd", "config.json"), "utf8"), config);
});

test("a plain upgrade never moves a repo backwards: a lock or engine pin newer than this plugin stops it before any write (CR-005)", () => {
  const ahead = adopted("ahead-lock", { settings: { extraKnownMarketplaces: LOCK("v9.0.0") } });
  const before = snapshot(ahead);
  assert.match(fails(ahead, ["upgrade"]), /locks v9\.0\.0, newer than this plugin .*update this machine first/);
  assert.deepEqual(snapshot(ahead), before);
  const pinned = adopted("ahead-engine", { engine: "9.0.0" });
  assert.match(fails(pinned, ["upgrade"]), /engine pin 9\.0\.0 is newer than this plugin/);
});

test("a malformed subscribeCalls already in config never crashes an upgrade halfway: notes are computed safely, and the Realtime note is per web extractor (CR-011, CR-009)", () => {
  const repo = adopted("bad-subscribe", { extractors: ["supabase", "nextjs", "react-router"] });
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  cfg.extractorOptions = { nextjs: { refs: { subscribeCalls: { oops: true } } }, "react-router": { subscribeCalls: ["live.onInsert"] } };
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(cfg, null, 2) + "\n");
  const json = runJson(repo, ["upgrade", "--plan"]);
  const realtime = json.notes.filter((n) => /^2\.1 maps realtime/.test(n));
  assert.equal(realtime.length, 1, realtime.join("\n"));
  assert.match(realtime[0], /nextjs\.refs\.subscribeCalls/, "the Next.js app's wrapper is still unnamed; React Router's is named");
});

test("a malformed extraKnownMarketplaces says plainly the repo is NOT locked (CR-012)", () => {
  const repo = adopted("ekm-array", { settings: { extraKnownMarketplaces: [] } });
  const json = runJson(repo, ["upgrade", "--plan"]);
  assert.ok(json.notes.some((n) => /this repo is NOT locked/.test(n)), json.notes.join("\n"));
});

test("two identical duplicate sections get distinct ids, and --drop removes only the one chosen (CR-022)", () => {
  const twice = ["# T", "", "## Loading ZDD", "", 'Say "load ZDD".', "", "## Loading ZDD", "", 'Say "load ZDD".', "", "<!-- zdd:begin -->", "x", "<!-- zdd:end -->", ""].join("\n");
  const repo = adopted("identical", { claude: twice });
  const dups = runJson(repo, ["upgrade", "--plan"]).duplicates;
  assert.equal(dups.length, 2);
  assert.notEqual(dups[0].id, dups[1].id);
  runJson(repo, ["upgrade", `--drop=${dups[1].id}`]);
  const after = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  assert.equal(after.split("## Loading ZDD").length - 1, 1, "exactly one removed");
});

test("adjacent identical copies: whichever copy the id lands on after a shift, the file comes out byte-identical to removing the planned one (CR-024 claim, shown false)", () => {
  const a = ["## Loading ZDD", "", 'Say "load ZDD".', ""];
  const tail = ["<!-- zdd:begin -->", "x", "<!-- zdd:end -->", ""];
  const doc = ["# T", "", ...a, ...a, ...tail];
  const repo = adopted("identical-adjacent", { claude: doc.join("\n") });
  const second = runJson(repo, ["upgrade", "--plan"]).duplicates[1];
  // A third identical copy lands above both; the saved id now names the old first copy's new place.
  const shifted = ["# T", "", ...a, ...a, ...a, ...tail];
  writeFileSync(join(repo, "CLAUDE.md"), shifted.join("\n"));
  runJson(repo, ["upgrade", `--drop=${second.id}`]);
  const intent = ["# T", "", ...a, ...a, ...tail]; // the shifted file with the planned (now third) copy removed
  const out = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  assert.equal(out.slice(0, out.indexOf("<!-- zdd:begin -->")), intent.join("\n").slice(0, intent.join("\n").indexOf("<!-- zdd:begin -->")));
});

test("a planned id is bound to the section's text AND place: when an identical copy inserted above shifts the planned one, the write refuses (CR-023)", () => {
  // A, then an unrelated section, then A again; the plan names the second A.
  const doc = ["# T", "", "## Loading ZDD", "", 'Say "load ZDD".', "", "## Testing", "", "Run the tests.", "", "## Loading ZDD", "", 'Say "load ZDD".', "", "<!-- zdd:begin -->", "x", "<!-- zdd:end -->", ""];
  const repo = adopted("identical-shift", { claude: doc.join("\n") });
  const second = runJson(repo, ["upgrade", "--plan"]).duplicates[1];
  assert.equal(second.from, 11);
  // Another copy of A lands above everything: the planned place now holds a different section.
  writeFileSync(join(repo, "CLAUDE.md"), [...doc.slice(0, 2), "## Loading ZDD", "", 'Say "load ZDD".', "", ...doc.slice(2)].join("\n"));
  assert.match(fails(repo, ["upgrade", `--drop=${second.id}`]), new RegExp(`--drop: no duplicate ${second.id}`));
});

test("Claude Code's folders resolve in order: explicit home, ZDD_HOME, CLAUDE_CONFIG_DIR / CLAUDE_CODE_PLUGIN_CACHE_DIR, then ~/.claude (CR-205)", async () => {
  const { claudeDir, pluginsDir } = await import("../scripts/lib/repo.mjs");
  const keys = ["ZDD_HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_PLUGIN_CACHE_DIR", "HOME", "USERPROFILE"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const set = (vars) => {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, { HOME: join(scratch, "h"), USERPROFILE: join(scratch, "h") }, vars);
  };
  try {
    const all = { ZDD_HOME: join(scratch, "z"), CLAUDE_CONFIG_DIR: join(scratch, "c"), CLAUDE_CODE_PLUGIN_CACHE_DIR: join(scratch, "p") };
    set(all);
    assert.equal(claudeDir(join(scratch, "e")), join(scratch, "e", ".claude"), "explicit home wins");
    assert.equal(pluginsDir(join(scratch, "e")), join(scratch, "e", ".claude", "plugins"));
    assert.equal(claudeDir(), join(scratch, "z", ".claude"), "then ZDD_HOME");
    set({ CLAUDE_CONFIG_DIR: join(scratch, "c"), CLAUDE_CODE_PLUGIN_CACHE_DIR: join(scratch, "p") });
    assert.equal(claudeDir(), resolve(join(scratch, "c")), "then CLAUDE_CONFIG_DIR");
    assert.equal(pluginsDir(), resolve(join(scratch, "p")), "the plugins folder may move on its own");
    set({ CLAUDE_CONFIG_DIR: join(scratch, "c") });
    assert.equal(pluginsDir(), join(resolve(join(scratch, "c")), "plugins"), "else under the profile");
    set({});
    assert.equal(claudeDir(), join(homedir(), ".claude"), "else the home folder's .claude");
    assert.equal(pluginsDir(), join(homedir(), ".claude", "plugins"));
  } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
