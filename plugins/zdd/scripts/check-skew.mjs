#!/usr/bin/env node
// Engine-skew check, run as the first step of `load`. The adopter's repo pins
// the engine version in up to three plugin-owned places — zdd/config.json
// (`engine`), the CI workflow (`ZDD_ENGINE`), and the pre-push hook — while
// the plugin's skills call the version the plugin was released with. When a
// pin falls behind the plugin, the agent regenerates with one engine and CI
// checks with another, and the mismatch surfaces as a red check nobody can
// explain. Warn where the developer will see it, and name the fix:
// `bootstrap --upgrade` rewrites every pin.
//
//   node check-skew.mjs [--root=<dir>] [--json]
//
// Exit 0 always. First line of output is the warning when there is one;
// silent (or `{"skew":false}` with --json) when every pin matches.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, adopterRoot, loadConfig, pluginVersion, ENGINE_PACKAGE } from "./lib/repo.mjs";

const { flags } = parseArgs(process.argv.slice(2));
const root = adopterRoot(flags);

export function findPins(root) {
  const pins = [];
  const config = loadConfig(root);
  if (typeof config?.engine === "string") pins.push({ where: "zdd/config.json (engine)", version: config.engine });
  const re = new RegExp(ENGINE_PACKAGE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "@([0-9][^\"'\\s]*)");
  for (const rel of [".github/workflows/zdd.yml", ".githooks/pre-push"]) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    const m = re.exec(readFileSync(p, "utf8"));
    if (m) pins.push({ where: rel, version: m[1] });
  }
  return pins;
}

export function compareSemver(a, b) {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

const plugin = pluginVersion();
const pins = findPins(root);
const behind = pins.filter((p) => compareSemver(p.version, plugin) < 0);
const ahead = pins.filter((p) => compareSemver(p.version, plugin) > 0);

if (flags.json) {
  process.stdout.write(JSON.stringify({ plugin, pins, skew: behind.length > 0 || ahead.length > 0, behind, ahead }) + "\n");
} else if (behind.length) {
  process.stdout.write(
    `ZDD engine skew: ${behind.map((p) => `${p.where} pins ${ENGINE_PACKAGE}@${p.version}`).join(", ")} — behind plugin ${plugin}. ` +
      `Run \`bootstrap --upgrade\` (the bootstrap skill with --upgrade) to rewrite every pin, then run \`render\` and commit the result in the same PR.\n`,
  );
} else if (ahead.length) {
  process.stdout.write(
    `ZDD engine skew: ${ahead.map((p) => `${p.where} pins ${ENGINE_PACKAGE}@${p.version}`).join(", ")} — ahead of plugin ${plugin}. Update the plugin.\n`,
  );
}
process.exit(0);
