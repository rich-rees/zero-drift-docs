// 2.2.0: the guided upgrade at the file seam. `upgrade --plan` shows what
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
import { createHash } from "node:crypto";
import { UPGRADE_NOTES, newestTag, INSTRUCTION_RULES, compareVersions, ruleChangedSince, mergeGate, IMPORT_COMMENT, RETIRED_NAMES, OLD_LINE_TAGS } from "../scripts/bootstrap.mjs";
import { oldLine } from "../scripts/lib/repo.mjs";

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
const adopted = (name, { engine = "2.0.0", release, extractors = ["generic"], claude, settings = { extraKnownMarketplaces: LOCK("v2.0.0") }, fixture } = {}) => {
  const repo = join(scratch, name);
  if (fixture) {
    cpSync(join(ENGINE_FIXTURES, fixture), repo, { recursive: true });
    rmSync(join(repo, "zdd"), { recursive: true });
  }
  mkdirSync(join(repo, "zdd"), { recursive: true });
  mkdirSync(join(repo, ".claude"), { recursive: true });
  // `release` is the new line's pin, `engine` the old line's (decision 0042).
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors, ...(release ? { release } : engine ? { engine } : {}) }, null, 2) + "\n");
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

test("every release from 1.1 on (the README's Versioning list, and the old line's tags) has an upgrade note, and this minor an Upgrading section — a release without one fails here (the checklist, backed)", () => {
  assert.ok(UPGRADE_NOTES[`${MINOR}.0`], `no upgrade note for ${MINOR}: add one to UPGRADE_NOTES in scripts/bootstrap.mjs and an "Upgrading to ${MINOR}" section to skills/upgrade/SKILL.md`);
  // Every release the README's Versioning lists — patches too — has a note (CR-017): the list
  // comes from the README, so a release cannot be added there and forgotten here.
  const readme = readFileSync(join(PLUGIN, "..", "..", "README.md"), "utf8");
  const released = [...readme.matchAll(/^- \*\*`(\d+\.\d+\.\d+)` —/gm)].map((m) => m[1]);
  assert.ok(released.includes(VERSION), released.join(", "));
  for (const v of released) assert.ok(UPGRADE_NOTES[v], `UPGRADE_NOTES has no entry for ${v}`);
  // The README folds the old line into one paragraph, so its releases from 1.1 on come from the
  // tags it carried, each keyed as the old line's (decision 0042).
  const oldReleases = OLD_LINE_TAGS.map((tag) => tag.slice(1)).filter((v) => !v.startsWith("0.") && v !== "1.0.0");
  assert.ok(oldReleases.includes("1.2.0") && oldReleases.includes("1.3.1"), oldReleases.join(", "));
  for (const v of oldReleases) assert.ok(UPGRADE_NOTES[oldLine(v)], `UPGRADE_NOTES has no entry for the old line's ${v}`);
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

test("every upgrade re-runs detection: an opt-in extractor the evidence shows is offered with that evidence, never added — from 2.0.0, and from 2.2.1, which crosses no 2.1 note (2.4.1, from the first adopter)", () => {
  const later = adopted("detect-2-2", { fixture: "fixture-jobs", extractors: ["supabase"], engine: "2.2.1", settings: { extraKnownMarketplaces: LOCK("v2.2.1") } });
  assert.match(runJson(later, ["upgrade", "--plan"]).notes.join("\n"), /^offers the opt-in extractor `background-procfile`.*`Procfile` runs a process/m);
  const repo = adopted("detect-2-1", { fixture: "fixture-jobs", extractors: ["supabase"] });
  const json = runJson(repo, ["upgrade"]);
  const notes = json.notes.join("\n");
  assert.match(notes, /^offers the opt-in extractor `background-procfile`.*`Procfile` runs a process/m, notes);
  assert.match(notes, /^offers the opt-in extractor `background-vercel`.*`apps\/web\/vercel\.json` schedules a cron/m, notes);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).extractors, ["supabase", "supabase-py", "sqlalchemy"], "the opt-ins are never added; the data-access adapters crossing 0.9 are (decision 0037)");
  assert.match(notes, /^2\.1 .*`\*` in a scanned url: it no longer matches a fixed route segment/m, notes);
});

test("every upgrade offers the queue readers detection finds — Inngest, Trigger.dev, SQS — never adding them (decision 0039, CR-110)", () => {
  const repo = adopted("queues", { extractors: ["generic"] });
  mkdirSync(join(repo, "src", "trigger"), { recursive: true });
  mkdirSync(join(repo, "worker"), { recursive: true });
  writeFileSync(join(repo, "src", "inngest.ts"), 'export const f = inngest.createFunction({ id: "send-digest" }, { event: "user/signed-up" }, async () => {});\n');
  writeFileSync(join(repo, "src", "trigger", "sync.ts"), 'export const sync = task({ id: "sync-catalogue", run: async () => {} });\n');
  writeFileSync(join(repo, "worker", "poll.py"), 'resp = sqs.ReceiveMessage(QueueUrl="https://sqs.eu-west-2.amazonaws.com/1/emails")\n');
  const notes = runJson(repo, ["upgrade", "--plan"]).notes.join("\n");
  assert.match(notes, /^offers the opt-in extractor `background-inngest` — evidence: `src\/inngest\.ts` declares an Inngest function: `send-digest`/m, notes);
  assert.match(notes, /^offers the opt-in extractor `background-trigger-dev` — evidence: `src\/trigger\/sync\.ts` declares a Trigger\.dev task: `sync-catalogue`/m, notes);
  assert.match(notes, /^offers the opt-in extractor `background-sqs` — evidence: `worker\/poll\.py` uses an SQS queue: `emails`/m, notes);
  runJson(repo, ["upgrade"]);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).extractors, ["generic"], "never added silently");
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

test("text outside the managed block that speaks to a rule is named per paragraph or bullet with its lines and the rules — never a whole section (2.3.0, finding 4)", () => {
  const repo = adopted("dupes", { claude: CLAUDE_WITH_DUPES });
  const plan = runJson(repo, ["upgrade", "--plan"]);
  assert.deepEqual(
    plan.duplicates.map((d) => [d.file, d.heading, d.from, d.to, d.rules]),
    [
      ["CLAUDE.md", "## Loading ZDD", 7, 7, ["load", "generated"]],
      ["CLAUDE.md", "### Docs", 15, 15, ["update"]],
    ],
  );
  // The id is the section's content hash (CR-014): stable across runs, distinct per section.
  for (const d of plan.duplicates) assert.match(d.id, /^[0-9a-f]{8}$/);
  assert.notEqual(plan.duplicates[0].id, plan.duplicates[1].id);
  assert.deepEqual(runJson(repo, ["upgrade", "--plan"]).duplicates.map((d) => d.id), plan.duplicates.map((d) => d.id));
  const text = run(repo, ["upgrade", "--plan"]);
  assert.ok(text.includes(`your text, CLAUDE.md line 7 under "## Loading ZDD": Say "load ZDD" before work. Never hand-edit zdd/graph.json.`), text);
  assert.ok(text.includes(`ZDD now says: "load ZDD" before designing`), text);
  assert.ok(text.includes(`--drop=${plan.duplicates[0].id}`), text);
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

test("a passing mention is not a duplicate: the document's title, and a section that names ZDD once, are never named (2.2.0 smoke: `# Bookmarks … smoke-test the ZDD plugin`)", async () => {
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
  assert.doesNotMatch(after, /## Loading ZDD/, "the unit was all its section held, so the empty heading went with it");
  assert.doesNotMatch(after, /Say "load ZDD" before work/);
  assert.match(after, /### Docs/, "not dropped: not named");
  assert.match(after, /^@zdd\/instructions\.md$/m, "the block became the import line");
  assert.doesNotMatch(after, /<!-- zdd:begin -->/);
  assert.match(after, /^Intro\.$/m);
  assert.ok(json.notes.some((n) => /CLAUDE\.md: removed line 7 under "## Loading ZDD" \(Say "load ZDD" before work\. Never hand-edit zdd\/graph\.json\.\), and the heading it was all of, on the user's word/.test(n)), json.notes.join("\n"));
  // The run moved the pin past every rule "### Docs" speaks to, so the next
  // upgrade does not ask about it again (2.4.1, finding 3).
  assert.deepEqual(runJson(repo, ["upgrade", "--plan"]).duplicates.map((d) => d.heading), []);
});

test("2.4.1, finding 1 and the first adopter 1: an owned workflow's pre-2.2 header names \"upgrade ZDD\" after the upgrade; a lint step passing --merge under its own condition is kept as written and named", () => {
  const repo = adopted("wf-header", { engine: "2.2.1", settings: { extraKnownMarketplaces: LOCK("v2.2.1") } });
  const OLD = "# Managed by Zero-Drift Docs (zdd): written by `zdd:bootstrap`; `zdd:bootstrap\n# --upgrade` rewrites the engine pin below. Remove this header line to take\n# ownership of the file.";
  const NEW = '# Managed by Zero-Drift Docs (zdd): written by `zdd:bootstrap`; "upgrade ZDD"\n# rewrites the engine pin below. Remove this header line to take ownership\n# of the file.';
  const template = readFileSync(join(PLUGIN, "templates", "zdd.yml"), "utf8");
  assert.ok(template.includes(NEW), "the template already says it");
  const DIO_STEP = `run: npx -y "$ZDD_ENGINE" lint \${{ (github.event_name == 'workflow_dispatch' || !github.event.pull_request.draft) && '--tempstate --merge' || '' }}`;
  const old = template.replace(NEW, OLD).replace('run: npx -y "$ZDD_ENGINE" lint --merge', DIO_STEP).replace(/@rich-rees\/zdd-engine@[0-9.]+/, "@rich-rees/zdd-engine@2.2.1");
  mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
  const wf = join(repo, ".github", "workflows", "zdd.yml");
  writeFileSync(wf, old.replace(/\n/g, "\r\n"));
  const json = runJson(repo, ["upgrade"]);
  const after = readFileSync(wf, "utf8");
  assert.ok(after.includes(NEW.replace(/\n/g, "\r\n")), "the header is today's, CRLF kept");
  assert.ok(after.includes(DIO_STEP + "\r\n"), "the conditional step is untouched");
  assert.doesNotMatch(after, /lint --merge \$\{\{/, "never made unconditional");
  const notes = json.notes.join("\n");
  assert.match(notes, /zdd\.yml: its header comment now names "upgrade ZDD"/, notes);
  assert.match(notes, /zdd\.yml: the lint step passes --merge in a shape of its own \(under a condition\?\) — kept as written; check by hand/, notes);
  assert.doesNotMatch(notes, /now runs `lint --merge`/);
  const again = runJson(repo, ["upgrade"]);
  assert.doesNotMatch(again.notes.join("\n"), /header comment now names/, "once only");
});

test("2.4.1, finding 3: an upgrade lists only the units speaking to a rule changed since the repo's pin — a repo at 2.4.0 is asked about the generated-files rule (2.4.1), not about load or update", () => {
  const repo = adopted("dupes-since", { claude: CLAUDE_WITH_DUPES, engine: "2.4.0", settings: { extraKnownMarketplaces: LOCK("v2.4.0") } });
  const plan = runJson(repo, ["upgrade", "--plan"]);
  assert.deepEqual(plan.duplicates.map((d) => [d.heading, d.rules]), [["## Loading ZDD", ["generated"]]]);
  const text = run(repo, ["upgrade", "--plan"]);
  assert.ok(!text.includes('ZDD now says: "load ZDD"'), "an unchanged rule is not shown again");
  assert.ok(text.includes("ZDD now says: the generated artifacts"), text);
});

test("2.4.1 CR-011, CR-013, CR-014: from 2.4.0, the changed rules catch the adopter's wording in any order — the area folder, conflicts-before-merge, an old `ZDD:` line", () => {
  const claude = [
    "# Project", "", IMPORT_COMMENT, "@zdd/instructions.md", "", "## Ours", "",
    "Edit files under `zdd/agent-index/` when an area changes.", "",
    "For conflicts in generated files, take theirs before finishing the merge.", "",
    "Say `ZDD: ADR-0015 turned — I almost queried the database` whenever an ADR redirects you.", "",
    "Push to main; the ZDD check runs in CI.", "",
  ].join("\n");
  const repo = adopted("dupes-wording", { claude, engine: "2.4.0", settings: { extraKnownMarketplaces: LOCK("v2.4.0") } });
  const plan = runJson(repo, ["upgrade", "--plan"]);
  assert.deepEqual(plan.duplicates.map((d) => [d.from, d.rules]), [[8, ["generated"]], [10, ["merge"]], [12, ["record"]]], JSON.stringify(plan.duplicates));
});

test("2.4.1 CR-012: no engine pin, or one that is not a version, reads the adopter's text against every rule", () => {
  for (const engine of [null, "latest"]) {
    const repo = adopted(`dupes-nopin-${engine}`, { claude: CLAUDE_WITH_DUPES, engine });
    const plan = runJson(repo, ["upgrade", "--plan"]);
    assert.deepEqual(plan.duplicates.map((d) => [d.heading, d.rules]), [["## Loading ZDD", ["load", "generated"]], ["### Docs", ["update"]]], String(engine));
  }
});

test("2.4.1 CR-008: a prerelease or build pin is read by its core; a prerelease comes before its release", () => {
  const rule = { since: "2.4.0" };
  assert.equal(ruleChangedSince(rule, "2.4.0"), false);
  assert.equal(ruleChangedSince(rule, "2.4.0+local"), false, "build metadata is the release");
  assert.equal(ruleChangedSince(rule, "2.4.0-rc.1"), true, "a prerelease is before 2.4.0");
  assert.equal(ruleChangedSince(rule, "2.4.1-rc.1"), false);
  assert.equal(ruleChangedSince(rule, "2.3.9"), true);
  assert.equal(ruleChangedSince(rule, "next"), true, "not a version: read everything");
  assert.equal(ruleChangedSince(rule, null), true);
});

test("2.4.1 CR-007: a YAML comment is never a merge gate — `# lint --merge` above a bare step, or `lint # TODO: add --merge` — the step gains --merge; a quoted --merge in an expression stays the team's", () => {
  const above = mergeGate('# Previous command: lint --merge\n- run: npx -y "$ZDD_ENGINE" lint\n');
  assert.equal(above.how, "added");
  assert.ok(above.text.includes('- run: npx -y "$ZDD_ENGINE" lint --merge\n'), above.text);
  const trailing = mergeGate('- run: npx -y "$ZDD_ENGINE" lint # TODO: add --merge\n');
  assert.equal(trailing.how, "added");
  assert.ok(trailing.text.includes('lint --merge # TODO: add --merge'), trailing.text);
  assert.equal(mergeGate("- run: npx -y \"$ZDD_ENGINE\" lint ${{ github.event.pull_request.draft && '' || '--merge' }}\n").how, "conditional");
  assert.equal(mergeGate('- run: npx -y "$ZDD_ENGINE" lint --merge # gate\n').how, "present");
});

test("2.4.1 CR-020: the opt-in offer is quiet for an extractor already on", () => {
  const repo = adopted("detect-on", { fixture: "fixture-jobs", extractors: ["supabase", "jobs"], engine: "2.2.1", settings: { extraKnownMarketplaces: LOCK("v2.2.1") } });
  assert.doesNotMatch(runJson(repo, ["upgrade", "--plan"]).notes.join("\n"), /offers the opt-in extractor `jobs`/);
});

test("2.4.1, finding 3: each rule's `since` is a release no later than this plugin, and moves with what the rule says — change `says`, then bump `since` and this table together", () => {
  const PINNED = {
    load: oldLine("2.4.0"), patterns: "0.11.0", update: oldLine("2.4.0"), upgrade: oldLine("2.3.0"), skew: oldLine("2.3.0"), generated: oldLine("2.4.1"),
    merge: oldLine("2.4.1"), renumber: oldLine("2.4.1"), install: oldLine("2.3.0"), grill: oldLine("2.3.0"), findings: "0.9.0", record: oldLine("2.4.1"), blessings: oldLine("2.5.0"),
  };
  const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
  const SAYS_SHA = {};
  for (const rule of INSTRUCTION_RULES) {
    assert.match(rule.since ?? "", /^(?:zdd-engine@)?\d+\.\d+\.\d+$/, rule.id);
    assert.ok(compareVersions(rule.since, VERSION) <= 0, `${rule.id}: since ${rule.since} is later than the plugin (${VERSION})`);
    assert.equal(rule.since, PINNED[rule.id], `${rule.id}: since moved — update the table`);
    SAYS_SHA[rule.id] = createHash("sha256").update(rule.says).digest("hex").slice(0, 12);
  }
  assert.deepEqual(Object.keys(SAYS_SHA).sort(), Object.keys(PINNED).sort());
  const SAYS_PINNED = {
    load: "f5ab5c09cab0", patterns: "5a1de9697705", update: "0143764c1f10", upgrade: "1f328adcb3f1", skew: "c0a3cd59c82f", generated: "d342fc5876db",
    merge: "98d4b51c843c", renumber: "d1f96292c08e", install: "df690ac41ed2", grill: "474fe1670736", findings: "c6a5958dbb61", record: "3767c173ae7e", blessings: "5d7a511af2c2",
  };
  assert.deepEqual(SAYS_SHA, SAYS_PINNED, "a rule's `says` changed — bump its `since` to this release, then copy the new hashes here");
});

test("CR-192 (decision 0045 point 8): the 0.11 upgrade explains importance and never asks for it or writes it", () => {
  const note = UPGRADE_NOTES["0.11.0"]({ paths: { bundleDir: "zdd" }, config: {} }).join("\n");
  const skill = readFileSync(join(PLUGIN, "skills", "upgrade", "SKILL.md"), "utf8");
  const section = skill.slice(skill.indexOf("## Upgrading to 0.11"));
  for (const [name, text] of [["UPGRADE_NOTES 0.11.0", note], ["Upgrading to 0.11", section]]) {
    assert.match(text, /importance: high/, `${name} names the field`);
    assert.match(text, /never set by the upgrade|never sets it/, `${name} says the upgrade never sets it`);
    assert.doesNotMatch(text, /\bask (?:the person|them|whether)\b|\badd (?:the|that) line\b|on their yes/i, `${name} solicits or writes importance`);
  }
  assert.match(section, /touch no blessing file/);
  assert.match(section, /Nothing to answer/);
});

test("CR-194: the patterns rule changed in 0.11, so an upgrade from 0.10 shows an adopter's own choose-patterns paragraph, and its `says` carries the high clause", () => {
  const rule = INSTRUCTION_RULES.find((r) => r.id === "patterns");
  assert.equal(ruleChangedSince(rule, "0.10.0"), true);
  assert.equal(ruleChangedSince(rule, "0.11.0"), false);
  assert.match(rule.says, /one marked high is not to be reinvented: follow it, or say in the plan why not/);
});

test("newestTag: the highest release tag by semver, ignoring pre-releases and junk", () => {
  const lines = ["abc\trefs/tags/v2.1.1", "def\trefs/tags/v2.10.0", "123\trefs/tags/v2.9.9", "456\trefs/tags/v3.0.0-rc.1", "789\trefs/tags/nightly", "000\trefs/tags/v2.2.0^{}"];
  assert.equal(newestTag(lines.join("\n")), "v2.10.0");
  assert.equal(newestTag(""), null);
});

test("0.9's retired names — the old package, extractorOptions.jobs, metadata/job/ — are listed in the team's own files, never in ZDD's generated ones, which the regenerate rewrites (slice 6 dry run)", () => {
  const repo = adopted("retired-0-9", { engine: "2.5.0", settings: { extraKnownMarketplaces: LOCK("v2.5.0") } });
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(join(repo, "zdd", "agent-index"), { recursive: true });
  const said = "npx -y @rich-rees/zdd-engine@2.5.0 derive; see extractorOptions.jobs and zdd/metadata/job/nightly.json\n";
  writeFileSync(join(repo, "docs", "setup.md"), said);
  for (const g of ["graph.json", "agent-index.md", "human-index.html", "adr-index.md", "blessing-index.md", "agent-index/area.md"]) writeFileSync(join(repo, "zdd", g), said);
  const retired = runJson(repo, ["upgrade", "--plan"]).notes.filter((n) => / still says /.test(n));
  assert.ok(retired.some((n) => /^docs\/setup\.md:1 still says `@rich-rees\/zdd-engine` — since 0\.9\.0 that is the engine's package from 0\.9, `@rich-rees\/zdd`/.test(n)), retired.join("\n"));
  assert.ok(retired.some((n) => /^docs\/setup\.md:1 still says `extractorOptions\.jobs`/.test(n)), retired.join("\n"));
  assert.deepEqual(retired.filter((n) => /^zdd\//.test(n)), [], "a generated file is rewritten by the regenerate, never the team's to fix");
  // CR-161: a generated path is a file, matched exactly — one configured onto a
  // folder name never hides that folder's files from the sweep.
  const odd = adopted("retired-odd-path", { engine: "2.5.0", settings: { extraKnownMarketplaces: LOCK("v2.5.0") } });
  writeFileSync(join(odd, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], engine: "2.5.0", paths: { graph: "docs" } }));
  mkdirSync(join(odd, "docs"), { recursive: true });
  writeFileSync(join(odd, "docs", "setup.md"), said);
  const hits = runJson(odd, ["upgrade", "--plan"]).notes.filter((n) => / still says /.test(n));
  assert.ok(hits.some((n) => /^docs\/setup\.md:1 still says `@rich-rees\/zdd-engine`/.test(n)), hits.join("\n"));
});

test("decision 0042: the old line's tags are behind every new-line release — newestTag skips them, compareVersions puts them first, and a 1.x plugin must have dropped the list (the numbers collide from 1.0.0)", () => {
  assert.equal(newestTag(["a\trefs/tags/v2.5.0", "b\trefs/tags/v0.9.0", "c\trefs/tags/v2.4.1"].join("\n")), "v0.9.0");
  assert.equal(newestTag("a\trefs/tags/v2.5.0"), null, "only the old line's tags: no release of this line yet");
  assert.ok(compareVersions(oldLine("2.5.0"), "0.9.0") < 0);
  assert.ok(compareVersions(oldLine("9.9.9"), "0.0.1") < 0);
  assert.ok(compareVersions(oldLine("2.4.1"), oldLine("2.5.0")) < 0);
  assert.equal(compareVersions("v0.9.1", "0.9.1"), 0);
  assert.ok(OLD_LINE_TAGS.includes("v2.5.0") && OLD_LINE_TAGS.includes("v1.0.0"));
  // CR-166: exactly the old repository's 18 tags.
  assert.deepEqual(OLD_LINE_TAGS, ["v0.1.0", "v0.2.0", "v0.3.0", "v0.3.1", "v1.0.0", "v1.1.0", "v1.2.0", "v1.3.0", "v1.3.1", "v2.0.0", "v2.1.0", "v2.1.1", "v2.2.0", "v2.2.1", "v2.3.0", "v2.4.0", "v2.4.1", "v2.5.0"]);
  if (Number(VERSION.split(".")[0]) >= 1) assert.deepEqual(OLD_LINE_TAGS.filter((t) => compareVersions(t, "1.0.0") >= 0), [], "a new-line 1.x tag would read as the old line's — retire OLD_LINE_TAGS (decision 0042)");
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
  // 2.3.0, C3/C4: the catalogue (none in this home) and whether the lock trails the running release.
  assert.deepEqual(s, { lock: "v2.1.1", running: VERSION, newest: "v9.0.0", catalogue: null, newer: true, lockBehind: true, ready: false });
  const text = run(repo, ["release-status", `--remote=${remote}`]);
  assert.match(text, /ZDD v9\.0\.0 is out; this repo locks v2\.1\.1 and this session runs \d+\.\d+\.\d+; the catalogue on this machine is at no recorded ref/, text);
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
  assert.match(fails(repo, ["upgrade", "--to=v0.8.0", `--remote=${remote()}`]), /older than this plugin/);
  assert.match(fails(repo, ["upgrade", "--to=v2.5.0", `--remote=${remote()}`]), /v2\.5\.0 is a release of the old line \(@rich-rees\/zdd-engine\), before every 0\.9 release/, "decision 0042");
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
  const pinned = adopted("ahead-release", { release: "9.0.0" });
  assert.match(fails(pinned, ["upgrade"]), /release pin 9\.0\.0 is newer than this plugin/);
  // The old line is behind every new-line release, whatever its number
  // (decision 0042): a 2.5.0 lock and a 9.0.0 engine pin both upgrade.
  const old = adopted("old-line", { engine: "9.0.0", settings: { extraKnownMarketplaces: LOCK("v2.5.0") } });
  const plan = runJson(old, ["upgrade", "--plan"]);
  assert.ok(plan.notes.some((n) => n === `zdd/config.json: engine pin 9.0.0 → release ${VERSION} (the engine is @rich-rees/zdd from 0.9, a new line numbered from 0.9.0 — decision 0042)`), plan.notes.join("\n"));
  // CR-149: a `release` that is not a version is refused before any write —
  // it may be a newer release spelt oddly — and a newer prerelease is newer.
  for (const [name, release, says] of [
    ["rc-ahead", "9.9.9-rc.1", /release pin 9\.9\.9-rc\.1 is newer than this plugin/],
    ["v-ahead", "v9.9.9", /release pin is not a version/],
    ["short", "0.9", /release pin is not a version/],
    ["prefixed", "zdd-engine@9.9.9", /release pin is not a version/],
    ["number", 9, /release pin is not a version/],
  ]) {
    const repo = adopted(`pin-${name}`, { release: "0.0.1" });
    writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], release }));
    const bytes = snapshot(repo);
    assert.match(fails(repo, ["upgrade"]), says, name);
    assert.deepEqual(snapshot(repo), bytes, `${name}: nothing written`);
  }
});

test("CR-151: an old-line engine pin beside release — a teammate's pre-0.9 plugin wrote it — is dropped and named, never a dead end; the stale lock moves back too", () => {
  const repo = adopted("stale-engine", { settings: { extraKnownMarketplaces: LOCK("v2.5.0") } });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ name: "x", release: VERSION, extractors: ["generic"], engine: "2.5.0" }, null, 2) + "\n");
  const json = runJson(repo, ["upgrade"]);
  assert.ok(json.notes.some((n) => n === `zdd/config.json: engine pin 2.5.0 dropped: a plugin from before 0.9 wrote it beside "release" (decision 0042) — keep every teammate's plugin on this release`), json.notes.join("\n"));
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(Object.keys(cfg).filter((k) => k === "engine" || k === "release"), ["release"]);
  assert.equal(cfg.release, VERSION);
  assert.equal(settingsOf(repo).extraKnownMarketplaces["zero-drift-docs"].source.ref, `v${VERSION}`);
  assert.ok(!runJson(repo, ["upgrade", "--plan"]).wrote.includes("zdd/config.json"), "a second upgrade changes nothing");
});

test("CR-165: the old line's engine pin becomes release where it sat — the config's key order is kept", () => {
  const repo = adopted("key-order");
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ name: "x", repoBase: "", engine: "2.5.0", extractors: ["generic"], hooks: { autoLoad: true } }, null, 2) + "\n");
  runJson(repo, ["upgrade"]);
  const keys = Object.keys(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")));
  assert.deepEqual(keys.slice(0, 5), ["name", "repoBase", "release", "extractors", "hooks"]);
});

test("a malformed subscribeCalls already in config never stops an upgrade: the good list moves to supabase-js, the bad one stays where it is and is named (CR-011, CR-009; decision 0037)", () => {
  const repo = adopted("bad-subscribe", { extractors: ["supabase", "nextjs", "react-router"] });
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  cfg.extractorOptions = { nextjs: { refs: { subscribeCalls: { oops: true } } }, "react-router": { subscribeCalls: ["live.onInsert"] } };
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(cfg, null, 2) + "\n");
  const json = runJson(repo, ["upgrade"]);
  const after = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(after.extractorOptions["supabase-js"], { subscribeCalls: ["live.onInsert"] });
  assert.equal(after.extractorOptions["react-router"].subscribeCalls, undefined);
  assert.deepEqual(after.extractorOptions.nextjs.refs.subscribeCalls, { oops: true }, "left where it was");
  assert.ok(after.extractors.includes("supabase-js"));
  assert.ok(json.notes.some((n) => /^zdd\/config\.json: extractorOptions\.nextjs\.refs\.subscribeCalls was not moved — it is not a list of call names/.test(n)), json.notes.join("\n"));
  assert.ok(json.notes.some((n) => /extractorOptions\.react-router\.subscribeCalls → extractorOptions\["supabase-js"\]\.subscribeCalls/.test(n)), json.notes.join("\n"));
  assert.ok(!json.notes.some((n) => /^2\.1 maps realtime/.test(n)), "a name is recorded, so 2.1's question is answered");
});

test("0.9 moves subscribeCalls from both old places into supabase-js, each name once in first-seen order; 2.1's question then names the one place (decision 0037)", () => {
  const repo = adopted("move-subscribe", { extractors: ["supabase", "nextjs", "react-router"] });
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  cfg.extractorOptions = { nextjs: { refs: { subscribeCalls: ["live.on", "rt.sub"] } }, "react-router": { subscribeCalls: ["rt.sub", "live.onInsert"] }, "supabase-js": { subscribeCalls: ["mine"] } };
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(cfg, null, 2) + "\n");
  runJson(repo, ["upgrade"]);
  const after = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(after.extractorOptions["supabase-js"].subscribeCalls, ["mine", "rt.sub", "live.onInsert", "live.on"]);
  assert.equal(after.extractorOptions.nextjs.refs, undefined, "an emptied refs block goes");
  assert.equal(after.extractors.filter((n) => n === "supabase-js").length, 1);
  const again = runJson(repo, ["upgrade", "--plan"]);
  assert.ok(!again.wrote.includes("zdd/config.json"), "a second upgrade changes nothing");
  const none = adopted("none-subscribe", { extractors: ["supabase", "nextjs"] });
  const notes = runJson(none, ["upgrade", "--plan"]).notes.join("\n");
  assert.match(notes, /^2\.1 maps realtime .*ask whether the nextjs app has one, and record it in extractorOptions\["supabase-js"\]\.subscribeCalls \(there since 0\.9\)/m, notes);
});

test("CR-150: a prerelease sorts before its release — an upgrade from 0.9.0-rc.1 still crosses 0.9.0: the 0.9 note and the data-access step", () => {
  assert.ok(compareVersions("0.9.0-rc.1", "0.9.0") < 0);
  assert.ok(compareVersions("0.9.0", "0.9.0-rc.1") > 0);
  assert.ok(compareVersions("1.0.0-alpha", "1.0.0-alpha.1") < 0);
  assert.ok(compareVersions("1.0.0-beta.2", "1.0.0-beta.11") < 0);
  assert.ok(compareVersions("1.0.0-alpha.beta", "1.0.0-beta") < 0);
  assert.equal(compareVersions("0.9.1+build.5", "v0.9.1"), 0);
  // Verify pass 1: digits compare as digits, never as rounded JS numbers.
  assert.ok(compareVersions("0.9.0-rc.9007199254740992", "0.9.0-rc.9007199254740993") < 0);
  assert.ok(compareVersions("9007199254740993.0.0", "9007199254740992.0.0") > 0);
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  const repo = adopted("from-rc", { release: "0.9.0-rc.1", extractors: ["supabase", "nextjs"], settings: { extraKnownMarketplaces: LOCK(`v${VERSION}`) } });
  mkdirSync(join(repo, "supabase", "migrations"), { recursive: true });
  writeFileSync(join(repo, "supabase", "migrations", "0001_init.sql"), "create table public.things (id int);\n");
  mkdirSync(join(repo, "src", "app", "things"), { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0", "@supabase/supabase-js": "2.0.0" } }));
  writeFileSync(join(repo, "src", "app", "things", "page.tsx"), 'export default async function Page() { await supabase.from("things").select(); return null; }\n');
  const notes = runJson(repo, ["upgrade", "--plan"]).notes.join("\n");
  assert.match(notes, /extractor "supabase-js" added/, notes);
  assert.match(notes, /^0\.9 starts a new line/m, notes);
});

test("CR-156: detection that cannot run never stops the 0.9 upgrade — the pin still moves, nothing is added, and the hand route is named", () => {
  const repo = adopted("no-detect", { extractors: ["supabase", "nextjs"], engine: "2.5.0", settings: { extraKnownMarketplaces: LOCK("v2.5.0") } });
  const r = spawnSync(process.execPath, [SCRIPT, "upgrade", "--json", `--root=${repo}`, `--home=${home}`], { encoding: "utf8", env: { ...process.env, ZDD_ENGINE_BIN: join(repo, "missing.mjs") } });
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.ok(json.notes.some((n) => /^could not re-run detection here \(.*ZDD_ENGINE_BIN.*\) — the data-access adapters 0\.9 reads tables through \(decision 0037\) were not added; run `bootstrap\.mjs detect`/.test(n)), json.notes.join("\n"));
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(cfg.extractors, ["supabase", "nextjs"]);
  assert.equal(cfg.release, VERSION);
});

test("CR-155: a subscribeCalls name must be a call name (dotted identifiers) to move — a control character or a space keeps the list where it is, named", () => {
  const repo = adopted("ctl-subscribe", { extractors: ["supabase", "react-router"] });
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  cfg.extractorOptions = { "react-router": { subscribeCalls: ["\u001b[2JFORGED\nline", "live.onInsert"] } };
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(cfg, null, 2) + "\n");
  const json = runJson(repo, ["upgrade"]);
  const after = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(after.extractorOptions["react-router"].subscribeCalls, ["\u001b[2JFORGED\nline", "live.onInsert"], "left where it was");
  assert.equal(after.extractorOptions["supabase-js"], undefined);
  assert.ok(json.notes.some((n) => /^zdd\/config\.json: extractorOptions\.react-router\.subscribeCalls was not moved — it is not a list of call names/.test(n)), json.notes.join("\n"));
  const sj = adopted("ctl-into", { extractors: ["supabase", "react-router"] });
  writeFileSync(join(sj, "zdd", "config.json"), JSON.stringify({ extractors: ["supabase", "react-router"], engine: "2.0.0", extractorOptions: { "react-router": { subscribeCalls: ["ok.name"] }, "supabase-js": { subscribeCalls: ["bad name"] } } }, null, 2) + "\n");
  const j2 = runJson(sj, ["upgrade"]);
  assert.ok(j2.notes.some((n) => /react-router\.subscribeCalls was not moved — extractorOptions\["supabase-js"\]\.subscribeCalls is not a list of call names to add to/.test(n)), j2.notes.join("\n"));
});

test("0.9 adds the data-access adapters detection proposes, with its evidence, to a config from before 0.9 — and only where their companions run, and never from 0.9 on (decision 0037; Rich's call, slice 6)", () => {
  const app = (name, cfg) => {
    const repo = adopted(name, cfg);
    mkdirSync(join(repo, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(repo, "supabase", "migrations", "0001_init.sql"), "create table public.things (id int);\n");
    mkdirSync(join(repo, "src", "app", "things"), { recursive: true });
    writeFileSync(join(repo, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0", "@supabase/supabase-js": "2.0.0" } }));
    writeFileSync(join(repo, "src", "app", "things", "page.tsx"), 'export default async function Page() { await supabase.from("things").select(); return null; }\n');
    return repo;
  };
  const repo = app("da-add", { extractors: ["supabase", "nextjs"], engine: "2.5.0", settings: { extraKnownMarketplaces: LOCK("v2.5.0") } });
  const plan = runJson(repo, ["upgrade", "--plan"]);
  assert.ok(plan.notes.some((n) => /^zdd\/config\.json: extractor "supabase-js" added \(0\.9\.0, decision 0037: the database access the route and screen adapters stopped reading\) — detection: Supabase beside JS code \(nextjs/.test(n)), plan.notes.join("\n"));
  runJson(repo, ["upgrade"]);
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(cfg.extractors, ["supabase", "nextjs", "supabase-js"]);
  assert.equal(cfg.release, VERSION);
  assert.equal(cfg.engine, undefined);
  // A team that left the schema adapter out gets no reader of client calls to join to it.
  const noSchema = app("da-noschema", { extractors: ["nextjs"], engine: "2.5.0" });
  runJson(noSchema, ["upgrade"]);
  assert.deepEqual(JSON.parse(readFileSync(join(noSchema, "zdd", "config.json"), "utf8")).extractors, ["nextjs"]);
  // From 0.9 on, removing one is the team's choice: no later upgrade adds it back.
  const onNew = app("da-new", { extractors: ["supabase", "nextjs"], release: VERSION, settings: { extraKnownMarketplaces: LOCK(`v${VERSION}`) } });
  const kept = runJson(onNew, ["upgrade", "--plan"]);
  assert.ok(!kept.notes.some((n) => /extractor "supabase-js" added/.test(n)), kept.notes.join("\n"));
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
  // The block became the import line in the same run; compare what precedes either.
  assert.equal(out.slice(0, out.indexOf("<!-- Zero-Drift Docs:")), intent.join("\n").slice(0, intent.join("\n").indexOf("<!-- zdd:begin -->")));
});

test("a planned id is bound to the section's text AND place: when an identical copy inserted above shifts the planned one, the write refuses (CR-023)", () => {
  // A, then an unrelated section, then A again; the plan names the second A.
  const doc = ["# T", "", "## Loading ZDD", "", 'Say "load ZDD".', "", "## Testing", "", "Run the tests.", "", "## Loading ZDD", "", 'Say "load ZDD".', "", "<!-- zdd:begin -->", "x", "<!-- zdd:end -->", ""];
  const repo = adopted("identical-shift", { claude: doc.join("\n") });
  const second = runJson(repo, ["upgrade", "--plan"]).duplicates[1];
  assert.equal(second.from, 13, "the unit is the sentence under the second heading");
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

test("the retired-name scan never reads the new name as the old one — `external-service:<id>` is not `service:<id>`; no retired pattern matches after a hyphen", () => {
  const svc = RETIRED_NAMES.find((r) => r.now.includes("external-service:<id>"));
  const hits = (text) => [...text.matchAll(new RegExp(svc.find.source, svc.find.flags))].map((m) => m[0]);
  assert.deepEqual(hits('"recordId": "external-service:gemini-live"'), [], "the 2.3 name itself");
  assert.deepEqual(hits('"recordId": "service:gemini-live"'), ["service:gemini-live"], "the retired name is still found");
  assert.deepEqual(hits("ids: service:a, my-service:b"), ["service:a"]);
  for (const r of RETIRED_NAMES) {
    const re = new RegExp(r.find.source, r.find.flags);
    const sample = r.find.source.includes("service:") ? "external-service:x" : null;
    if (sample) assert.equal(re.test(sample), false, `${r.find} matches inside ${sample}`);
  }
});

// ---- ZDD-3 slice 3: `jobs` → the background-* readers (decision 0038; CR-081, CR-084, CR-085, CR-092) ----
const withConfig = (repo, config) => writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(config, null, 2) + "\n");
const upgradeFails = (repo) => {
  try {
    run(repo, ["upgrade"]);
  } catch (e) {
    return String(e.stderr);
  }
  assert.fail("expected the upgrade to stop");
};

test("upgrade: every old jobs option lands on the reader that owns it; job ids, strict kinds and every map-link form move to background-task; a second upgrade changes nothing", () => {
  const repo = adopted("jobs-matrix", { fixture: "fixture-jobs", engine: "2.5.0", settings: { extraKnownMarketplaces: LOCK("v2.5.0") } });
  withConfig(repo, {
    extractors: ["supabase", "jobs"],
    engine: "2.5.0",
    extractorOptions: {
      supabase: { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] },
      jobs: { roots: ["."], exclude: ["release"], modes: { worker: "worker", nightly: "scheduled" }, includeGithubActions: true, entries: [{ name: "sweeper", module: "app.housekeeping", cwd: "apps/api" }] },
    },
    claims: { strict: true, strictKinds: ["job"], allowUnclaimed: ["job:nightly", "route:/health"] },
  });
  mkdirSync(join(repo, "zdd", "map", "features"), { recursive: true });
  writeFileSync(join(repo, "zdd", "map", "features", "bg.md"), "---\ntype: Feature\ntitle: Bg\n---\n\n- [Worker](../../metadata/job/worker.json)\n- [Angled](<../../metadata/job/nightly.json>)\n- [Frag](../../metadata/job/edge.json#facts)\n- [Bundle](/metadata/job/sweep-stalled.json)\n\n```\n[example](../../metadata/job/worker.json)\n```\n");
  const json = runJson(repo, ["upgrade"]);
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(cfg.extractors, ["supabase", "background-bullmq", "background-cloudflare", "background-compose", "background-declared", "background-github-actions", "background-pg-cron", "background-procfile", "background-railway", "background-vercel", "supabase-py", "sqlalchemy"]);
  const o = cfg.extractorOptions;
  assert.equal(o.jobs, undefined);
  assert.deepEqual(o["background-procfile"], { roots: ["."], exclude: ["release"], modes: { worker: "worker", nightly: "scheduled" } }, "a process reader takes roots, exclude and modes");
  assert.deepEqual(o["background-railway"], o["background-procfile"]);
  assert.deepEqual(o["background-compose"], o["background-procfile"]);
  assert.deepEqual(o["background-vercel"], { roots: ["."] }, "a schedule reader walks roots too, and nothing else");
  assert.deepEqual(o["background-github-actions"], { roots: ["."] }, "includeGithubActions became the listing");
  assert.deepEqual(o["background-declared"], { roots: ["."], entries: [{ name: "sweeper", module: "app.housekeeping", cwd: "apps/api" }], modes: { worker: "worker", nightly: "scheduled" } }, "entries, and the modes an entry may rely on (CR-081)");
  assert.deepEqual(cfg.claims.strictKinds, ["background-task"]);
  assert.deepEqual(cfg.claims.allowUnclaimed, ["background-task:nightly", "route:/health"]);
  const page = readFileSync(join(repo, "zdd", "map", "features", "bg.md"), "utf8");
  for (const form of ["(../../metadata/background-task/worker.json)", "(<../../metadata/background-task/nightly.json>)", "(../../metadata/background-task/edge.json#facts)", "(/metadata/background-task/sweep-stalled.json)"]) assert.ok(page.includes(form), `${form}\n${page}`);
  assert.ok(page.includes("```\n[example](../../metadata/job/worker.json)\n```"), "a fenced example is left as written");
  assert.ok(json.notes.some((n) => /extractor "jobs" → .*"background-procfile"/.test(n)), json.notes.join("\n"));
  const before = readFileSync(join(repo, "zdd", "config.json"), "utf8");
  runJson(repo, ["upgrade"]);
  assert.equal(readFileSync(join(repo, "zdd", "config.json"), "utf8"), before, "idempotent");
});

test("upgrade: a half-migrated config keeps a reader's options that agree with the old jobs ones, and stops before writing when they disagree (CR-085)", () => {
  const agree = adopted("jobs-half-agree", { fixture: "fixture-jobs", engine: "2.5.0", settings: { extraKnownMarketplaces: LOCK("v2.5.0") } });
  withConfig(agree, { extractors: ["jobs", "background-procfile"], engine: "2.5.0", extractorOptions: { jobs: { modes: { worker: "worker" } }, "background-procfile": { modes: { worker: "worker" }, roots: ["apps"] } } });
  runJson(agree, ["upgrade"]);
  const cfg = JSON.parse(readFileSync(join(agree, "zdd", "config.json"), "utf8"));
  assert.deepEqual(cfg.extractorOptions["background-procfile"], { modes: { worker: "worker" }, roots: ["apps"] }, "kept as it was");
  assert.equal(cfg.extractorOptions.jobs, undefined);
  const differ = adopted("jobs-half-differ", { fixture: "fixture-jobs", engine: "2.5.0", settings: { extraKnownMarketplaces: LOCK("v2.5.0") } });
  const config = { extractors: ["jobs", "background-procfile"], engine: "2.5.0", extractorOptions: { jobs: { roots: ["apps"], exclude: ["release"] }, "background-procfile": {} } };
  withConfig(differ, config);
  const text = readFileSync(join(differ, "zdd", "config.json"), "utf8");
  assert.match(upgradeFails(differ), /has both extractorOptions\.jobs and extractorOptions\["background-procfile"\], and they disagree on roots, exclude — merge them by hand/);
  assert.equal(readFileSync(join(differ, "zdd", "config.json"), "utf8"), text, "nothing written");
});

test("upgrade: jobs listed where detection finds no background work stops before writing, rather than leave no reader in its place (CR-084)", () => {
  const repo = adopted("jobs-none", { engine: "2.5.0", settings: { extraKnownMarketplaces: LOCK("v2.5.0") } });
  withConfig(repo, { extractors: ["jobs"], engine: "2.5.0", extractorOptions: { jobs: { modes: { worker: "worker" } } } });
  const text = readFileSync(join(repo, "zdd", "config.json"), "utf8");
  assert.match(upgradeFails(repo), /lists "jobs", which 0\.9 splits into one background-\* reader per platform file .* detection finds no background work .* nothing was written\. Replace "jobs" in "extractors" by hand/);
  assert.equal(readFileSync(join(repo, "zdd", "config.json"), "utf8"), text);
});
