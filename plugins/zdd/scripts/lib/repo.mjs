// Shared plumbing for the plugin's scripts (bootstrap, the hooks, the skew
// check). Two roots are always in play and crossing them is the classic bug:
// the PLUGIN root (where these scripts live — reached by hooks.json via
// ${CLAUDE_PLUGIN_ROOT}) and the ADOPTER root (the repo being documented —
// CLAUDE_PROJECT_DIR, an explicit --root, or cwd). Nothing here ever writes;
// the writers are bootstrap.mjs and nobody else.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENGINE_PACKAGE = "@rich-rees/zdd-engine";

// Mirror of the engine's DEFAULT_PATHS (src/lib/config.mjs). The engine is
// installed outside the plugin (npx), so the plugin cannot import it — this
// copy is the contract both sides honour, and config.schema.json documents it.
export const DEFAULT_PATHS = {
  glossary: "zdd/glossary.md",
  adrDir: "zdd/adr",
  mapDir: "zdd/map",
  metadataDir: "zdd/metadata",
  agentIndex: "zdd/agent-index.md",
  adrIndex: "zdd/adr-index.md",
  humanIndex: "zdd/human-index.html",
  graph: "zdd/graph.json",
  bundleDir: "zdd",
};

// The plugin's own version — the one every pin is compared against.
export function pluginVersion() {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  return manifest.version;
}

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    const m = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/i.exec(a);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    else positional.push(a);
  }
  return { flags, positional };
}

// Adopter root: explicit flag, else the hook's project dir, else cwd.
export function adopterRoot(flags = {}) {
  return resolve(flags.root || process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Loads zdd/config.json if present. Malformed config is the engine's problem
// to report loudly; a hook must never punish a session for it, so callers get
// `null` and carry on.
export function loadConfig(root) {
  const configPath = join(root, "zdd", "config.json");
  if (!existsSync(configPath)) return null;
  try {
    return readJson(configPath);
  } catch {
    return null;
  }
}

export function artifactPaths(config) {
  return { ...DEFAULT_PATHS, ...(config?.paths ?? {}) };
}

export const posixify = (p) => p.split(/[\\/]/).join("/");

// ---------------------------------------------------------------------------
// The mattpocock-skills check, shared by bootstrap (recommendation step) and
// documented in grill/SKILL.md. `domain-modeling` is the one that must be
// present — it is the writer. HOME is overridable so tests can stage a fake
// install; the walk is bounded so a huge plugin cache cannot stall a session.
// ---------------------------------------------------------------------------
export function pocockLocations(root, home = process.env.ZDD_HOME || homedir()) {
  return {
    pluginCache: join(home, ".claude", "plugins", "cache"),
    userSkill: join(home, ".claude", "skills", "domain-modeling", "SKILL.md"),
    codexSkill: join(home, ".codex", "skills", "domain-modeling", "SKILL.md"),
    projectSkill: join(root, ".claude", "skills", "domain-modeling", "SKILL.md"),
  };
}

export function findPocock(root, home) {
  const loc = pocockLocations(root, home);
  const hits = [];
  for (const key of ["userSkill", "codexSkill", "projectSkill"]) if (existsSync(loc[key])) hits.push(loc[key]);
  const found = findUnder(loc.pluginCache, ["domain-modeling", "SKILL.md"], 8);
  if (found) hits.push(found);
  return { installed: hits.length > 0, hits, searched: Object.values(loc) };
}

function findUnder(dir, tail, depth) {
  if (depth < 0 || !existsSync(dir)) return null;
  let entries;
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return null;
  }
  const direct = join(dir, ...tail);
  if (existsSync(direct)) return direct;
  for (const name of entries) {
    const p = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (!isDir || name === "node_modules") continue;
    const hit = findUnder(p, tail, depth - 1);
    if (hit) return hit;
  }
  return null;
}
