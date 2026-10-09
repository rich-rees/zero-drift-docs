// CAS-103 (C10, decisions 3 and 4 of its design session): ZDD's instructions
// live in a file of their own. Bootstrap writes `zdd/instructions.md` (ZDD's,
// rewritten on every upgrade, fenced) and ONE line in CLAUDE.md — Claude
// Code's `@zdd/instructions.md` import, which inlines the file at session
// start — so everything else in CLAUDE.md is the adopter's by definition and
// an upgrade never edits it again. Codex has no import directive (its
// AGENTS.md loader concatenates plain Markdown), so AGENTS.md keeps a managed
// copy between the markers. An upgrade migrates a marked block to the line
// once. The finder reads the adopter's text per paragraph or bullet against
// the rules the instructions state (finding 4, C8), and `--drop` removes a
// unit, never a section; retired names in the adopter's own text are listed
// with their replacement (7, C9). Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { instructionsBody, instructionsFileText, importLine, IMPORT_COMMENT, INSTRUCTION_RULES, findRuleUnits, upsertImport } from "../scripts/bootstrap.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const FENCE = join(PLUGIN, "scripts", "fence.mjs");
const LOCK = (ref) => ({ "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref }, autoUpdate: false } });
const BEGIN = "<!-- zdd:begin -->";
const END = "<!-- zdd:end -->";

let scratch, home;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-instr-"));
  home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const run = (root, args) => execFileSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${home}`, "--date=2026-10-09"], { encoding: "utf8" });
const runJson = (root, args) => JSON.parse(run(root, [...args, "--json"]));
const fails = (root, args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${home}`], { encoding: "utf8" });
  assert.equal(r.status, 1, `expected failure: ${r.stdout}`);
  return r.stderr;
};
const answers = (name, a) => {
  const p = join(scratch, `${name}.json`);
  writeFileSync(p, JSON.stringify(a));
  return p;
};
const fresh = (name) => {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const adopted = (name, { engine = "2.2.1", claude, agents, config = {} } = {}) => {
  const repo = fresh(name);
  mkdirSync(join(repo, "zdd"), { recursive: true });
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], engine, ...config }, null, 2) + "\n");
  writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ extraKnownMarketplaces: LOCK("v2.2.1") }, null, 2) + "\n");
  if (claude !== undefined) writeFileSync(join(repo, "CLAUDE.md"), claude);
  if (agents !== undefined) writeFileSync(join(repo, "AGENTS.md"), agents);
  return repo;
};
const read = (repo, rel) => readFileSync(join(repo, rel), "utf8");
const LINE = importLine("zdd");

test("fresh apply: zdd/instructions.md is written with the ownership header; CLAUDE.md gets the comment and the one import line, no markers; AGENTS.md (Codex) gets the block with the same body", () => {
  const repo = fresh("fresh");
  writeFileSync(join(repo, "CLAUDE.md"), "# My repo\n\nHouse rules.\n");
  const json = runJson(repo, ["apply", `--answers=${answers("a1", { extractors: ["generic"], codex: true })}`]);
  assert.ok(json.wrote.includes("zdd/instructions.md"), json.wrote.join("\n"));
  const instr = read(repo, "zdd/instructions.md");
  assert.equal(instr, instructionsFileText());
  assert.match(instr.split("\n")[0], /^<!-- Managed by Zero-Drift Docs \(zdd\): "upgrade ZDD" rewrites this whole file/);
  assert.ok(instr.includes(instructionsBody()));
  const claude = read(repo, "CLAUDE.md");
  assert.equal(claude, `# My repo\n\nHouse rules.\n\n${IMPORT_COMMENT}\n${LINE}\n`);
  assert.ok(!claude.includes(BEGIN), "no markers in CLAUDE.md");
  assert.ok(json.notes.some((n) => /CLAUDE\.md: appended — one line, `@zdd\/instructions\.md`, loads ZDD's instructions/.test(n)), json.notes.join("\n"));
  const agents = read(repo, "AGENTS.md");
  assert.ok(agents.startsWith(`${BEGIN}\n<!-- Managed by Zero-Drift Docs (zdd): "upgrade ZDD" rewrites everything between the zdd:begin and zdd:end markers. Codex has no file import, so this is a copy of zdd/instructions.md. -->\n`), agents.slice(0, 200));
  assert.ok(agents.includes(instructionsBody().trimEnd()) && agents.trimEnd().endsWith(END));
  assert.doesNotMatch(agents, /zdd:bootstrap --upgrade/, "C9: the old command name is gone from ZDD's own header");
  // Idempotent.
  const again = runJson(repo, ["apply", `--answers=${answers("a2", { codex: true })}`]);
  assert.ok(again.kept.includes("zdd/instructions.md") && again.kept.includes("CLAUDE.md (loads zdd/instructions.md)"), again.kept.join("\n"));
  assert.equal(read(repo, "CLAUDE.md"), claude);
});

test("the instructions carry the rules the findings asked for (13, C11, C12, C13, C14, decision 7) and name every skill", () => {
  const body = instructionsBody();
  assert.match(body, /claude plugin install mattpocock-skills@zero-drift-docs --scope project.*then.*claude plugin install zdd@zero-drift-docs --scope project/s, "13: both commands, Pocock first");
  assert.match(body, /branch is behind main[\s\S]*merge main/, "C11: the skew cases");
  assert.match(body, /git checkout --theirs -- <file>[\s\S]*git add <file>[\s\S]*rebase/, "C12: the merge steps and rebase");
  assert.match(body, /check for existing code to reuse/, "C13: reuse first");
  assert.match(body, /mint the blessings that survived, record the rest in the commit\s+message, delete the plan/, "C13: reconcile, spelled out");
  assert.match(body, /built on Matt\s+Pocock's skills/, "C14: why");
  assert.match(body, /https:\/\/github\.com\/rich-rees\/zero-drift-docs#readme/, "C14: the README's URL");
  assert.match(body, /https:\/\/github\.com\/rich-rees\/zero-drift-docs\/issues/, "decision 7: the findings home");
  assert.doesNotMatch(body, /zdd:bootstrap --upgrade|bootstrap --upgrade/);
  for (const rule of INSTRUCTION_RULES) assert.ok(rule.match.test(body), `rule ${rule.id} does not match the instructions themselves`);
});

test("upgrade migrates a marked block in CLAUDE.md to the import line once, keeps everything else, rewrites the instructions file; AGENTS.md keeps its block; a second upgrade changes nothing", () => {
  const claude = `# Repo\n\nIntro.\n\n${BEGIN}\n<!-- old header -->\n## Documentation — Zero-Drift Docs (ZDD)\n\nold block text\n${END}\n\n## After\n\nkeep\n`;
  const agents = `${BEGIN}\nold\n${END}\n`;
  const repo = adopted("migrate", { claude, agents });
  const plan = runJson(repo, ["upgrade", "--plan"]);
  assert.ok(plan.wrote.includes("zdd/instructions.md") && plan.wrote.includes("CLAUDE.md") && plan.wrote.includes("AGENTS.md"), plan.wrote.join("\n"));
  assert.equal(read(repo, "CLAUDE.md"), claude, "a plan writes nothing");
  const json = runJson(repo, ["upgrade"]);
  assert.equal(read(repo, "CLAUDE.md"), `# Repo\n\nIntro.\n\n${IMPORT_COMMENT}\n${LINE}\n\n## After\n\nkeep\n`);
  assert.ok(json.notes.some((n) => /CLAUDE\.md: replaced the ZDD block with the import line/.test(n)), json.notes.join("\n"));
  assert.equal(read(repo, "zdd/instructions.md"), instructionsFileText());
  const a = read(repo, "AGENTS.md");
  assert.ok(a.startsWith(BEGIN) && a.includes(instructionsBody().trimEnd()) && a.trimEnd().endsWith(END), "AGENTS.md keeps a managed copy");
  const again = runJson(repo, ["upgrade"]);
  assert.ok(!again.wrote.includes("CLAUDE.md") && !again.wrote.includes("zdd/instructions.md"), again.wrote.join("\n"));
  assert.ok(again.kept.includes("CLAUDE.md (loads zdd/instructions.md)"));
});

test("upgrade: a CLAUDE.md with neither a block nor the line is left alone and named; CRLF files keep CRLF; a custom bundleDir moves the file and the line", () => {
  const repo = adopted("noline", { claude: "# Repo\r\n\r\nNo ZDD text here.\r\n" });
  const json = runJson(repo, ["upgrade"]);
  assert.equal(read(repo, "CLAUDE.md"), "# Repo\r\n\r\nNo ZDD text here.\r\n", "never edited after install");
  assert.ok(json.notes.some((n) => /CLAUDE\.md does not load zdd\/instructions\.md — add the line `@zdd\/instructions\.md` by hand, or run a repair apply/.test(n)), json.notes.join("\n"));
  const repaired = runJson(repo, ["apply", `--answers=${answers("r1", {})}`]);
  assert.ok(repaired.wrote.includes("CLAUDE.md"));
  assert.equal(read(repo, "CLAUDE.md"), `# Repo\r\n\r\nNo ZDD text here.\r\n\r\n${IMPORT_COMMENT}\r\n${LINE}\r\n`, "CRLF kept");

  const custom = adopted("custom-bundle", { claude: `${BEGIN}\nx\n${END}\n`, config: { paths: { bundleDir: "docs/zdd", glossary: "docs/zdd/glossary.md", adrDir: "docs/zdd/adr", mapDir: "docs/zdd/map", metadataDir: "docs/zdd/metadata", agentIndex: "docs/zdd/agent-index.md", adrIndex: "docs/zdd/adr-index.md", blessingIndex: "docs/zdd/blessing-index.md", patternsPlan: "docs/zdd/patterns-plan.md", humanIndex: "docs/zdd/human-index.html", graph: "docs/zdd/graph.json" } } });
  const j2 = runJson(custom, ["upgrade"]);
  assert.ok(j2.wrote.includes("docs/zdd/instructions.md"), j2.wrote.join("\n"));
  assert.equal(read(custom, "CLAUDE.md"), `${IMPORT_COMMENT}\n@docs/zdd/instructions.md\n`);
});

test("upsertImport: present (any line ending), legacy v0.3.1 snippet replaced, malformed markers refused", () => {
  assert.equal(upsertImport(`# X\r\n\r\n${LINE}\r\n`, LINE).changed, false);
  const legacy = readFileSync(join(PLUGIN, "test", "fixtures", "v0.3.1", "claude-md-snippet.md"), "utf8") + "\n";
  const r = upsertImport("# Repo\n\n" + legacy + "## After\n\nkeep\n", LINE);
  assert.equal(r.how, "replaced the pre-0.4 snippet with the import line");
  assert.equal(r.text, `# Repo\n\n${IMPORT_COMMENT}\n${LINE}\n## After\n\nkeep\n`);
  const bad = upsertImport(`${BEGIN}\nx\n${BEGIN}\ny\n${END}\n`, LINE);
  assert.equal(bad.changed, false);
  assert.match(bad.how, /^refused/);
});

test("the fence refuses an edit to zdd/instructions.md with its own reason, naming CLAUDE.md as the place for the adopter's rule", () => {
  const repo = adopted("fenced", { config: { hooks: { fence: true } } });
  const r = spawnSync(process.execPath, [FENCE], { input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: join(repo, "zdd", "instructions.md") } }), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, cwd: repo });
  assert.equal(r.status, 0);
  const reply = JSON.parse(r.stdout);
  assert.equal(reply.hookSpecificOutput.permissionDecision, "deny");
  assert.match(reply.hookSpecificOutput.permissionDecisionReason, /zdd\/instructions\.md is ZDD's own instructions file, rewritten by "upgrade ZDD" — never hand-edit it/);
  assert.match(reply.hookSpecificOutput.permissionDecisionReason, /A rule of your own goes in CLAUDE\.md/);
  assert.doesNotMatch(reply.hookSpecificOutput.permissionDecisionReason, /generated artifact/);
  const ok = spawnSync(process.execPath, [FENCE], { input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: join(repo, "CLAUDE.md") } }), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, cwd: repo });
  assert.equal(ok.stdout, "", "CLAUDE.md is the adopter's");
});

test("the finder names units (a paragraph, a bullet), not sections, each with the rules it speaks to; a passing mention matches nothing; headings, the block and the import lines are never units", () => {
  const text = [
    "# Bookmarks",
    "",
    "A tiny app used to smoke-test the ZDD plugin.",
    "",
    IMPORT_COMMENT,
    LINE,
    "",
    "## Workflow",
    "",
    "Branch off main. Say \"load ZDD\" before you start.",
    "",
    "- Run the tests.",
    "- Merge or rebase main in, run the deriver and renderer, commit.",
    "  Then push.",
    "- A skew is fixed by `zdd:bootstrap --upgrade`.",
    "",
    "```",
    "update ZDD inside a code fence is not a rule",
    "```",
    "",
    "## Deploying",
    "",
    "Push to main; the ZDD check runs in CI.",
    "",
  ].join("\n");
  const units = findRuleUnits(text);
  assert.deepEqual(
    units.map((u) => [u.heading, u.from, u.to, u.rules]),
    [
      ["## Workflow", 10, 10, ["load"]],
      ["## Workflow", 13, 14, ["merge"]],
      ["## Workflow", 15, 15, ["upgrade"]],
    ],
  );
  assert.equal(units[1].text, "- Merge or rebase main in, run the deriver and renderer, commit.\n  Then push.");
  // With a well-formed block instead of the line: the same.
  assert.equal(findRuleUnits(text.replace(`${IMPORT_COMMENT}\n${LINE}`, `${BEGIN}\nx\n${END}`)).length, 3);
  // Neither the line nor a well-formed block: nothing is reported.
  assert.deepEqual(findRuleUnits(text.replace(`${IMPORT_COMMENT}\n${LINE}\n`, "")), []);
  assert.deepEqual(findRuleUnits(text.replace(LINE, `${BEGIN}\nx`)), [], "a lone marker");
});

test("--drop removes one unit and says what ZDD now says; the plan prints the two side by side", () => {
  const claude = ["# P", "", IMPORT_COMMENT, LINE, "", "## Docs", "", "Run \"update ZDD\" before finishing, in a subagent to save context.", "", "Other rule.", ""].join("\n");
  const repo = adopted("drop-unit", { claude });
  const plan = runJson(repo, ["upgrade", "--plan"]);
  assert.equal(plan.duplicates.length, 1);
  const [d] = plan.duplicates;
  assert.deepEqual([d.file, d.heading, d.from, d.to, d.rules], ["CLAUDE.md", "## Docs", 8, 8, ["update"]]);
  const text = run(repo, ["upgrade", "--plan"]);
  assert.match(text, /your text, CLAUDE\.md line 8 under "## Docs": Run "update ZDD" before finishing, in a subagent to save context\./);
  assert.match(text, /ZDD now says: "update ZDD" before finishing a unit of work.*never handed to a subagent/);
  assert.match(text, /same, different, or contradicting\?/);
  const json = runJson(repo, ["upgrade", `--drop=${d.id}`]);
  assert.equal(read(repo, "CLAUDE.md"), ["# P", "", IMPORT_COMMENT, LINE, "", "## Docs", "", "Other rule.", ""].join("\n"), "the unit and its blank line go; the heading and the other rule stay");
  assert.ok(json.notes.some((n) => /CLAUDE\.md: removed line 8 under "## Docs" \(Run "update ZDD" before finishing, in a subagent to save context\.\), on the user's word/.test(n)), json.notes.join("\n"));
  assert.deepEqual(runJson(repo, ["upgrade", "--plan"]).duplicates, []);
});

test("retired names in the adopter's own text are listed with their replacement — the old command, the old extractor key, a marked block in a doc, and the old engine pin when it moved; ZDD's own files and lock files are not scanned", () => {
  const repo = adopted("retired", { engine: "2.1.0", claude: `${IMPORT_COMMENT}\n${LINE}\n` });
  mkdirSync(join(repo, "docs", "setup"), { recursive: true });
  writeFileSync(join(repo, "docs", "setup", "dev.md"), "A skew is fixed by `zdd:bootstrap --upgrade`.\nWe lock ZDD_TAG v2.1.0 in our own test.\nSet extractorOptions.services.roots.\n");
  writeFileSync(join(repo, "package-lock.json"), JSON.stringify({ packages: { x: { version: "2.1.0" } } }));
  mkdirSync(join(repo, "node_modules", "x"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "x", "README.md"), "bootstrap --upgrade");
  const json = runJson(repo, ["upgrade"]);
  const notes = json.notes.join("\n");
  assert.match(notes, /docs\/setup\/dev\.md:1 still says `zdd:bootstrap --upgrade` — since 2\.2\.0 that is "upgrade ZDD"/, notes);
  assert.match(notes, /docs\/setup\/dev\.md:2 still says `v2\.1\.0` — since this upgrade that is the new release/, notes);
  assert.match(notes, /docs\/setup\/dev\.md:3 still says `extractorOptions\.services` — since 2\.3\.0 that is the `external-services` extractor/, notes);
  const retired = json.notes.filter((n) => / still says /.test(n)).join("\n");
  assert.doesNotMatch(retired, /package-lock|node_modules|zdd\/instructions\.md|AGENTS\.md/, retired);
  assert.doesNotMatch(retired, /\.claude\/settings\.json|zdd\/config\.json/, "files this run rewrites are not reported");
});

// --- slice 2+3 review: CR-401, 402, 409, 410, 412, 413, 416, 417, 426 ----------------

test("CR-401: a file of the adopter's at ZDD's name is never overwritten — kept, named, and the import line waits", () => {
  const repo = adopted("own-instructions", { claude: "# Repo\n" });
  writeFileSync(join(repo, "zdd", "instructions.md"), "# My own notes\n\nNot ZDD's.\n");
  const json = runJson(repo, ["upgrade"]);
  assert.equal(read(repo, "zdd/instructions.md"), "# My own notes\n\nNot ZDD's.\n");
  assert.ok(!json.wrote.includes("zdd/instructions.md"));
  assert.ok(json.kept.includes("zdd/instructions.md (yours — not ZDD's file)"), json.kept.join("\n"));
  assert.ok(json.notes.some((n) => /zdd\/instructions\.md: a file of yours sits where ZDD writes its instructions/.test(n)), json.notes.join("\n"));
  assert.equal(read(repo, "CLAUDE.md"), "# Repo\n", "no import line points at a file that is not ZDD's");
  const fresh = adopted("own-instructions-apply");
  writeFileSync(join(fresh, "zdd", "instructions.md"), "mine\n");
  const j2 = runJson(fresh, ["apply", `--answers=${answers("own1", {})}`]);
  assert.equal(read(fresh, "zdd/instructions.md"), "mine\n");
  assert.ok(j2.skipped.some((s) => /^CLAUDE\.md \(the import line waits/.test(s)), j2.skipped.join("\n"));
});

test("CR-402: both options keys with different contents stop the upgrade before any write; equal ones collapse", () => {
  const repo = adopted("both-keys", { engine: "2.2.1" });
  const write = (opts) => writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["external-services"], engine: "2.2.1", extractorOptions: opts }) + "\n");
  write({ services: { services: [{ name: "Sentry", env: ["SENTRY_"] }] }, "external-services": { services: [{ name: "Resend", env: ["RESEND_"] }] } });
  const before = read(repo, "zdd/config.json");
  assert.match(fails(repo, ["upgrade"]), /has both extractorOptions\.services and extractorOptions\["external-services"\] with different contents — merge them by hand/);
  assert.equal(read(repo, "zdd/config.json"), before, "nothing written");
  write({ services: { services: [{ name: "Sentry", env: ["SENTRY_"] }] }, "external-services": { services: [{ name: "Sentry", env: ["SENTRY_"] }] } });
  runJson(repo, ["upgrade"]);
  assert.deepEqual(Object.keys(JSON.parse(read(repo, "zdd/config.json")).extractorOptions), ["external-services"]);
});

test("CR-409: the import line beside a leftover block — the block is removed; beside malformed markers — refused and said", () => {
  const leftover = adopted("leftover", { claude: `# R\n\n${IMPORT_COMMENT}\n${LINE}\n\n${BEGIN}\nold rules\n${END}\n\n## Mine\n\nkeep\n` });
  const json = runJson(leftover, ["upgrade"]);
  assert.equal(read(leftover, "CLAUDE.md"), `# R\n\n${IMPORT_COMMENT}\n${LINE}\n\n## Mine\n\nkeep\n`);
  assert.ok(json.notes.some((n) => /CLAUDE\.md: removed the leftover ZDD block; the import line already loads the instructions/.test(n)), json.notes.join("\n"));
  const bad = adopted("bad-markers", { claude: `${LINE}\n${BEGIN}\nx\n${BEGIN}\ny\n${END}\n` });
  const j2 = runJson(bad, ["upgrade"]);
  assert.ok(j2.notes.some((n) => /CLAUDE\.md: refused: the zdd:begin \/ zdd:end markers are not exactly one well-formed pair/.test(n)), j2.notes.join("\n"));
  assert.equal(read(bad, "CLAUDE.md"), `${LINE}\n${BEGIN}\nx\n${BEGIN}\ny\n${END}\n`);
});

test("CR-410: the map-link rewrite touches only destinations that resolve under the metadata folder — a URL, another tree's service folder and a code block's text stay", () => {
  const repo = adopted("links-scope", { engine: "2.2.1" });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["services"], engine: "2.2.1" }) + "\n");
  mkdirSync(join(repo, "zdd", "map", "features"), { recursive: true });
  const page = [
    "- [S](../../metadata/service/sentry.json)",
    "- [U](https://api.example.com/service/schema.json)",
    "- [P](//cdn.example.com/service/x.json)",
    "- [D](../../../docs/service/notes.json)",
    "- [R](/zdd/metadata/service/resend.json)",
    "- [X](/service/loose.json)",
    "",
  ].join("\n");
  writeFileSync(join(repo, "zdd", "map", "features", "a.md"), page);
  runJson(repo, ["upgrade"]);
  assert.equal(
    read(repo, "zdd/map/features/a.md"),
    page.replace("../../metadata/service/sentry.json", "../../metadata/external-service/sentry.json").replace("/zdd/metadata/service/resend.json", "/zdd/metadata/external-service/resend.json"),
  );
});

test("CR-412: the instructions name the adopter's configured paths, not zdd/ by default", () => {
  const repo = adopted("custom-paths", { config: { paths: { bundleDir: "docs/zdd", glossary: "docs/zdd/words.md", adrDir: "docs/zdd/adr", mapDir: "docs/zdd/map", metadataDir: "docs/zdd/inventory", agentIndex: "docs/zdd/agent-index.md", adrIndex: "docs/zdd/adr-index.md", blessingIndex: "docs/zdd/blessing-index.md", patternsPlan: "docs/zdd/plan.md", humanIndex: "docs/zdd/human-index.html", graph: "docs/zdd/graph.json" } }, claude: "# R\n", agents: `${BEGIN}\nx\n${END}\n` });
  runJson(repo, ["upgrade"]);
  const text = read(repo, "docs/zdd/instructions.md");
  assert.match(text, /`docs\/zdd\/words\.md` whole, `docs\/zdd\/adr-index\.md` whole/);
  assert.match(text, /commit `docs\/zdd\/plan\.md`/);
  assert.match(text, /`docs\/zdd\/inventory\/`, `docs\/zdd\/graph\.json`/);
  assert.match(text, /or this file \(`docs\/zdd\/instructions\.md`\)/);
  assert.doesNotMatch(text, /`zdd\/(glossary|metadata|patterns-plan|graph)/);
  assert.ok(!/<[A-Z_]+>/.test(text), `unfilled placeholder in: ${text}`);
  assert.equal(read(repo, "CLAUDE.md"), "# R\n", "an upgrade never adds the line to a CLAUDE.md with no ZDD text — it says so; a repair apply adds it");
  runJson(repo, ["apply", `--answers=${answers("cp1", {})}`]);
  assert.equal(read(repo, "CLAUDE.md"), "# R\n\n" + IMPORT_COMMENT + "\n@docs/zdd/instructions.md\n");
  const agents = read(repo, "AGENTS.md");
  assert.match(agents, /so this is a copy of docs\/zdd\/instructions\.md/);
  assert.match(agents, /`docs\/zdd\/words\.md` whole/);
  // A bundle at the repo root is refused by the plugin's own path rule (artifactPaths: never the checkout itself), so there is no root-level instructions file to fence (CR-411: declined for that reason; the writer and the fence still handle "." defensively).
});

test("CR-426: the AGENTS.md block is exactly the markers, the header and the instructions body — byte for byte", () => {
  const repo = adopted("agents-exact", { agents: `${BEGIN}\nold\n${END}\n\n## Theirs\n\nkeep\n` });
  runJson(repo, ["upgrade"]);
  const expected = `${BEGIN}\n<!-- Managed by Zero-Drift Docs (zdd): "upgrade ZDD" rewrites everything between the zdd:begin and zdd:end markers. Codex has no file import, so this is a copy of zdd/instructions.md. -->\n${instructionsBody().trimEnd()}\n${END}\n\n## Theirs\n\nkeep\n`;
  assert.equal(read(repo, "AGENTS.md"), expected);
});

test("CR-416/417: the sweep reports the old strict kind and old record ids, scans git's tracked files, and says when it was cut short", () => {
  const repo = adopted("sweep-git", { engine: "2.2.1", claude: `${IMPORT_COMMENT}\n${LINE}\n` });
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "claims.md"), 'Our strict list: claims.strictKinds: ["service"].\nAllow service:resend.\n');
  mkdirSync(join(repo, "build"), { recursive: true });
  writeFileSync(join(repo, "build", "out.md"), "zdd:bootstrap --upgrade\n");
  writeFileSync(join(repo, ".gitignore"), "build/\n");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "-A"], { cwd: repo });
  const json = runJson(repo, ["upgrade"]);
  const notes = json.notes.filter((n) => / still says /.test(n)).join("\n");
  assert.match(notes, /docs\/claims\.md:1 still says `strictKinds: \["service"` — since 2\.3\.0 that is the strict kind `external-service`/, notes);
  assert.match(notes, /docs\/claims\.md:2 still says `service:resend`/, notes);
  assert.doesNotMatch(notes, /build\/out\.md/, "an ignored folder is not swept when git lists the files");
  assert.ok(!json.notes.some((n) => /sweep for retired names was cut short/.test(n)));
});
