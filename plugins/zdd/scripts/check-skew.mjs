#!/usr/bin/env node
// Engine-skew check, run as the first step of `load`. The adopter's repo pins
// the engine version in up to three plugin-owned places — zdd/config.json
// (`engine`), the CI workflow (`ZDD_ENGINE`), and the pre-push hook — while
// the plugin's skills call the version the plugin was released with. When a
// pin differs from the plugin, the agent regenerates with one engine and CI
// checks with another, and the mismatch surfaces as a red check nobody can
// explain. Warn where the developer will see it, and name the fix:
// `bootstrap --upgrade` rewrites every pin.
//
//   node check-skew.mjs [--root=<dir>] [--json]
//
// Exit 0 always, whatever the repo contains (CR-020). Alignment is EXACT: any
// pin whose string differs from the plugin version is skew (a prerelease is
// different bytes — CR-037); the numeric compare only labels the direction.
// Pin values are untrusted text and are never echoed raw: a value that is not
// a well-formed version is reported as such, in one fixed line (CR-021).

import { readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, adopterRoot, readConfig, pluginVersion, ENGINE_PACKAGE } from "./lib/repo.mjs";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function findPins(root) {
  const pins = [];
  const { state, config } = readConfig(root);
  if (state === "valid" && config.engine !== undefined) pins.push({ where: "zdd/config.json (engine)", raw: config.engine });
  const re = new RegExp(ENGINE_PACKAGE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "@([^\"'\\s]*)");
  for (const rel of [".github/workflows/zdd.yml", ".githooks/pre-push"]) {
    const p = join(root, rel);
    let text;
    try {
      const st = lstatSync(p);
      if (!st.isFile() || st.size > 1024 * 1024) continue;
      text = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    const m = re.exec(text);
    if (m) pins.push({ where: rel, raw: m[1] });
  }
  return pins.map((p) => ({ where: p.where, version: typeof p.raw === "string" && SEMVER.test(p.raw) ? p.raw : null }));
}

export function compareSemver(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  return 0;
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const root = adopterRoot(flags);
  const plugin = pluginVersion();
  const pins = findPins(root);
  const invalid = pins.filter((p) => p.version === null);
  const behind = pins.filter((p) => p.version !== null && p.version !== plugin && compareSemver(p.version, plugin) <= 0);
  const ahead = pins.filter((p) => p.version !== null && p.version !== plugin && compareSemver(p.version, plugin) > 0);
  const upgrade = "Run `bootstrap --upgrade` (the bootstrap skill with --upgrade) to rewrite every pin, then run `render` and commit the result in the same PR.";

  if (flags.json) {
    process.stdout.write(JSON.stringify({ plugin, pins, skew: behind.length + ahead.length + invalid.length > 0, behind, ahead, invalid }) + "\n");
    return;
  }
  const say = (p) => `${p.where} pins ${ENGINE_PACKAGE}@${p.version}`;
  if (behind.length) {
    process.stdout.write(`ZDD engine skew: ${behind.map(say).join(", ")} — behind plugin ${plugin}. ${upgrade}\n`);
  } else if (ahead.length) {
    process.stdout.write(`ZDD engine skew: ${ahead.map(say).join(", ")} — ahead of plugin ${plugin}. Update the plugin.\n`);
  } else if (invalid.length) {
    process.stdout.write(`ZDD engine skew: ${invalid.map((p) => p.where).join(", ")} — not a well-formed version (plugin is ${plugin}). ${upgrade}\n`);
  }
}

try {
  main();
} catch {
  // A broken repo must not break `load`; the skill carries on without the check.
}
process.exitCode = 0;
