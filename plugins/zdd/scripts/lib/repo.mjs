// Shared plumbing for the plugin's scripts (bootstrap, the hooks, the skew
// check). Two roots are always in play and crossing them is the classic bug:
// the PLUGIN root (where these scripts live — reached by hooks.json via
// ${CLAUDE_PLUGIN_ROOT}) and the ADOPTER root (the repo being documented —
// CLAUDE_PROJECT_DIR, an explicit --root, or the nearest zdd/config.json
// above cwd). Nothing here ever writes; the writer is bootstrap.mjs alone.
//
// Everything the adopter's repo hands us is untrusted input (review CR-002..
// CR-004): config may be malformed, a configured path may point outside the
// checkout, a path segment may be a symlink to anywhere. So: config loading
// reports absent / invalid / valid distinctly, every artifact path is
// validated repo-relative, and every read or write goes through resolveInside,
// which refuses symlinks and a real path outside the real checkout.

import { readFileSync, existsSync, readdirSync, statSync, lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENGINE_PACKAGE = "@rich-rees/zdd-engine";
export const MAX_CONFIG_BYTES = 1024 * 1024; // a config bigger than this is not a config
export const MAX_INDEX_BYTES = 512 * 1024; // an index bigger than this is not injected

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

// The tool names the fence handles, by shape. hooks.json's PreToolUse matcher
// must be exactly their union — a test derives one from the other (CR-077).
// Claude Code names (Write, Edit, Bash…) and Codex names (shell_command,
// apply_patch…) side by side; the extra spellings cost nothing.
export const FENCE_TOOLS = {
  edit: ["Write", "Edit", "MultiEdit", "NotebookEdit", "write_file", "edit_file"],
  shell: ["Bash", "PowerShell", "Shell", "shell", "shell_command", "exec_command", "local_shell"],
  patch: ["apply_patch"],
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

export const posixify = (p) => p.split(/[\\/]/).join("/");

// Adopter root: explicit flag, else the host's project dir, else the nearest
// directory at or above `cwd` holding zdd/config.json (a session opened in a
// monorepo package still finds the repo's config — CR-025), else cwd.
export function adopterRoot(flags = {}) {
  if (flags.root) return resolve(flags.root);
  if (process.env.CLAUDE_PROJECT_DIR) return resolve(process.env.CLAUDE_PROJECT_DIR);
  let dir = resolve(flags.cwd || process.cwd());
  for (;;) {
    if (existsSync(join(dir, "zdd", "config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(flags.cwd || process.cwd());
    dir = parent;
  }
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Config in three states. Hooks treat anything but `valid` as "not adopted
// here" and stay silent; bootstrap treats `invalid` as a hard stop, because a
// config that exists but cannot be read is the adopter's, not ours to replace.
export function readConfig(root) {
  const configPath = join(root, "zdd", "config.json");
  let st;
  try {
    st = lstatSync(configPath);
  } catch {
    return { state: "absent", config: null, path: configPath };
  }
  try {
    resolveInside(root, "zdd/config.json", "zdd/config.json"); // a symlinked zdd/ is not ours to read
  } catch (e) {
    return { state: "invalid", config: null, path: configPath, error: e.message };
  }
  if (st.isSymbolicLink()) return { state: "invalid", config: null, path: configPath, error: "zdd/config.json is a symlink" };
  if (!st.isFile()) return { state: "invalid", config: null, path: configPath, error: "zdd/config.json is not a file" };
  if (st.size > MAX_CONFIG_BYTES) return { state: "invalid", config: null, path: configPath, error: `zdd/config.json is ${st.size} bytes — larger than ${MAX_CONFIG_BYTES}` };
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return { state: "invalid", config: null, path: configPath, error: "zdd/config.json is not a JSON object" };
    }
    return { state: "valid", config, path: configPath };
  } catch (e) {
    return { state: "invalid", config: null, path: configPath, error: `zdd/config.json does not parse: ${e.message}` };
  }
}

// The lenient view for hooks: the config or null.
export function loadConfig(root) {
  return readConfig(root).config;
}

// A repo-relative path: a non-empty string, no scheme, not absolute (POSIX or
// Windows), no `..` segment, no control characters. Returns the POSIX form.
export function repoRelative(value, label) {
  if (typeof value !== "string" || !value.length) throw new Error(`${label}: must be a non-empty string`);
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error(`${label}: contains control characters`);
  const p = posixify(value).replace(/\/+$/, "");
  if (isAbsolute(value) || /^[a-zA-Z]:/.test(p) || p.startsWith("/") || p.startsWith("\\") || /^[a-z][a-z0-9+.-]*:/i.test(p)) {
    throw new Error(`${label}: must be repo-relative, got ${JSON.stringify(value)}`);
  }
  const segs = p.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) throw new Error(`${label}: must not contain '..', got ${JSON.stringify(value)}`);
  if (!segs.length) throw new Error(`${label}: must not be the repo root`);
  return segs.join("/");
}

// Every artifact path, validated, keyed by the nine names the engine knows.
// Unknown `paths.*` keys are ignored: the engine does not read them, and one
// stray key must never decide the fate of the others (CR-070).
//
// Two modes. Strict (the default, bootstrap): the first bad value throws, so
// nothing is written over a config the adopter has to fix. Lenient (the
// hooks): each key is judged on its own and a bad value falls back to its
// default — a fence that switched itself off over one typo would be the one
// failure mode worse than a noisy one.
//
// A generated path may not overlap anything the fence must leave alone
// (CR-075): a generated dir equal to or above a curated path (glossary,
// adrDir, mapDir) or zdd/config.json, a generated file that IS one of those,
// or two keys sharing one value — otherwise the fence would block the very
// file its reason text tells the agent to edit. Such a value is invalid the
// same way an escaping one is: strict throws, lenient falls back.
export const GENERATED_KEYS = ["metadataDir", "graph", "agentIndex", "adrIndex", "humanIndex"];
export const CURATED_KEYS = ["glossary", "adrDir", "mapDir"];
export const CONFIG_REL = "zdd/config.json";
const samePosix = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const posixPrefix = (dir, p) => samePosix(dir, p) || (process.platform === "win32" ? p.toLowerCase().startsWith(dir.toLowerCase() + "/") : p.startsWith(dir + "/"));

export function artifactPaths(config, { lenient = false } = {}) {
  const given = config?.paths;
  const configured = given && typeof given === "object" && !Array.isArray(given) ? given : {};
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_PATHS)) {
    const value = configured[key] === undefined ? fallback : configured[key];
    try {
      out[key] = repoRelative(value, `paths.${key}`);
    } catch (e) {
      if (!lenient) throw e;
      out[key] = fallback;
    }
  }
  const overlap = (key) => {
    const p = out[key];
    if (key === "metadataDir") {
      for (const c of [...CURATED_KEYS.map((k) => out[k]), CONFIG_REL]) if (posixPrefix(p, c)) return `paths.${key} ${JSON.stringify(p)} contains ${JSON.stringify(c)}`;
    } else if (samePosix(p, CONFIG_REL)) return `paths.${key} ${JSON.stringify(p)} is the config file`;
    for (const other of Object.keys(out)) if (other !== key && samePosix(p, out[other])) return `paths.${key} and paths.${other} are both ${JSON.stringify(p)}`;
    return null;
  };
  // Judge every generated key against the values as configured, then apply
  // the fallbacks together, so two keys sharing a value both fall back.
  const bad = GENERATED_KEYS.map((key) => [key, overlap(key)]).filter(([, why]) => why);
  for (const [key, why] of bad) {
    if (!lenient) throw new Error(`${why} — a generated path must not overlap a curated one`);
    out[key] = DEFAULT_PATHS[key];
  }
  // A default can itself collide with a curated value the adopter chose
  // (`glossary: "zdd/graph.json"`); a generated key with nowhere safe to fall
  // back to is dropped (undefined) rather than fencing a curated file.
  if (lenient) for (const [key] of bad) if (overlap(key)) delete out[key];
  return out;
}

// Resolve `rel` under `root` and prove the result stays inside the checkout:
// lexically (no escape), then physically — no symlink on any existing segment
// between root and the target, and the real path of the nearest existing
// ancestor inside the real root. Returns the absolute path. Throws otherwise.
export function resolveInside(root, rel, label = rel) {
  const absRoot = resolve(root);
  const abs = resolve(absRoot, rel);
  const r = relative(absRoot, abs);
  if (r === "" || r.startsWith("..") || isAbsolute(r)) throw new Error(`${label}: resolves outside the checkout`);
  // Walk the existing prefix segment by segment; refuse any symlink.
  let cur = absRoot;
  for (const seg of r.split(sep)) {
    cur = join(cur, seg);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      break; // the rest does not exist yet — fine for a write target
    }
    if (st.isSymbolicLink()) throw new Error(`${label}: ${posixify(relative(absRoot, cur))} is a symlink`);
  }
  // Physical containment of the nearest existing ancestor (covers junctions
  // and a root that is itself reached through a link).
  let probe = abs;
  while (!existsSync(probe)) probe = dirname(probe);
  const realRoot = realpathSync(absRoot);
  const realProbe = realpathSync(probe);
  const rr = relative(realRoot, realProbe);
  if (rr.startsWith("..") || isAbsolute(rr)) throw new Error(`${label}: real path leaves the checkout`);
  return abs;
}

// Read a regular file inside the checkout, bounded. Returns null when it is
// absent, a symlink, not a regular file, or over the cap.
export function readInside(root, rel, maxBytes, label = rel) {
  const abs = resolveInside(root, rel, label);
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > maxBytes) return null;
  return readFileSync(abs, "utf8");
}

// Same-path comparison for the fence: canonical absolute form, and
// case-insensitive where the filesystem is (Windows).
export function samePath(a, b) {
  const na = resolve(a);
  const nb = resolve(b);
  return process.platform === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}
export function isUnder(child, parent) {
  const r = relative(resolve(parent), resolve(child));
  const inside = r !== "" && !r.startsWith("..") && !isAbsolute(r);
  if (inside || process.platform !== "win32") return inside;
  const rl = relative(resolve(parent).toLowerCase(), resolve(child).toLowerCase());
  return rl !== "" && !rl.startsWith("..") && !isAbsolute(rl);
}

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
  for (const key of ["userSkill", "codexSkill", "projectSkill"]) if (existsSync(loc[key])) hits.push({ where: key, path: loc[key] });
  const found = findUnder(loc.pluginCache, ["domain-modeling", "SKILL.md"], 8);
  if (found) hits.push({ where: "pluginCache", path: found });
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
