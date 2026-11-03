// The release tooling names the new line's package (decision 0042; slice 6
// campaign CR-159, CR-164): release-check refuses a manifest on another name
// and a skill pinning the old package, the tag workflow asks npm about
// @rich-rees/zdd only, and the release notes' engine line runs it.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "plugins", "zdd", ".claude-plugin", "plugin.json"), "utf8")).version;
const check = (root) => spawnSync(process.execPath, [join(ROOT, "scripts", "release-check.mjs"), `v${VERSION}`, `--root=${root}`], { encoding: "utf8" });

// The files release-check reads, copied as they are.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "zdd-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const rel of ["packages/zdd-engine/package.json", "plugins/zdd/.claude-plugin", "plugins/zdd/.codex-plugin", ".claude-plugin", "plugins/zdd/templates", "plugins/zdd/skills", "README.md"]) cpSync(join(ROOT, rel), join(root, rel), { recursive: true });
  return root;
}

test("release-check: this checkout passes; a fixture copy passes; another package name or an old-line pin in a skill fails", (t) => {
  assert.equal(check(ROOT).status, 0, check(ROOT).stderr);
  const root = fixture(t);
  assert.equal(check(root).status, 0, check(root).stderr);
  const pkg = join(root, "packages", "zdd-engine", "package.json");
  const good = readFileSync(pkg, "utf8");
  writeFileSync(pkg, good.replace('"name": "@rich-rees/zdd"', '"name": "@rich-rees/zdd-engine"'));
  const r = check(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /package\.json name: @rich-rees\/zdd-engine — the engine publishes as @rich-rees\/zdd/);
  writeFileSync(pkg, good);
  const skill = join(root, "plugins", "zdd", "skills", "update", "SKILL.md");
  writeFileSync(skill, readFileSync(skill, "utf8") + `\nnpx -y @rich-rees/zdd-engine@${VERSION} lint\n`);
  const s = check(root);
  assert.equal(s.status, 1);
  assert.match(s.stderr, /update\/SKILL\.md: pins the old line's package \(@rich-rees\/zdd-engine@/);
});

test("the tag workflow asks npm about, publishes and fetches @rich-rees/zdd only", () => {
  const wf = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  const npm = wf.split(/\r?\n/).filter((l) => /\bnpm (view|publish)\b|\bnpx\b/.test(l));
  assert.ok(npm.length >= 4, npm.join("\n"));
  for (const l of npm.filter((l) => /@rich-rees\//.test(l))) assert.match(l, /"@rich-rees\/zdd@\$\{V\}"/, l);
  assert.doesNotMatch(wf, /@rich-rees\/zdd-engine/);
});

test("the release notes' engine line runs the new package at the tag", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "release-notes.mjs"), `v${VERSION}`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Engine: \`npx -y @rich-rees/zdd@${VERSION.replace(/\./g, "\\.")}\``));
  assert.doesNotMatch(r.stdout, /zdd-engine@/);
});

// CR-381 (ZDD-11 slice 7 campaign): what pre-tag counts for each adopter,
// and the engine every one of its steps runs.
test("CR-381: pre-tag counts what the upgrade asks by kind or adapter, fails a list it cannot read, prints no name it did not check, and every step runs this checkout's engine", async () => {
  const { answerCounts, dryRunEnv } = await import(new URL("../../../scripts/lib/pre-tag-report.mjs", import.meta.url).href);
  const out = (open) => ({ status: 0, stdout: JSON.stringify({ open }) });
  assert.deepEqual(answerCounts("gaps", out([])), { ok: true, count: 0, line: "0 gaps to answer" });
  assert.equal(answerCounts("gaps", out([{ kind: "route" }, { kind: "surface" }, { kind: "route" }])).line, "3 gaps to answer (2 route, 1 surface)");
  assert.equal(answerCounts("unread", out([{ adapter: "supabase" }])).line, "1 unread items to answer (1 supabase)");
  assert.equal(answerCounts("gaps", out([{ kind: "x\n  ok   forged" }, { kind: 7 }])).line, "2 gaps to answer (2 ?)", "a name it did not check is never printed");
  for (const bad of [{ status: 1, stdout: JSON.stringify({ open: [] }) }, { status: 0, stdout: "not json" }, { status: 0, stdout: JSON.stringify({ open: "x" }) }, { status: null, stdout: "" }]) {
    assert.equal(answerCounts("gaps", bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(dryRunEnv("/e/zdd-engine.mjs", { PATH: "p", ZDD_ENGINE_BIN: "other" }).ZDD_ENGINE_BIN, "/e/zdd-engine.mjs");
  assert.equal(dryRunEnv("/e", { PATH: "p" }).PATH, "p");
  // Every process pre-tag starts is given that environment.
  const src = readFileSync(join(ROOT, "scripts", "pre-tag.mjs"), "utf8");
  const spawns = [...src.matchAll(/\b(?:spawnSync|execFileSync)\(/g)].length;
  const withEnv = [...src.matchAll(/\b(?:spawnSync|execFileSync)\([^\n]*\benv: ENV\b/g)].length;
  const gitSetup = [...src.matchAll(/execFileSync\("git", \["(?:init|add|-c)"/g)].length;
  assert.equal(withEnv + gitSetup, spawns, "a step without this checkout's engine");
  assert.match(src, /const ENV = dryRunEnv\(ENGINE\);/);
});

// CR-385 (verify pass 1): the upgrade's note tells an old-line repo to
// derive 0.9's own changes before proof 1, and the dry run must do the same.
test("CR-385: pre-tag derives before proof 1 for a copy pinned on the old line, and only then", async () => {
  const { pinnedOnOldLine } = await import(new URL("../../../scripts/lib/pre-tag-report.mjs", import.meta.url).href);
  assert.equal(pinnedOnOldLine(JSON.stringify({ engine: "2.4.1", extractors: ["supabase"] })), true);
  for (const c of [{ release: "0.13.0" }, { release: "0.13.0", engine: "2.4.1" }, {}, null]) assert.equal(pinnedOnOldLine(JSON.stringify(c)), false, JSON.stringify(c));
  assert.equal(pinnedOnOldLine("not json"), false);
  const src = readFileSync(join(ROOT, "scripts", "pre-tag.mjs"), "utf8");
  const derive = src.indexOf("if (oldLine) ok = run(");
  const prove = src.indexOf('[PLUGIN, "starters", "--prove"');
  assert.ok(derive > 0 && prove > derive, "the old line's derive comes before proof 1");
  assert.ok(src.indexOf("pinnedOnOldLine(readFileSync(") < src.indexOf('[PLUGIN, "upgrade", ...moving'), "the pin is read before the upgrade rewrites it");
});
