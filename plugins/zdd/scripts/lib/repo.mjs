// Shared plumbing for the plugin's scripts (bootstrap, the hooks, the skew
// check). Two roots are always in play and crossing them is the classic bug:
// the PLUGIN root (where these scripts live — reached by hooks.json via
// ${CLAUDE_PLUGIN_ROOT}) and the ADOPTER root (the repo being documented —
// CLAUDE_PROJECT_DIR, an explicit --root, or the nearest zdd/config.json
// above cwd). Nothing here ever writes; the writers are bootstrap.mjs and
// scaffold-extractor.mjs, both by the same rules and the same Ledger report.
//
// Everything the adopter's repo hands us is untrusted input (review CR-002..
// CR-004): config may be malformed, a configured path may point outside the
// checkout, a path segment may be a symlink to anywhere. So: config loading
// reports absent / invalid / valid distinctly, every artifact path is
// validated repo-relative, and every read or write goes through resolveInside,
// which refuses symlinks and a real path outside the real checkout.

import { readFileSync, existsSync, readdirSync, statSync, lstatSync, realpathSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, basename, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENGINE_PACKAGE = "@rich-rees/zdd-engine";
export const MAX_CONFIG_BYTES = 1024 * 1024; // a config bigger than this is not a config
export const MAX_INDEX_BYTES = 64 * 1024; // the SessionStart injection is cut here (~16k tokens, 8× render's budget) — CR-086

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
  blessingIndex: "zdd/blessing-index.md",
  patternsPlan: "zdd/patterns-plan.md",
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
// A UNC or device path (`\\server\share`, `\\?\`, `\\.\`) handed in as the
// cwd is never probed — an existsSync there is an SMB round-trip with the
// session's credentials (CR-089, the same rule as the fence's CR-052) — the
// walk starts from the process cwd instead.
export const REMOTE_OR_DEVICE = /^(\\\\|\/\/)/;
// CLAUDE_PROJECT_DIR is host-set but still a path we are about to probe, so
// the same UNC/device rule applies to it (CR-010, DIO-313): such a value is
// ignored and the walk starts from the process cwd.
export function adopterRoot(flags = {}) {
  if (flags.root) return resolve(flags.root);
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir && !REMOTE_OR_DEVICE.test(projectDir)) return resolve(projectDir);
  const start = flags.cwd && !REMOTE_OR_DEVICE.test(flags.cwd) ? flags.cwd : process.cwd();
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "zdd", "config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
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

// A repo-relative path, in the engine's language
// (packages/zdd-engine/src/lib/paths.mjs, CR-079): a non-empty string with no
// whitespace or control character anywhere, no leading `/`, no drive letter,
// no URL scheme, no `..` segment. Returns the normal form — `.`-segments and
// empty segments dropped, "." for the repo root itself (the engine's
// convention; a caller that cannot use the root says so — see artifactPaths).
//
// `exact` is the engine byte-for-byte: a backslash is refused. That is the
// mode for anything read back from zdd/config.json, so the fence never guards
// a path the engine will refuse to write. The default additionally accepts
// Windows separators and normalises them — for a path a person TYPED as a
// bootstrap answer, which bootstrap writes to config in the normal form
// (bootstrap.test: "equivalent spellings are one path"). A test holds the
// exact mode and the engine together.
export function repoRelative(value, label, { exact = false } = {}) {
  if (typeof value !== "string" || !value.length) throw new Error(`${label}: must be a non-empty string`);
  if (/[\s\x00-\x1f\x7f]/.test(value)) throw new Error(`${label}: must not contain whitespace or control characters, got ${JSON.stringify(value)}`);
  if (exact && value.includes("\\")) throw new Error(`${label}: must use '/' separators, no backslash, got ${JSON.stringify(value)}`);
  const p = exact ? value : posixify(value);
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(p)) {
    throw new Error(`${label}: must be repo-relative (no absolute path, drive letter or URL scheme), got ${JSON.stringify(value)}`);
  }
  const segs = p.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) throw new Error(`${label}: must not contain '..', got ${JSON.stringify(value)}`);
  return segs.length ? segs.join("/") : ".";
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
// same way an escaping one is: strict throws, lenient falls back. The pattern
// plan (paths.patternsPlan, CAS-96) is a session's working file, so it is
// left alone like a curated path.
export const GENERATED_KEYS = ["metadataDir", "graph", "agentIndex", "adrIndex", "blessingIndex", "humanIndex"];
export const CURATED_KEYS = ["glossary", "adrDir", "mapDir"];
export const CONFIG_REL = "zdd/config.json";
// Two repo-relative paths share ground: one is the other, or sits under it.
// Case is folded where the filesystem folds it (Windows, macOS), as the
// engine's overlaps() does (CAS-65 CR-004).
export function pathsOverlap(a, b) {
  const fold = process.platform === "win32" || process.platform === "darwin" ? (s) => s.toLowerCase() : (s) => s;
  const [x, y] = [fold(a), fold(b)];
  return x === "." || y === "." || x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}
const samePosix = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const posixPrefix = (dir, p) => samePosix(dir, p) || (process.platform === "win32" ? p.toLowerCase().startsWith(dir.toLowerCase() + "/") : p.startsWith(dir + "/"));

export function artifactPaths(config, { lenient = false } = {}) {
  const given = config?.paths;
  const configured = given && typeof given === "object" && !Array.isArray(given) ? given : {};
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_PATHS)) {
    const value = configured[key] === undefined ? fallback : configured[key];
    try {
      const rel = repoRelative(value, `paths.${key}`, { exact: true }); // config values: the engine's language exactly (CR-079)
      // The plugin's own extra rule (not the engine's): an artifact is never the checkout itself.
      if (rel === ".") throw new Error(`paths.${key}: must not be the repo root`);
      out[key] = rel;
    } catch (e) {
      if (!lenient) throw e;
      out[key] = fallback;
    }
  }
  const overlap = (key) => {
    const p = out[key];
    if (key === "metadataDir") {
      for (const c of [...CURATED_KEYS.map((k) => out[k]), out.patternsPlan, CONFIG_REL]) if (posixPrefix(p, c)) return `paths.${key} ${JSON.stringify(p)} contains ${JSON.stringify(c)}`;
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
// absent, a symlink, not a regular file, or — without `truncate` — over the
// cap. With `truncate`, a file over the cap is read up to the cap only (never
// whole into memory) and cut back to the last complete line; the caller sees
// `{ text, truncated }` and says so in its own words (CR-086).
export function readInside(root, rel, maxBytes, label = rel, { truncate = false } = {}) {
  const abs = resolveInside(root, rel, label);
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  if (st.size <= maxBytes) {
    const text = readFileSync(abs, "utf8");
    return truncate ? { text, truncated: false } : text;
  }
  if (!truncate) return null;
  const buf = Buffer.alloc(maxBytes);
  const fd = openSync(abs, "r");
  let n;
  try {
    n = readSync(fd, buf, 0, maxBytes, 0);
  } finally {
    closeSync(fd);
  }
  const head = buf.subarray(0, n);
  const nl = head.lastIndexOf(0x0a);
  return { text: (nl > 0 ? head.subarray(0, nl) : head).toString("utf8"), truncated: true };
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
// Claude Code's config folder (2.2.1, CAS-101 smoke): an explicit home (the
// --home flag or ZDD_HOME, for tests) wins; else CLAUDE_CONFIG_DIR when set —
// Claude Code keeps its plugins and user settings there — else ~/.claude.
export function claudeDir(home) {
  const explicit = home || process.env.ZDD_HOME;
  if (explicit) return join(explicit, ".claude");
  if (process.env.CLAUDE_CONFIG_DIR) return resolve(process.env.CLAUDE_CONFIG_DIR);
  return join(homedir(), ".claude");
}
// The plugins folder (CR-201): CLAUDE_CODE_PLUGIN_CACHE_DIR moves it on its
// own — despite the name it is the parent of marketplaces/ and cache/ — else
// it sits under the config folder.
export function pluginsDir(home) {
  if (!(home || process.env.ZDD_HOME) && process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR) return resolve(process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR);
  return join(claudeDir(home), "plugins");
}
// The user settings file as a person should be told it (CR-204): the familiar
// name for the default profile, the real path for any other. An explicit home
// (--home, ZDD_HOME) stands in for `~` itself — that is how the tests stage a
// user — so `~/.claude/settings.json` is the true name relative to it; only
// CLAUDE_CONFIG_DIR puts the file somewhere `~` does not describe.
export function userSettingsLabel(home) {
  const custom = !(home || process.env.ZDD_HOME) && process.env.CLAUDE_CONFIG_DIR;
  return custom ? join(claudeDir(home), "settings.json") : "~/.claude/settings.json";
}

// A hook's JSON payload on stdin, or null — read up to a cap (CR-003).
export const MAX_STDIN_BYTES = 256 * 1024; // a hook payload is a few hundred bytes; over this is not a payload
export function readHookInput() {
  try {
    const chunks = [];
    let total = 0;
    const buf = Buffer.alloc(16 * 1024);
    for (;;) {
      let n;
      try {
        n = readSync(0, buf, 0, buf.length, null);
      } catch (e) {
        if (e.code === "EAGAIN") continue;
        if (e.code === "EOF") break;
        throw e;
      }
      if (n === 0) break;
      total += n;
      if (total > MAX_STDIN_BYTES) return null;
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
// The config folder a Claude Code hook's own transcript lives in (CR-202):
// <config>/projects/<project>/<session>.jsonl. CLAUDE_CODE_SUBPROCESS_ENV_SCRUB
// removes CLAUDE_CONFIG_DIR from hook environments; the payload still says
// where the session is. Null when the path does not have that shape.
export function configDirFromTranscript(input) {
  const p = typeof input?.transcript_path === "string" ? input.transcript_path : null;
  if (!p || p.length > 4096) return null;
  const project = dirname(resolve(p));
  const projects = dirname(project);
  return basename(projects) === "projects" ? dirname(projects) : null;
}

export function pocockLocations(root, home) {
  const claude = claudeDir(home);
  return {
    pluginCache: join(pluginsDir(home), "cache"),
    userSkill: join(claude, "skills", "domain-modeling", "SKILL.md"),
    codexSkill: join(home || process.env.ZDD_HOME || homedir(), ".codex", "skills", "domain-modeling", "SKILL.md"),
    projectSkill: join(root, ".claude", "skills", "domain-modeling", "SKILL.md"),
  };
}

// A hit in the plugin cache is one installed COPY of the plugin —
// `cache/<marketplace>/<plugin>/<version>/…` — and a copy that this repo's
// settings switch off is not what grill will run (CAS-103 finding 9: the
// switched-off official copy was reported "installed"). Every cache copy is
// named with its id, version and whether it is switched on here; a plain
// skill copy (a user, Codex or project skill) has no id and is simply there.
// `installed` means a copy grill can use is present; `pinned` that it is
// ZDD's own pinned copy.
export function findPocock(root, home) {
  const loc = pocockLocations(root, home);
  const pin = pocockPin();
  const ours = `${pin.plugin}@${pin.marketplace}`;
  const { enabled, unreadable } = effectiveEnabled(root, home);
  const hits = [];
  const plainFile = (p) => {
    try {
      return lstatSync(p).isFile();
    } catch {
      return false;
    }
  };
  for (const key of ["userSkill", "codexSkill", "projectSkill"]) if (plainFile(loc[key])) hits.push({ where: key, path: loc[key], id: null, version: null, enabled: null });
  // The pinned copy's own place first (CR-318): cache/<marketplace>/<plugin>/
  // <version>/…, so a bounded walk of a large cache can never miss it.
  const found = new Set();
  const pinnedDir = join(loc.pluginCache, pin.marketplace, pin.plugin);
  let versions = [];
  try {
    versions = readdirSync(pinnedDir).sort();
  } catch {
    versions = [];
  }
  // Each cached version on its own, so no number of versions hides one (verify CR-318).
  for (const v of versions) for (const p of findAllUnder(join(pinnedDir, v), ["domain-modeling", "SKILL.md"], 4)) found.add(p);
  for (const p of findAllUnder(loc.pluginCache, ["domain-modeling", "SKILL.md"], 8)) found.add(p);
  for (const path of [...found].sort()) {
    // A cache entry is a plugin only in the cache's own layout, reached
    // through real directories, ending at a regular file (CR-315).
    if (!plainFile(path) || !realDirs(loc.pluginCache, path)) continue;
    const [marketplace, plugin, version] = relative(loc.pluginCache, path).split(sep);
    const id = marketplace && plugin && SAFE_ID.test(`${plugin}@${marketplace}`) ? `${plugin}@${marketplace}` : null;
    if (!id) continue;
    // Unknown whenever a settings file could not be read (CR-413): a file
    // that takes precedence may say anything, so no lower one decides.
    const on = unreadable ? null : (enabled.get(id) ?? true);
    hits.push({ where: "pluginCache", path, id, version: typeof version === "string" ? version : null, enabled: on });
  }
  const usable = hits.filter((h) => h.enabled !== false && !(h.where === "pluginCache" && h.enabled === null));
  return { installed: usable.length > 0, pinned: usable.some((h) => h.id === ours), hits, unreadableSettings: unreadable, searched: Object.values(loc) };
}
// Every directory from `root` down to `path` (exclusive) is a real directory,
// no symlink on the way.
function realDirs(root, path) {
  let cur = root;
  for (const seg of relative(root, dirname(path)).split(sep)) {
    if (!seg) continue;
    cur = join(cur, seg);
    try {
      if (lstatSync(cur).isSymbolicLink()) return false;
    } catch {
      return false;
    }
  }
  return true;
}
// enabledPlugins, merged across the three settings files Claude Code reads
// (lowest precedence first). A plugin no file names is on — unless a file
// could not be read at all, which `unreadable` names (CR-315).
function effectiveEnabled(root, home) {
  const out = new Map();
  let unreadable = null;
  for (const s of settingsSources(root, home)) {
    let st = null;
    try {
      st = lstatSync(s.path);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const j = readJsonObject(s.path);
    if (!j) {
      unreadable = s.label;
      continue;
    }
    if (!isObject(j.enabledPlugins)) continue;
    for (const [id, v] of Object.entries(j.enabledPlugins)) if (typeof v === "boolean" && SAFE_ID.test(id)) out.set(id, v);
  }
  return { enabled: out, unreadable };
}
// Every `<dir>/…/<tail>` under dir, sorted, bounded by depth and by the
// number of directories visited (a plugin cache holds every version of every
// plugin; a session start must not stall in it).
const MAX_CACHE_DIRS = 2000;
function findAllUnder(dir, tail, depth) {
  const out = [];
  let visited = 0;
  const rec = (d, left) => {
    if (left < 0 || ++visited > MAX_CACHE_DIRS) return;
    const direct = join(d, ...tail);
    if (existsSync(direct)) {
      out.push(direct);
      return;
    }
    let entries;
    try {
      entries = readdirSync(d).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules") continue;
      const p = join(d, name);
      let isDir = false;
      try {
        isDir = lstatSync(p).isDirectory(); // lstat: a symlinked directory is never entered (CR-315)
      } catch {
        continue;
      }
      if (isDir) rec(p, left - 1);
    }
  };
  if (existsSync(dir)) rec(dir, depth);
  return out;
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

// ---------------------------------------------------------------------------
// The pinned Pocock release (CAS-93, decision 0014). pocock.json names the
// one mattpocock-skills release this plugin was tested with; the marketplace
// lists it and the zdd manifest depends on it (a test pins the three). Two
// enabled copies of one plugin name load as ONE, silently, so bootstrap
// switches the other known copies off per repo and pocockCopies() reports
// whatever is still switched on — from the three settings files Claude Code
// merges, lowest precedence first: user, project, local. Managed settings
// and the --settings flag are not files in the repo or home and are not read.
// ---------------------------------------------------------------------------
// The marketplace this plugin ships from, and whether a settings declaration
// of it points here (decision 0021): a GitHub source naming this repository,
// or its URL. Anything else — a fork, a mirror, a path — is the adopter's.
export const MARKETPLACE = "zero-drift-docs";
export const MARKETPLACE_REPO = "rich-rees/zero-drift-docs";
const OUR_URL = /^(?:https:\/\/|git@)github\.com[/:]rich-rees\/zero-drift-docs(?:\.git)?\/?$/i;
export function isOurDeclaration(decl) {
  const src = decl !== null && typeof decl === "object" && !Array.isArray(decl) ? decl.source : null;
  if (src === null || typeof src !== "object" || Array.isArray(src)) return false;
  if (src.source === "github") return typeof src.repo === "string" && src.repo.toLowerCase() === MARKETPLACE_REPO;
  return typeof src.url === "string" && OUR_URL.test(src.url);
}
export const ZDD_PLUGIN_ID = "zdd@zero-drift-docs";
export function pocockPin() {
  return JSON.parse(readFileSync(join(PLUGIN_ROOT, "pocock.json"), "utf8"));
}
// The enabledPlugins block bootstrap writes into a repo's .claude/settings.json.
export function pluginSettings() {
  const pin = pocockPin();
  return { [ZDD_PLUGIN_ID]: true, [`${pin.plugin}@${pin.marketplace}`]: true, ...Object.fromEntries(pin.otherCopies.map((id) => [id, false])) };
}

const settingsSources = (root, home) => [
  { source: "user", label: `${userSettingsLabel(home)}, user settings`, path: join(claudeDir(home), "settings.json") },
  { source: "project", label: ".claude/settings.json, project settings", path: join(root, ".claude", "settings.json") },
  { source: "local", label: ".claude/settings.local.json, local settings", path: join(root, ".claude", "settings.local.json") },
];
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function readJsonObject(path) {
  try {
    const st = lstatSync(path);
    if (!st.isFile() || st.size > MAX_CONFIG_BYTES) return null;
    const j = JSON.parse(readFileSync(path, "utf8"));
    return isObject(j) ? j : null;
  } catch {
    return null;
  }
}
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}@[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function installedVersions(home) {
  const out = new Map();
  const j = readJsonObject(join(pluginsDir(home), "installed_plugins.json"));
  if (!j || !isObject(j.plugins)) return out;
  for (const [id, rows] of Object.entries(j.plugins)) {
    if (!SAFE_ID.test(id) || !Array.isArray(rows)) continue;
    const row = rows.find((r) => isObject(r) && r.scope === "user") ?? rows.find(isObject);
    if (row && typeof row.version === "string" && row.version.length <= 64) out.set(id, row.version);
  }
  return out;
}
export function pocockCopies(root, home) {
  const pin = pocockPin();
  const ours = `${pin.plugin}@${pin.marketplace}`;
  const effective = new Map(); // id -> { value, source, label } from the highest-precedence file that names it
  for (const s of settingsSources(root, home)) {
    const j = readJsonObject(s.path);
    if (!j || !isObject(j.enabledPlugins)) continue;
    for (const [id, v] of Object.entries(j.enabledPlugins)) {
      if (typeof v !== "boolean" || !SAFE_ID.test(id) || !id.startsWith(`${pin.plugin}@`)) continue;
      effective.set(id, { value: v, source: s.source, label: s.label });
    }
  }
  const versions = installedVersions(home);
  const others = [...effective]
    .filter(([id, e]) => id !== ours && e.value)
    .map(([id, e]) => ({ id, version: versions.get(id) ?? null, source: e.source, label: e.label }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const mine = effective.get(ours);
  return {
    pinned: { id: ours, name: pin.plugin, version: pin.version, enabled: mine ? mine.value : true, source: mine?.source ?? null, label: mine?.label ?? null },
    others,
  };
}
