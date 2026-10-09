// CAS-103: the first-run fixes DiO's move (DIO-335) and Cascade's (CAS-102)
// found in 2.2.1, each at the file or process seam the runbook owns.
//   C15  derive and render write LF; on a core.autocrlf=true checkout git
//        showed ~49 metadata files "modified" by line ending alone. Bootstrap
//        and upgrade pin the bundle to LF in .gitattributes.
//   5    the lint-step migration recognised only the stock shape; DiO's
//        `lint ${{ … }}` step was reported "not found". Any `lint …` gains
//        --merge.
//   9    a repair apply said "skipped AGENTS.md (not using Codex)" in a repo
//        whose AGENTS.md block it had just refreshed, and reported the
//        switched-off official Pocock copy as "installed".
//   C4   release-status did not name the release this session runs.
//   C3   release-status says when the running release and the catalogue
//        already match the target, so step 2 runs in the same session.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mergeGate, GITATTRIBUTES_LINE } from "../scripts/bootstrap.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const POCOCK = JSON.parse(readFileSync(join(PLUGIN, "pocock.json"), "utf8"));
const LOCK = (ref) => ({ "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref }, autoUpdate: false } });

let scratch, home;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-firstrun-"));
  home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const run = (root, args, h = home) => execFileSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${h}`, "--date=2026-10-09"], { encoding: "utf8" });
const runJson = (root, args, h) => JSON.parse(run(root, [...args, "--json"], h));
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
const adopted = (name, { engine = "2.2.1", claude, agents, settings = { extraKnownMarketplaces: LOCK("v2.2.1") } } = {}) => {
  const repo = fresh(name);
  mkdirSync(join(repo, "zdd"), { recursive: true });
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], engine }, null, 2) + "\n");
  if (settings) writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  if (claude !== undefined) writeFileSync(join(repo, "CLAUDE.md"), claude);
  if (agents !== undefined) writeFileSync(join(repo, "AGENTS.md"), agents);
  return repo;
};

// --- C15: line endings ---------------------------------------------------------

test("C15: a fresh apply writes .gitattributes pinning the bundle to LF; an existing file gains the one line, keeps its own, and is not touched again", () => {
  const repo = fresh("gitattributes-fresh");
  const json = runJson(repo, ["apply", `--answers=${answers("ga1", { extractors: ["generic"] })}`]);
  assert.ok(json.wrote.includes(".gitattributes"), json.wrote.join("\n"));
  assert.equal(readFileSync(join(repo, ".gitattributes"), "utf8"), GITATTRIBUTES_LINE + "\n");
  assert.ok(json.notes.some((n) => /\.gitattributes: zdd\/ checked out and committed with LF line endings/.test(n)), json.notes.join("\n"));

  const repo2 = fresh("gitattributes-existing");
  writeFileSync(join(repo2, ".gitattributes"), "*.png binary\r\n");
  const json2 = runJson(repo2, ["apply", `--answers=${answers("ga2", { extractors: ["generic"] })}`]);
  assert.ok(json2.wrote.includes(".gitattributes"));
  assert.equal(readFileSync(join(repo2, ".gitattributes"), "utf8"), `*.png binary\r\n${GITATTRIBUTES_LINE}\r\n`, "appended, the file's own line ending kept");
  const again = runJson(repo2, ["apply", `--answers=${answers("ga3", { extractors: ["generic"] })}`]);
  assert.ok(again.kept.includes(".gitattributes"), "second run: already there");
  assert.ok(!again.wrote.includes(".gitattributes"));
});

test("C15: upgrade adds the line to a repo that predates it, and a bundleDir that is the repo root gets a note instead of a `./**` rule", () => {
  const repo = adopted("gitattributes-upgrade", { engine: "2.2.1" });
  const plan = runJson(repo, ["upgrade", "--plan"]);
  assert.ok(plan.wrote.includes(".gitattributes"), plan.wrote.join("\n"));
  assert.ok(!existsSync(join(repo, ".gitattributes")), "a plan writes nothing");
  const json = runJson(repo, ["upgrade"]);
  assert.ok(json.wrote.includes(".gitattributes"));
  assert.equal(readFileSync(join(repo, ".gitattributes"), "utf8"), GITATTRIBUTES_LINE + "\n");

  const rootBundle = adopted("gitattributes-root", { engine: "2.2.1" });
  writeFileSync(join(rootBundle, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], engine: "2.2.1", paths: { bundleDir: "." } }, null, 2) + "\n");
  const j2 = runJson(rootBundle, ["upgrade"]);
  assert.ok(!j2.wrote.includes(".gitattributes"));
  assert.ok(j2.notes.some((n) => /\.gitattributes: not written — paths\.bundleDir is the repo root/.test(n)), j2.notes.join("\n"));
});

// --- 5: the lint step in any shape ----------------------------------------------

test("5: mergeGate adds --merge to a lint step of any shape — an expression after lint, a flag, a run with a pipe — and never twice", () => {
  const cases = [
    ['      - run: npx -y "$ZDD_ENGINE" lint ${{ github.event_name == \'pull_request\' && \'--tempstate\' || \'\' }}', '      - run: npx -y "$ZDD_ENGINE" lint --merge ${{ github.event_name == \'pull_request\' && \'--tempstate\' || \'\' }}'],
    ['        run: npx -y "$ZDD_ENGINE" lint --verbose', '        run: npx -y "$ZDD_ENGINE" lint --merge --verbose'],
    ['        run: npx -y "$ZDD_ENGINE" lint | tee lint.txt', '        run: npx -y "$ZDD_ENGINE" lint --merge | tee lint.txt'],
    ['        run: npx -y "$ZDD_ENGINE" lint\r', '        run: npx -y "$ZDD_ENGINE" lint --merge\r'],
  ];
  for (const [before, after_] of cases) {
    const r = mergeGate(`name: zdd\n${before}\n`);
    assert.equal(r.how, "added", before);
    assert.equal(r.text, `name: zdd\n${after_}\n`);
  }
  assert.equal(mergeGate('run: npx -y "$ZDD_ENGINE" lint --merge --verbose\n').how, "present");
  assert.equal(mergeGate('run: npx -y "$ZDD_ENGINE" linter\n').how, "absent", "`linter` is not the lint step");
  assert.equal(mergeGate("run: make lint\n").how, "absent");
});

// --- 9: the ledger tells the truth ----------------------------------------------

test("9: a repair apply refreshes an AGENTS.md that carries the block, with no codex answer, and never says 'not using Codex' about it", () => {
  const repo = fresh("agents-repair");
  run(repo, ["apply", `--answers=${answers("ag1", { extractors: ["generic"], codex: true })}`]);
  const agents = join(repo, "AGENTS.md");
  assert.ok(existsSync(agents));
  // A stale block, as an older release left it.
  writeFileSync(agents, readFileSync(agents, "utf8").replace("<!-- zdd:begin -->\n", "<!-- zdd:begin -->\nold line\n"));
  const json = runJson(repo, ["apply", `--answers=${answers("ag2", { optIns: { stop: true } })}`]);
  assert.ok(!json.skipped.some((s) => s.startsWith("AGENTS.md")), json.skipped.join("\n"));
  assert.ok(json.wrote.includes("AGENTS.md"), json.wrote.join("\n"));
  assert.ok(!readFileSync(agents, "utf8").includes("old line"));
  // No AGENTS.md and no codex answer on a fresh repo: still skipped, still said.
  const plain = fresh("agents-plain");
  const j2 = runJson(plain, ["apply", `--answers=${answers("ag3", { extractors: ["generic"] })}`]);
  assert.ok(j2.skipped.some((s) => /^AGENTS\.md \(not using Codex/.test(s)), j2.skipped.join("\n"));
});

test("9: a switched-off copy of Matt Pocock's skills in the plugin cache is 'present but switched off here', not 'installed'; the pinned copy is 'installed'", () => {
  const repo = fresh("pocock-off");
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "mattpocock-skills@claude-plugins-official": false, "zdd@zero-drift-docs": true, [`${POCOCK.plugin}@${POCOCK.marketplace}`]: true } }) + "\n");
  const h = join(scratch, "home-off");
  const official = join(h, ".claude", "plugins", "cache", "claude-plugins-official", "mattpocock-skills", "1.2.1", "skills", "productivity", "domain-modeling");
  mkdirSync(official, { recursive: true });
  writeFileSync(join(official, "SKILL.md"), "---\nname: domain-modeling\n---\n");
  const out = run(repo, ["detect"], h);
  assert.match(out, /mattpocock-skills: NOT installed as ZDD's pinned copy/, out);
  assert.match(out, /a copy is present but switched off here: mattpocock-skills@claude-plugins-official 1\.2\.1/, out);
  assert.doesNotMatch(out, /mattpocock-skills: installed/);
  const json = runJson(repo, ["detect"], h);
  assert.equal(json.pocock.installed, false);
  assert.deepEqual(json.pocock.hits.map((x) => [x.id, x.version, x.enabled]), [["mattpocock-skills@claude-plugins-official", "1.2.1", false]]);

  const pinned = join(h, ".claude", "plugins", "cache", POCOCK.marketplace, POCOCK.plugin, POCOCK.version, "skills", "productivity", "domain-modeling");
  mkdirSync(pinned, { recursive: true });
  writeFileSync(join(pinned, "SKILL.md"), "---\nname: domain-modeling\n---\n");
  const out2 = run(repo, ["detect"], h);
  assert.match(out2, new RegExp(`mattpocock-skills: installed \\(pluginCache: .*; ${POCOCK.plugin}@${POCOCK.marketplace} ${POCOCK.version.replace(/\\./g, "\\\\.")}, switched on here\\)`), out2);
});

// --- C3 / C4: release-status ----------------------------------------------------

test("C4/C3: release-status names the running release and the catalogue, and says when step 2 can run in this session", () => {
  const remote = join(scratch, "remote");
  mkdirSync(remote);
  const git = (...a) => execFileSync("git", a, { cwd: remote, encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
  for (const t of ["v2.1.0", `v${VERSION}`]) git("tag", t);
  const h = join(scratch, "home-status");
  mkdirSync(join(h, ".claude", "plugins"), { recursive: true });
  writeFileSync(join(h, ".claude", "plugins", "known_marketplaces.json"), JSON.stringify({ "zero-drift-docs": { source: { source: "github", repo: "rich-rees/zero-drift-docs", ref: `v${VERSION}` } } }));

  const behind = adopted("status-behind", { settings: { extraKnownMarketplaces: LOCK("v2.1.0") } });
  const s = runJson(behind, ["release-status", `--remote=${remote}`], h);
  assert.deepEqual(s, { lock: "v2.1.0", running: VERSION, newest: `v${VERSION}`, catalogue: `v${VERSION}`, newer: false, lockBehind: true, ready: true });
  const text = run(behind, ["release-status", `--remote=${remote}`], h);
  assert.match(text, new RegExp(`ZDD ${VERSION.replace(/\\./g, "\\\\.")} is the newest release; this repo locks v2\\.1\\.0; this session runs ${VERSION.replace(/\\./g, "\\\\.")}; the catalogue on this machine is at v${VERSION.replace(/\\./g, "\\\\.")}`), text);
  assert.match(text, /this session already runs the newest release and the catalogue is there too: move the lock with `upgrade --to=v[\d.]+` and go straight on to step 2 in this session — no restart/, text);

  const noHome = run(behind, ["release-status", `--remote=${remote}`], join(scratch, "home-empty"));
  assert.match(noHome, /the catalogue on this machine is at no recorded ref/, noHome);
  assert.match(noHome, /restart/, "with the catalogue elsewhere, the route still has a restart");
});

// --- pick 3: services → external-services ------------------------------------------

test("pick 3: upgrade renames the extractor and its options key in place, strictKinds too, rewrites the map's record links, suggests (never renames) a map/services folder; a plan shows all of it and writes nothing", () => {
  const repo = adopted("rename", { engine: "2.2.1" });
  writeFileSync(
    join(repo, "zdd", "config.json"),
    JSON.stringify({ name: "X", extractors: ["fastapi", "services"], engine: "2.2.1", extractorOptions: { fastapi: { roots: ["api"] }, services: { services: [{ name: "Sentry", env: ["SENTRY_"] }], roots: ["api"] } }, claims: { strict: true, strictKinds: ["service", "job"] } }, null, 2) + "\n",
  );
  mkdirSync(join(repo, "zdd", "map", "services"), { recursive: true });
  mkdirSync(join(repo, "zdd", "map", "features"), { recursive: true });
  const sentryPage = "---\ntype: External Service\ntitle: Sentry\n---\n\n- [Sentry (code)](../../metadata/service/sentry.json)\n- prose about a service/ path that is not a link\n";
  writeFileSync(join(repo, "zdd", "map", "services", "sentry.md"), sentryPage);
  writeFileSync(join(repo, "zdd", "map", "features", "health.md"), "---\ntype: Feature\ntitle: Health\n---\n\n- [Health](../../metadata/route/health.json)\n");
  const plan = runJson(repo, ["upgrade", "--plan"]);
  assert.ok(plan.wrote.includes("zdd/config.json") && plan.wrote.includes("zdd/map/services/sentry.md"), plan.wrote.join("\n"));
  assert.ok(!plan.wrote.includes("zdd/map/features/health.md"), "a page with no such link is untouched");
  assert.equal(readFileSync(join(repo, "zdd", "map", "services", "sentry.md"), "utf8"), sentryPage, "a plan writes nothing");
  const json = runJson(repo, ["upgrade"]);
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(cfg.extractors, ["fastapi", "external-services"]);
  assert.deepEqual(Object.keys(cfg.extractorOptions), ["fastapi", "external-services"], "the new key where the old one sat");
  assert.deepEqual(cfg.extractorOptions["external-services"], { services: [{ name: "Sentry", env: ["SENTRY_"] }], roots: ["api"] });
  assert.deepEqual(cfg.claims.strictKinds, ["external-service", "job"]);
  assert.equal(readFileSync(join(repo, "zdd", "map", "services", "sentry.md"), "utf8"), sentryPage.replace("metadata/service/", "metadata/external-service/"));
  assert.ok(json.notes.some((n) => /zdd\/config\.json: extractor "services" → "external-services"/.test(n)), json.notes.join("\n"));
  assert.ok(json.notes.some((n) => /zdd\/map\/services\/sentry\.md: links to metadata\/service\/ now point at metadata\/external-service\//.test(n)), json.notes.join("\n"));
  assert.ok(json.notes.some((n) => /zdd\/map\/services\/ is your hand-written folder .* never renamed for you/.test(n)), json.notes.join("\n"));
  assert.ok(existsSync(join(repo, "zdd", "map", "services", "sentry.md")), "the folder keeps its name");
  const again = runJson(repo, ["upgrade"]);
  assert.ok(!again.notes.some((n) => /→ "external-services"/.test(n)), "second run: nothing to rename");
});
