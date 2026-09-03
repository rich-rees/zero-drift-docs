// `load`'s first step: warn when the adopter's engine pin is behind the plugin.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKEW = join(PLUGIN, "scripts", "check-skew.mjs");
const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const prev = (v) => {
  const [maj, min] = v.split(".").map(Number);
  return min > 0 ? `${maj}.${min - 1}.0` : `${maj - 1}.9.0`;
};

let repo;
before(() => {
  repo = mkdtempSync(join(tmpdir(), "zdd-skew-"));
  mkdirSync(join(repo, "zdd"));
  mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
});
after(() => rmSync(repo, { recursive: true, force: true }));

const run = () => execFileSync(process.execPath, [SKEW, `--root=${repo}`], { encoding: "utf8" });

test("engine pinned one minor behind: first line warns and names bootstrap --upgrade", () => {
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], engine: prev(VERSION) }));
  writeFileSync(join(repo, ".github", "workflows", "zdd.yml"), `env:\n  ZDD_ENGINE: "@rich-rees/zdd-engine@${prev(VERSION)}"\n`);
  const out = run();
  const first = out.split("\n")[0];
  assert.match(first, /^ZDD engine skew/);
  assert.match(first, /behind plugin/);
  assert.match(first, /bootstrap --upgrade/);
  assert.match(first, /zdd\/config\.json/);
  assert.match(first, /\.github\/workflows\/zdd\.yml/);
});

test("versions match: no warning at all", () => {
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], engine: VERSION }));
  writeFileSync(join(repo, ".github", "workflows", "zdd.yml"), `env:\n  ZDD_ENGINE: "@rich-rees/zdd-engine@${VERSION}"\n`);
  assert.equal(run(), "");
});

test("no pins at all (adopted without CI, before pins existed): silent", () => {
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"] }));
  rmSync(join(repo, ".github"), { recursive: true });
  assert.equal(run(), "");
});
