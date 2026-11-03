// The starter library, from the plugin's side (decision 0048 points 3, 4, 7
// and 8): where a version of it is found, what a copy in the app records,
// and how a record id moved between two derives. Bootstrap (apply, upgrade
// and `starters`) is the one writer; this module only reads and computes.
//
// A version of the library is found, in order:
//   1. ZDD_STARTER_ADAPTERS_DIR, a folder holding one staged library per
//      version, `<dir>/<X.Y.Z>/` (what the library's scripts/stage.mjs
//      writes): a test, or a dry run against an unpublished build;
//   2. the library beside this plugin (this repository's checkout), staged
//      into a temporary folder by its own stager, for the versions it can
//      stage (its baseline and its own);
//   3. npm: the pinned package at that version, installed with no scripts
//      into a temporary folder. npm checks the tarball against the
//      registry's integrity, and its own cache keeps a second fetch local.
// Whichever route, the folder must hold the package at exactly that version.
// Temporary folders are made private (mkdtemp) and removed on exit.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PLUGIN_ROOT, readJson } from "./repo.mjs";

export const STARTERS = readJson(join(PLUGIN_ROOT, "starter-adapters.json"));
export const SIBLING_LIBRARY = join(PLUGIN_ROOT, "..", "..", "packages", "zdd-starter-adapters");
// What a copy keeps beside the adapters, in the app's localExtractorDir: the
// library version each adapter came from and the hash of every file it
// copied, so a later move can tell an untouched copy from one the app edited.
export const RECORD = "starters.json";
export const DEFAULT_DIR = "zdd/extractors";
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const cmpVersions = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

const temps = [];
let cleanup = false;
function tempDir() {
  if (!cleanup) {
    cleanup = true;
    process.on("exit", () => {
      for (const d of temps) rmSync(d, { recursive: true, force: true });
    });
  }
  const d = mkdtempSync(join(tmpdir(), "zdd-starters-"));
  temps.push(d);
  return d;
}

// The folder `dir` as the library at `version`, or a reason it is not.
function check(dir, version) {
  let pkg;
  try {
    if (lstatSync(dir).isSymbolicLink()) return "it is a link";
    pkg = readJson(join(dir, "package.json"));
  } catch {
    return "it holds no package.json";
  }
  if (pkg?.name !== STARTERS.package) return `its package.json names ${JSON.stringify(pkg?.name)}, not ${STARTERS.package}`;
  if (pkg.version !== version) return `it is version ${JSON.stringify(pkg.version)}, not ${version}`;
  if (!existsSync(join(dir, "adapters")) || !existsSync(join(dir, "notes.json"))) return "it holds no adapters/ or no notes.json";
  return null;
}

function npmCommand(execPath = process.execPath, platform = process.platform) {
  if (platform !== "win32") return { cmd: "npm", pre: [], shell: false };
  const cli = join(dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(cli)) return { cmd: execPath, pre: [cli], shell: false };
  return { cmd: "npm.cmd", pre: [], shell: true };
}

export function npmFetch(version) {
  const out = tempDir();
  const npm = npmCommand();
  let args = [...npm.pre, "install", "--prefix", out, "--no-save", "--no-package-lock", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", `${STARTERS.package}@${version}`];
  // Through cmd.exe each argument is quoted, and one it would read differently is refused (as engineArgv does).
  if (npm.shell) {
    const bad = args.find((a) => /["%^!&|<>\r\n]/.test(a));
    if (bad !== undefined) throw new Error(`cannot run npm through cmd.exe with ${JSON.stringify(bad)} — install npm's npm-cli.js beside node`);
    args = args.map((a) => `"${a}"`);
  }
  execFileSync(npm.cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 300_000, shell: npm.shell, cwd: out });
  return join(out, "node_modules", ...STARTERS.package.split("/"));
}

function siblingStage(sibling, version) {
  const stager = join(sibling, "scripts", "stage.mjs");
  if (!existsSync(stager) || !existsSync(join(sibling, "package.json"))) return null;
  let own;
  try {
    own = readJson(join(sibling, "package.json"));
  } catch {
    return null;
  }
  if (own?.name !== STARTERS.package || (version !== STARTERS.baseline && version !== own.version)) return null;
  const out = join(tempDir(), "library");
  execFileSync(process.execPath, [stager, version, out], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 120_000 });
  return out;
}

const found = new Map();
// The library at `version`: { version, dir, adapters, notes }. Throws, in
// plain words, when no route has it.
export function starterLibrary(version = STARTERS.version, { env = process.env, sibling = SIBLING_LIBRARY, fetch = npmFetch } = {}) {
  if (!SEMVER.test(String(version))) throw new Error(`'${version}' is not a starter library version (X.Y.Z)`);
  const key = `${env.ZDD_STARTER_ADAPTERS_DIR ?? ""}\0${sibling}\0${version}`;
  if (found.has(key)) return found.get(key);
  let dir;
  let how;
  if (env.ZDD_STARTER_ADAPTERS_DIR) {
    dir = join(resolve(env.ZDD_STARTER_ADAPTERS_DIR), version);
    how = `ZDD_STARTER_ADAPTERS_DIR (${resolve(env.ZDD_STARTER_ADAPTERS_DIR)})`;
    const why = check(dir, version);
    if (why) throw new Error(`${how} holds no starter library ${version} at ${dir}: ${why} — stage one there (node packages/zdd-starter-adapters/scripts/stage.mjs ${version} <dir>/${version}), or unset it to fetch ${STARTERS.package}@${version} from npm`);
  } else {
    try {
      dir = siblingStage(sibling, version);
      how = "the library beside this plugin";
    } catch (e) {
      throw new Error(`the starter library beside this plugin could not stage ${version}: ${String(e.stderr || e.message).trim().split(/\r?\n/).slice(-2).join(" ")}`);
    }
    if (!dir) {
      how = `npm (${STARTERS.package}@${version})`;
      try {
        dir = fetch(version);
      } catch (e) {
        throw new Error(`the starter library (${STARTERS.package}@${version}) could not be fetched from npm: ${String(e.stderr || e.message).trim().split(/\r?\n/).slice(-2).join(" ")} — check this machine reaches the npm registry (bootstrap.mjs preflight), or set ZDD_STARTER_ADAPTERS_DIR to a folder of staged versions`);
      }
    }
    const why = check(dir, version);
    if (why) throw new Error(`${how} gave no starter library ${version}: ${why}`);
  }
  let notes;
  try {
    notes = readJson(join(dir, "notes.json"));
  } catch (e) {
    throw new Error(`the starter library ${version}'s notes.json cannot be read: ${e.message}`);
  }
  if (notes?.notes !== 1 || !Array.isArray(notes.versions)) throw new Error(`the starter library ${version}'s notes.json is not a shape this plugin reads ("notes": 1)`);
  const lib = { version, dir, adapters: join(dir, "adapters"), notes, how };
  found.set(key, lib);
  return lib;
}

// A file's hash as a copy records it: line endings aside, so a checkout
// that writes CRLF reads as the same copy.
// latin1 maps each byte to one character and back, so a binary file hashes
// as its bytes.
export const fileHash = (content) => {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  return createHash("sha256").update(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1").digest("hex");
};

// The record a copy keeps (RECORD), read leniently: absent is an empty one;
// a record that cannot be read throws, because a move must never guess
// which files are untouched.
export function emptyRecord() {
  return { _comment: "Written by Zero-Drift Docs when it copies a starter into this folder (decision 0048): the starter library version each adapter came from, and a hash of every file it copied, so a later fix can tell an untouched copy from one you changed. The adapters are yours; edit them freely.", starters: 1, package: STARTERS.package, adapters: {}, files: {} };
}
export function parseRecord(text, where) {
  let r;
  try {
    r = JSON.parse(text);
  } catch (e) {
    throw new Error(`${where} cannot be read as JSON (${e.message}) — fix or remove it by hand; ZDD never guesses which adapter files are untouched`);
  }
  const obj = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!obj(r) || r.starters !== 1 || !obj(r.adapters) || !obj(r.files)) throw new Error(`${where} is not a record ZDD wrote ("starters": 1, with adapters and files) — fix or remove it by hand`);
  for (const [name, a] of Object.entries(r.adapters)) {
    if (!obj(a) || !SEMVER.test(String(a.version))) throw new Error(`${where}: adapters.${name} must carry the version it came from`);
  }
  for (const [f, h] of Object.entries(r.files)) if (typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h)) throw new Error(`${where}: files[${JSON.stringify(f)}] must be a SHA-256`);
  return r;
}

// The fixes notes.json offers a copy at `from` for one starter: every
// version after `from` up to `to`, with what changed, who it affects and how
// ids move. A declined version and the ones before it are not offered again.
export function fixesFor(notes, name, from, to, declined = null) {
  const out = [];
  for (const v of notes.versions ?? []) {
    if (!SEMVER.test(String(v.version)) || cmpVersions(v.version, from) <= 0 || cmpVersions(v.version, to) > 0) continue;
    if (declined && SEMVER.test(declined) && cmpVersions(v.version, declined) <= 0) continue;
    const fixes = v.starters?.[name]?.fixes;
    if (Array.isArray(fixes) && fixes.length) out.push({ version: v.version, summary: v.summary, fixes: fixes.map((f) => ({ what: String(f.what), who: String(f.who), moves: String(f.moves) })) });
  }
  return out;
}

// How record ids moved between two derives (decision 0048, As built slice
// 2, the notes' `moves`): an id that is gone and one, of the same kind and
// namespace, whose name is the same once a schema before the first dot is
// set aside. That covers a renamed record gaining its schema and two
// spellings of one name becoming one record. Anything else that is gone is
// named, never guessed. `before` and `after` map id → record file.
const ID = /^([a-z][a-z0-9-]*):([^/]+)\/(.+)$/;
const bare = (name) => (name.includes(".") ? name.slice(name.indexOf(".") + 1) : name).toLowerCase();
export function movedIds(before, after) {
  const moves = [];
  const unmatched = [];
  const byKey = new Map();
  for (const id of after.keys()) {
    const m = ID.exec(id);
    if (!m) continue;
    const k = `${m[1]}\0${m[2]}\0${bare(m[3])}`;
    byKey.set(k, [...(byKey.get(k) ?? []), id]);
  }
  for (const id of [...before.keys()].sort()) {
    if (after.has(id)) continue;
    const m = ID.exec(id);
    const hits = m ? (byKey.get(`${m[1]}\0${m[2]}\0${bare(m[3])}`) ?? []) : [];
    if (hits.length === 1) moves.push({ from: id, to: hits[0], fromFile: before.get(id), toFile: after.get(hits[0]) });
    else unmatched.push(id);
  }
  return { moves, unmatched };
}
