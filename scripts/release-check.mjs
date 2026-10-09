#!/usr/bin/env node
// The tag names the version every pin names (CAS-103, the release action).
// Run by .github/workflows/release.yml before anything is published, and by
// scripts/pre-tag.mjs on the machine that tags:
//
//   node scripts/release-check.mjs vX.Y.Z
//
// Exit 1 with the first pin that disagrees. The pins: the engine's
// package.json, both plugin manifests, the marketplace entry, the CI and
// pre-push templates, every skill's npx line, and the README's status line.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  console.error("usage: release-check.mjs vX.Y.Z");
  process.exit(2);
}
const version = tag.slice(1);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const problems = [];
const expect = (what, found) => {
  if (found !== version) problems.push(`${what}: ${found ?? "(none)"} — the tag says ${version}`);
};

expect("packages/zdd-engine/package.json version", json("packages/zdd-engine/package.json").version);
expect("plugins/zdd/.claude-plugin/plugin.json version", json("plugins/zdd/.claude-plugin/plugin.json").version);
expect("plugins/zdd/.codex-plugin/plugin.json version", json("plugins/zdd/.codex-plugin/plugin.json").version);
const market = json(".claude-plugin/marketplace.json");
const zdd = (market.plugins ?? []).find((p) => p.name === "zdd");
expect(".claude-plugin/marketplace.json zdd version", zdd?.version);
for (const rel of ["plugins/zdd/templates/zdd.yml", "plugins/zdd/templates/pre-push"]) {
  const m = /@rich-rees\/zdd-engine@(\S+?)["'\s]/.exec(read(rel));
  expect(`${rel} engine pin`, m ? m[1] : null);
}
for (const skill of readdirSync(join(ROOT, "plugins/zdd/skills"), { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const text = read(`plugins/zdd/skills/${skill.name}/SKILL.md`);
  for (const m of text.matchAll(/@rich-rees\/zdd-engine@(\S+?)\s/g)) expect(`plugins/zdd/skills/${skill.name}/SKILL.md npx pin`, m[1]);
}
const readme = read("README.md");
const status = /\*\*Status: (\d+\.\d+\.\d+)\.\*\*/.exec(readme);
expect("README.md status line", status ? status[1] : null);
// Every tag the README tells a reader to install (`…zero-drift-docs@vX.Y.Z`)
// is this one, so the install command cannot name the previous release (CR-522).
for (const m of readme.matchAll(/zero-drift-docs@v(\d+\.\d+\.\d+)/g)) expect("README.md install tag", m[1]);

if (problems.length) {
  console.error(`The tag ${tag} does not match every pin:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`every pin names ${version}`);
