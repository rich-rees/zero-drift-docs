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
