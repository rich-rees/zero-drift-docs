#!/usr/bin/env node
// Engine-skew check, run as the first step of `load`. The adopter's repo pins
// the engine version in up to three plugin-owned places — zdd/config.json
// (`engine`), the CI workflow (`ZDD_ENGINE`), and the pre-push hook — while
// the plugin's skills call the version the plugin was released with. When a
// pin differs from the plugin, the agent regenerates with one engine and CI
// checks with another, and the mismatch surfaces as a red check nobody can
// explain. Warn where the developer will see it, and name the fix:
// "upgrade ZDD" rewrites every pin.
//
//   node check-skew.mjs [--root=<dir>] [--json]
//
// Exit 0 always, whatever the repo contains (CR-020). Alignment is EXACT: any
// pin whose string differs from the plugin version is skew (a prerelease is
// different bytes — CR-037); the numeric compare only labels the direction.
// Pin values are untrusted text and are never echoed raw: a value that is not
// a well-formed version is reported as such, in one fixed line (CR-021).
//
// Two lines (decision 0042): a pin of the old package (@rich-rees/zdd-engine,
// the config's `engine`) is behind every release of the new one
// (@rich-rees/zdd, the config's `release`), whatever its number — 2.5.0 is
// older than 0.9.0. Its fix is the same: "upgrade ZDD".

import { readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, adopterRoot, readConfig, pluginVersion, ENGINE_PACKAGE, OLD_ENGINE_PACKAGE } from "./lib/repo.mjs";

// The semver.org grammar: no leading zeros, well-formed prerelease identifiers.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// A line up to its comment: a `#` that opens the line or follows whitespace,
// outside quotes — YAML's rule and the shell's, the two files read here.
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
export function findPins(root) {
  const pins = [];
  const { state, config } = readConfig(root);
  if (state === "valid" && config.release !== undefined) pins.push({ where: "zdd/config.json (release)", raw: config.release, pkg: ENGINE_PACKAGE });
  if (state === "valid" && config.engine !== undefined) pins.push({ where: "zdd/config.json (engine)", raw: config.engine, pkg: OLD_ENGINE_PACKAGE, old: true });
  // Either package: `@rich-rees/zdd@` is never inside the old name's pin.
  const re = new RegExp(`(${esc(OLD_ENGINE_PACKAGE)}|${esc(ENGINE_PACKAGE)})@([^"'\\s]*)`, "g");
  // The package name with no `@<version>` after it — the v0.3.1 workflow's
  // `npx -y @rich-rees/zdd-engine derive` — floats to whatever npm serves
  // today (CR-081). A longer package name or a path into the package is not
  // an invocation of it.
  const floating = new RegExp(`(?:${esc(OLD_ENGINE_PACKAGE)}|${esc(ENGINE_PACKAGE)})(?![@/\\w-])`);
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
    // Every pin outside a comment, each distinct one once (CR-154): a pin in
    // a comment is not what runs, and a first match could hide the one that
    // does — any pin that differs is skew.
    const live = text.split(/\r?\n/).map(stripComment).join("\n");
    const seen = new Set();
    for (const m of live.matchAll(re)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      pins.push({ where: rel, raw: m[2], pkg: m[1], old: m[1] === OLD_ENGINE_PACKAGE });
    }
    if (floating.test(live)) pins.push({ where: rel, raw: undefined, unpinned: true });
  }
  return pins.map((p) => ({ where: p.where, version: typeof p.raw === "string" && SEMVER.test(p.raw) ? p.raw : null, ...(p.pkg ? { package: p.pkg } : {}), ...(p.old ? { oldLine: true } : {}), ...(p.unpinned ? { unpinned: true } : {}) }));
}

// Direction only — major.minor.patch, no prerelease precedence (CR-104). Skew
// is decided by exact string inequality before this is consulted, so
// `1.0.0-rc.1` against plugin `1.0.0` is skew either way; this merely chooses
// the "behind" or "ahead" wording (here: equal numbers ⇒ 0 ⇒ "behind", whose
// fix — "upgrade ZDD" — is the right one for a prerelease pin too).
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
  const unpinned = pins.filter((p) => p.unpinned);
  const invalid = pins.filter((p) => p.version === null && !p.unpinned);
  const behind = pins.filter((p) => p.version !== null && (p.oldLine || (p.version !== plugin && compareSemver(p.version, plugin) <= 0)));
  const ahead = pins.filter((p) => p.version !== null && !p.oldLine && p.version !== plugin && compareSemver(p.version, plugin) > 0);
  const upgrade = 'Say "upgrade ZDD" (the upgrade skill) to rewrite every pin, then run `render` and commit the result in the same PR.';

  if (flags.json) {
    process.stdout.write(JSON.stringify({ plugin, pins, skew: behind.length + ahead.length + invalid.length + unpinned.length > 0, behind, ahead, invalid, unpinned }) + "\n");
    return;
  }
  // One line per kind of skew that applies, behind first (its fix is the
  // cheapest); a repo can be in several states at once (CR-101).
  const say = (p) => `${p.where} pins ${p.package ?? ENGINE_PACKAGE}@${p.version}${p.oldLine ? " (the old line, before 0.9)" : ""}`;
  const lines = [];
  if (behind.length) lines.push(`ZDD engine skew: ${behind.map(say).join(", ")} — behind plugin ${plugin}. ${upgrade}`);
  if (ahead.length) lines.push(`ZDD engine skew: ${ahead.map(say).join(", ")} — ahead of plugin ${plugin}. Update the plugin.`);
  if (invalid.length) lines.push(`ZDD engine skew: ${invalid.map((p) => p.where).join(", ")} — not a well-formed version (plugin is ${plugin}). ${upgrade}`);
  if (unpinned.length) lines.push(`ZDD engine skew: ${unpinned.map((p) => p.where).join(", ")} — the engine unpinned (floating): CI picks up whatever npm serves today (plugin is ${plugin}). ${upgrade}`);
  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
}

try {
  main();
} catch {
  // Advisory by design (CR-020, CR-115): this check is `load`'s first step and
  // must never stop it, so every error — unreadable config, odd filesystem,
  // a bug here — is swallowed and the skill carries on without the warning.
}
process.exitCode = 0;
