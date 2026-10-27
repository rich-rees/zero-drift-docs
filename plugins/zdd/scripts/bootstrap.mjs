#!/usr/bin/env node
// The bootstrap runbook's deterministic half. The `bootstrap` skill is the
// conversation — it asks the questions — and this script is the only thing
// that reads the adopter's stack and writes into the adopter's repo. Splitting
// it this way is what makes the runbook testable at the file seam: drive the
// script with a scripted answer set against a fixture repo and assert what
// landed on disk, no LLM in the loop.
//
//   bootstrap.mjs detect  [--root=<dir>] [--home=<dir>] [--json]
//       Scan for each extractor's convention. Prints a proposal — extractor
//       set + options, with the EVIDENCE for each — or "greenfield" when there
//       is no source to read. Also reports whether the mattpocock-skills
//       plugin is installed (the recommendation step). Writes nothing.
//
//   bootstrap.mjs apply --answers=<file.json> [--root=<dir>] [--date=YYYY-MM-DD] [--json]
//       Write the setup from an answer set (shape below). Idempotent: an
//       artifact that already exists is KEPT, never overwritten — curated
//       content is the adopter's, and a second run only fills gaps. On a repo
//       that already has a config (repair), an omitted answer keeps the
//       current choice; only an explicit answer changes it.
//
//   bootstrap.mjs preflight [--registry=<url>] [--github=<url>] [--json]
//       Every piece of tech ZDD needs, checked before a question is asked
//       (2.3.0, C7): Node.js 20+, npx, git and a git repository, reachability
//       of github.com and the npm registry, and that the pinned engine is
//       there to download. Each failure says what is missing, what ZDD uses
//       it for, how to get it, and that nothing was written. Exit 1 on any.
//
//   bootstrap.mjs estimate [--root=<dir>] [--json]
//       Sizes the repo for the three install scenarios (greenfield, a young
//       app, a mature codebase) and the opt-in backfill: source files,
//       commits, age, and an honest estimate of the user's review time.
//
//   bootstrap.mjs adapters [--raise] [--root=<dir>] [--json]
//       The adapters this repo wrote itself, through the engine's standard
//       suite (decision 0040): each one's contract, the steps of the
//       contract it is behind on with the question to ask about each, and
//       every check it fails with what to fix. The upgrade skill's interview
//       reads this. `--raise` writes `suiteChecks` up to the engine's count
//       once every check passes — from then on the newer checks block in CI.
//
//   bootstrap.mjs upgrade [--plan] [--lock] [--drop=<ids>]
//                         [--move-blessings=<token> [--kinds=<name>:<copy|extend>,…]]
//                         [--to=vX.Y.Z] [--root=<dir>] [--json]
//       The only later writer into an adopter's repo. Migrates `adapter` →
//       `extractors`, moves `viewer.nonAreaTags` to the top level, rewrites
//       every plugin-OWNED file (engine pins, the managed hook, the marked
//       snippet blocks) to this plugin's version, moves our release lock's
//       ref (decision 0021; `--lock` writes an absent one, on the user's
//       word), and names every file it changed. It touches a curated
//       artifact only by two mechanical moves, each named: a map link to a
//       record whose kind a release renamed (2.3), and — with the token the
//       plan printed — blessings out of the map into the blessing store
//       (2.5, decision 0032). Never a file it does not own otherwise.
//
// Trust: the answer set, the existing config, and everything in the checkout
// are untrusted input. Answers are validated whole before the first write;
// a config that exists but cannot be read stops the run; every path is
// validated repo-relative and resolved through resolveInside (no escape, no
// symlink); files the plugin writes carry an ownership line and only owned
// files are ever rewritten (review CR-002..CR-013, CR-029).
//
// Answer set (every key optional):
//   {
//     "name": "My App", "repoBase": "https://github.com/o/r/tree/main/", "baseBranch": "main",
//     "extractors": ["<adapter>", "<adapter>"],      // else derived from `stack`, else the detection
//     "extractorOptions": { ... },                     // else defaults per extractor
//     "stack": ["<a framework>", "<a database>", "<an app>"],   // greenfield answers; strings or {name, path}, matched by the adapters' rules
//     "apps": ["Web", "Mobile"],                       // map skeleton (Application concepts); else from `stack` / detection
//     "optIns": { "autoLoad": true, "fence": true, "stop": true, "ci": true, "prePush": true },   // defaults: all on (repair: current state)
//     "codex": false,                                  // also write AGENTS.md
//     "seedAdr": true                                  // ADR-0001 "Adopt Zero-Drift Docs"
//   }

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, lstatSync, chmodSync, openSync, writeSync, closeSync, rmSync, opendirSync } from "node:fs";
import { findMapBlessings, proposeMove, blessingSlug, blessingFileText, removeMoved } from "./lib/blessing-move.mjs";
import { scopeTag, repointLinks, linksToMoved } from "./lib/adr-split.mjs";
import { join, dirname, basename, relative, resolve, posix } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  PLUGIN_ROOT,
  ENGINE_PACKAGE,
  pluginVersion,
  parseArgs,
  adopterRoot,
  readJson,
  readConfig,
  artifactPaths,
  repoRelative,
  resolveInside,
  findPocock,
  posixify,
  pocockPin,
  pluginSettings,
  ZDD_PLUGIN_ID,
  MARKETPLACE,
  MARKETPLACE_REPO,
  isOurDeclaration,
  pluginsDir,
  agentIndexAreaDir,
} from "./lib/repo.mjs";

const TEMPLATES = join(PLUGIN_ROOT, "templates");
const SNIPPET_BEGIN = "<!-- zdd:begin -->";
const SNIPPET_END = "<!-- zdd:end -->";
// ZDD's instructions live in a file of their own (2.3, 2.3.0, C10): ZDD owns
// `<bundleDir>/instructions.md` and rewrites it on every upgrade; the
// adopter's CLAUDE.md carries ONE line, Claude Code's `@path` import, which
// inlines the file at session start — so the rules stay always-loaded, and
// everything else in CLAUDE.md is the adopter's by definition. Codex has no
// import directive (its AGENTS.md loader concatenates plain Markdown), so
// AGENTS.md keeps a managed copy between the zdd:begin / zdd:end markers.
export const INSTRUCTIONS_NAME = "instructions.md";
// A bundle at the repo root puts the file at the root too (CR-411).
export const instructionsRel = (bundleDir) => (!bundleDir || bundleDir === "." ? INSTRUCTIONS_NAME : `${bundleDir}/${INSTRUCTIONS_NAME}`);
export const importLine = (bundleDir) => `@${instructionsRel(bundleDir)}`;
export const IMPORT_COMMENT = "<!-- Zero-Drift Docs: the line below loads ZDD's instructions into every session. ZDD owns that file and rewrites it on upgrade; everything else in this file is yours. -->";
const IMPORT_LINE_RE = /^@\S+\/instructions\.md\r?$/m;
const LEGACY_SNIPPET_HEADING = "## Documentation — Zero-Drift Docs (ZDD)";
// The v0.3.1 snippet's fingerprint. Replacement needs the whole section to
// equal the v0.3.1 snippet modulo whitespace (CR-080, isLegacySnippet below);
// the fingerprint only decides whether a section that is NOT replaced gets
// the "legacy section left in place" note (both bullets present ⇒ it started
// as ours and was edited) or is simply the adopter's own heading (CR-011).
const LEGACY_FINGERPRINT = ["/zdd:orient", "/zdd:update"];
// Ownership line carried by every file the plugin writes besides config.
export const OWNER_MARK = "Managed by Zero-Drift Docs (zdd)";
const MAX_NAME = 120;
const MAX_SCAN_BYTES = 1024 * 1024; // the plugin never reads a repo file larger than this (CR-091)

// border: names a stack (the pre-1.0 bundle an upgrade migrates)
// Mirror of the engine catalogue's bundles (src/adapters/catalogue.json): the one legacy
// adapter and how its options split. The engine expands it at derive time;
// this is the migration that makes the expansion unnecessary.
const LEGACY_ADAPTERS = {
  "nextjs-supabase": {
    extractors: ["supabase", "supabase-js", "nextjs"],
    split(options = {}) {
      const { migrationNamespaces = [], externalBuckets = [], ...nextjs } = options;
      return { supabase: { migrationNamespaces, externalBuckets }, nextjs };
    },
  },
};
// border: end

// ---------------------------------------------------------------------------
// Detection — asked of the adapters (decision 0039). Each catalogue adapter
// carries its own: the evidence that it fits, the options it would use and
// the parts of the app it covers. The plugin carries no engine, so it runs
// the engine of its own release and reads the answer; it names no stack.
//
// Which engine: ZDD_ENGINE_BIN, when set, names an engine checkout's bin (a
// test, a dry run against another build) — accepted only when it is an
// engine's own `bin/zdd-engine.mjs`, a regular file in a package named for
// the engine (CR-097: whoever sets the environment already chooses PATH, so
// this is no new boundary, but a stray value is refused, not run); else the
// engine beside this plugin when one ships with it at the same version (this
// repository's own checkout); else the pinned package under npx, as every
// skill runs it. On Windows npx is a .cmd file, and cmd.exe neither keeps a
// quote inside an argument nor leaves `%NAME%` alone, so npm's own
// `npx-cli.js` beside node runs instead, with no shell (CR-096); only when it
// is missing does cmd.exe run npx, and then an argument cmd.exe would change
// is refused before anything runs.
// ---------------------------------------------------------------------------
const SIBLING_ENGINE = join(PLUGIN_ROOT, "..", "..", "packages", "zdd-engine");
export function engineCommand({ env = process.env, platform = process.platform, execPath = process.execPath, sibling: siblingDir = SIBLING_ENGINE } = {}) {
  if (env.ZDD_ENGINE_BIN) {
    const given = resolve(env.ZDD_ENGINE_BIN);
    let pkg = null;
    try {
      const st = lstatSync(given);
      if (basename(given) === "zdd-engine.mjs" && basename(dirname(given)) === "bin" && st.isFile()) pkg = readJson(join(dirname(dirname(given)), "package.json"));
    } catch {
      pkg = null;
    }
    if (pkg?.name !== ENGINE_PACKAGE) throw new Error(`ZDD_ENGINE_BIN (${given}) is not an engine's bin/zdd-engine.mjs in a ${ENGINE_PACKAGE} package — unset it, or point it at one`);
    return { cmd: execPath, pre: [given], shell: false };
  }
  const bin = join(siblingDir, "bin", "zdd-engine.mjs");
  let sibling = null;
  try {
    sibling = existsSync(bin) ? readJson(join(siblingDir, "package.json")) : null;
  } catch {
    sibling = null;
  }
  if (sibling?.name === ENGINE_PACKAGE && sibling.version === pluginVersion()) return { cmd: execPath, pre: [bin], shell: false };
  const pkg = `${ENGINE_PACKAGE}@${pluginVersion()}`;
  if (platform !== "win32") return { cmd: "npx", pre: ["-y", pkg], shell: false };
  const cli = join(dirname(execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (existsSync(cli)) return { cmd: execPath, pre: [cli, "-y", pkg], shell: false };
  return { cmd: "npx.cmd", pre: ["-y", pkg], shell: true };
}
// What cmd.exe would change or act on inside a quoted argument.
const CMD_UNSAFE = /["%^!&|<>\r\n]/;
// The command line `runEngine` would run: through cmd.exe each argument is
// quoted, and one cmd.exe would read differently is refused (CR-096).
export function engineArgv(command, args) {
  const all = [...command.pre, ...args].map(String);
  if (!command.shell) return all;
  const bad = all.find((a) => CMD_UNSAFE.test(a));
  if (bad !== undefined) throw new Error(`cannot run the engine through cmd.exe with ${JSON.stringify(bad)}: it holds a character cmd.exe would read (a quote, %, ^, !, &, |, <, >) — move the repo to a path without one, or install npm's npx-cli.js beside node`);
  return all.map((a) => `"${a}"`);
}
export function runEngine(args) {
  const command = engineCommand();
  return execFileSync(command.cmd, engineArgv(command, args), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: 300_000, shell: command.shell });
}

export function detect(root) {
  let d;
  try {
    d = JSON.parse(runEngine(["detect", `--root=${root}`]));
  } catch (e) {
    throw new Error(`detection could not run — the engine said: ${String(e.stderr || e.message).trim().split(/\r?\n/).slice(-3).join(" ")}`);
  }
  return { ...d, host: repoHost(root) };
}

// Where the repo is hosted (2.3.0, C6): the shipped CI workflow runs only on
// GitHub Actions, so the CI offer depends on this. From the origin remote;
// a repo with no remote yet (greenfield) is "none" and keeps the GitHub
// default, which the skill then asks about.
export function hostOf(remote) {
  if (typeof remote !== "string" || !remote.trim()) return { kind: "none", remote: null };
  const r = remote.trim();
  // border: names a stack (git hosts, for the CI offer — not the app's stack)
  const kind = /(^|[@/.])github\.com([:/]|$)/i.test(r) ? "github"
    : /(^|[@/.])gitlab\.com([:/]|$)/i.test(r) ? "gitlab"
    : /dev\.azure\.com|visualstudio\.com/i.test(r) ? "azure"
    : /(^|[@/.])bitbucket\.org([:/]|$)/i.test(r) ? "bitbucket"
    : "other";
  // border: end
  return { kind, remote: r };
}
function repoHost(root) {
  if (!hasGit(root)) return hostOf(null);
  try {
    return hostOf(execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }));
  } catch {
    return hostOf(null);
  }
}

// ---------------------------------------------------------------------------
// Greenfield: the answers name a stack; each entry selects an adapter at its
// future path, or names an Application concept for the map when no adapter
// fits. The rules are the adapters' own (DETECTION.stack, read through the
// engine's detection), tried in rank order; a companion adapter joins when
// the stack holds what it needs (a data-access adapter beside its schema
// adapter and an app that runs the calls, CR-045). The neutral list of stacks with adapters is the same data.
// ---------------------------------------------------------------------------
// Unique names, checked against the whole set: a raw `foo-2` sitting next to
// two `foo`s cannot be collided into (review CR-047).
function dedupe(names) {
  const taken = new Set(names); // every raw name is reserved before any suffix is minted
  const seen = new Set();
  return names.map((n) => {
    if (!seen.has(n)) {
      seen.add(n);
      return n;
    }
    let candidate;
    for (let i = 2; taken.has((candidate = `${n}-${i}`)); i++);
    taken.add(candidate);
    return candidate;
  });
}

// Put `value` at `path` (keys and array indexes) inside `obj`.
function setAt(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  cur[path.at(-1)] = value;
}

function fromStack(stack = [], { stacks = [], companions = [] } = {}) {
  const extractors = [];
  const extractorOptions = {};
  const apps = [];
  for (const entry of stack) {
    const name = typeof entry === "string" ? entry : entry.name;
    const path = typeof entry === "string" || entry.path === undefined ? undefined : repoRelative(entry.path, `stack entry ${name} path`);
    const rule = stacks.find((r) => new RegExp(r.match, "i").test(name));
    if (!rule) {
      apps.push(name);
      continue;
    }
    if (rule.app && !apps.includes(rule.app)) apps.push(rule.app);
    if (!rule.adapter || !rule.options) continue;
    const opts = structuredClone(rule.options);
    if (path !== undefined && rule.path) setAt(opts, rule.path, path);
    if (!extractors.includes(rule.adapter)) {
      extractors.push(rule.adapter);
      extractorOptions[rule.adapter] = opts;
      continue;
    }
    // A second entry for the same adapter adds its path (CR-042).
    const cur = extractorOptions[rule.adapter];
    for (const [k, v] of Object.entries(opts)) {
      if (Array.isArray(v) && Array.isArray(cur[k])) {
        for (const item of v) if (!cur[k].some((x) => JSON.stringify(x) === JSON.stringify(item))) cur[k].push(item);
        // Items that carry a name keep the names unique (several migration folders).
        if (cur[k].every((x) => x && typeof x === "object" && typeof x.name === "string")) {
          const names = dedupe(cur[k].map((x) => x.name));
          cur[k].forEach((x, i) => (x.name = names[i]));
        }
      } else if (JSON.stringify(cur[k]) !== JSON.stringify(v)) {
        fail(`two stack entries give different ${rule.adapter}.${k} (${JSON.stringify(cur[k])} vs ${JSON.stringify(v)}) — an extractor has one ${k}; choose one`);
      }
    }
  }
  for (const c of companions) {
    if (extractors.includes(c.adapter) || !c.all.every((n) => extractors.includes(n)) || !c.any.some((n) => extractors.includes(n))) continue;
    extractors.splice(extractors.indexOf(c.all[0]) + 1, 0, c.adapter);
    extractorOptions[c.adapter] = {};
  }
  return { extractors, extractorOptions, apps };
}

// ---------------------------------------------------------------------------
// Answer validation — the whole set, before the first write (CR-029, CR-009).
// ---------------------------------------------------------------------------
const isName = (s) => typeof s === "string" && s.length > 0 && s.length <= MAX_NAME && !/[\x00-\x1f\x7f]/.test(s) && s.trim() === s;
const fail = (msg) => {
  throw new Error(`answers: ${msg}`);
};

// Mirrors of the ENGINE's rules (src/core/lib/config.mjs validateRepoBase and
// src/core/lib/paths.mjs repoRelative), applied to the answers so a config the
// engine's first derive would refuse is never written (CR-078). The engine's
// path rule is stricter than the plugin's repoRelative in lib/repo.mjs (no
// whitespace, no backslash) and looser in one spot (`.` is a valid root — an
// adapter's default), and the option values land in config.json verbatim, so
// the engine's rule is the one that applies here.
const ENGINE_REPO_BASE = /^https?:\/\/\S+$/i;
function enginePath(value, label) {
  const bad = () => fail(`${label} ${JSON.stringify(value)} must be repo-relative (no absolute path, drive letter, URL scheme, backslash, whitespace or '..')`);
  if (typeof value !== "string" || !value.length) bad();
  if (/[\s\x00-\x1f\x7f]/.test(value)) bad();
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) bad();
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) bad();
  if (value.split("/").some((s) => s === "..")) bad();
  return value;
}
// The path-bearing option keys of each catalogue adapter come from its own
// option shape (DETECTION.optionShape, read through the engine's detection).
// A local extractor's options are its own; only catalogue ones are inspected.
const isCallList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0 && s.length <= MAX_NAME);

function validateExtractorOptions(all, adapters = {}) {
  const obj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const list = (v, label) => {
    if (!Array.isArray(v)) fail(`${label} must be an array of repo-relative paths`);
    v.forEach((p, i) => enginePath(p, `${label}[${i}]`));
  };
  const calls = (v, label, grammar) => {
    if (v !== undefined && !isCallList(v)) fail(`${label} must be an array of call names (strings), e.g. ["live.onInsert"]`); // CR-011
    // The adapter's own grammar for a call name (CR-102): a name outside it is ignored by the engine.
    const re = grammar ? new RegExp(grammar) : null;
    const bad = v === undefined || !re ? undefined : v.find((s) => !re.test(s));
    if (bad !== undefined) fail(`${label}: ${JSON.stringify(bad)} is not a call name the adapter reads (dotted identifiers, e.g. "live.onInsert")`);
  };
  for (const [name, opts] of Object.entries(all)) {
    if (!obj(opts)) fail(`extractorOptions.${name} must be an object`);
    const shape = adapters[Object.hasOwn(RENAMED_EXTRACTORS, name) ? RENAMED_EXTRACTORS[name] : name]?.optionShape;
    if (!shape) continue;
    // A dotted key's value, after checking every parent on the way is an object.
    const at = (key) => {
      let cur = opts;
      const segs = key.split(".");
      for (let i = 0; i < segs.length - 1; i++) {
        cur = cur[segs[i]];
        if (cur === undefined) return undefined;
        if (!obj(cur)) fail(`${name}.${segs.slice(0, i + 1).join(".")} must be an object`);
      }
      return cur[segs.at(-1)];
    };
    for (const k of shape.paths ?? []) if (at(k) !== undefined) enginePath(at(k), `${name}.${k}`);
    for (const k of shape.pathLists ?? []) if (at(k) !== undefined) list(at(k), `${name}.${k}`);
    for (const k of shape.callLists ?? []) calls(at(k), `${name}.${k}`, shape.callName);
    // A list of objects: each `required` key is a repo-relative path, each
    // `optional` one is when present (CR-101).
    for (const [k, keys] of Object.entries(shape.objectLists ?? {})) {
      const v = at(k);
      if (v === undefined) continue;
      if (!Array.isArray(v)) fail(`${name}.${k} must be an array`);
      v.forEach((item, i) => {
        if (!obj(item)) fail(`${name}.${k}[${i}] must be an object`);
        for (const pk of keys.required ?? []) enginePath(item[pk], `${name}.${k}[${i}].${pk}`);
        for (const pk of keys.optional ?? []) if (item[pk] !== undefined) enginePath(item[pk], `${name}.${k}[${i}].${pk}`);
      });
    }
  }
}

// The options about to be written, whatever their source — an answer, the
// detection, a stated stack — checked as an answer is (CR-100): a detected
// path the engine would refuse (a folder name with a space) stops the run
// before the first write, never after.
function finalOptions(options, adapters) {
  try {
    validateExtractorOptions(options, adapters);
  } catch (e) {
    throw new Error(`${e.message.replace(/^answers: /, "the extractor options to write: ")} — the engine would refuse this config; nothing was written. Correct it in the answers' extractorOptions`);
  }
}

export function validateAnswers(a, adapters = {}) {
  if (!a || typeof a !== "object" || Array.isArray(a)) fail("must be a JSON object");
  for (const k of ["name", "repoBase", "baseBranch"]) if (a[k] !== undefined && !isName(a[k])) fail(`${k} must be a single-line string (≤${MAX_NAME} chars)`);
  if (a.repoBase !== undefined && a.repoBase !== "" && !ENGINE_REPO_BASE.test(a.repoBase)) fail("repoBase must be an http(s) URL with no whitespace, or empty (the engine's rule)");
  if (a.extractors !== undefined) {
    if (!Array.isArray(a.extractors) || !a.extractors.every((n) => typeof n === "string" && /^[a-z][a-z0-9-]*$/.test(n))) fail("extractors must be an array of extractor names");
    if (new Set(a.extractors).size !== a.extractors.length) fail("extractors lists a name twice");
  }
  if (a.extractorOptions !== undefined) {
    if (!a.extractorOptions || typeof a.extractorOptions !== "object" || Array.isArray(a.extractorOptions)) fail("extractorOptions must be an object");
    validateExtractorOptions(a.extractorOptions, adapters);
  }
  if (a.stack !== undefined) {
    if (!Array.isArray(a.stack)) fail("stack must be an array");
    for (const e of a.stack) {
      if (isName(e)) continue;
      if (!e || typeof e !== "object" || !isName(e.name)) fail("each stack entry is a name or { name, path }");
      if (e.path !== undefined) repoRelative(e.path, `stack entry ${e.name} path`);
    }
  }
  if (a.apps !== undefined && (!Array.isArray(a.apps) || !a.apps.every(isName))) fail("apps must be an array of single-line names");
  if (a.optIns !== undefined) {
    if (!a.optIns || typeof a.optIns !== "object" || Array.isArray(a.optIns)) fail("optIns must be an object");
    for (const [k, v] of Object.entries(a.optIns)) {
      if (!["autoLoad", "fence", "stop", "ci", "prePush"].includes(k)) fail(`optIns.${k} is not an opt-in`);
      if (typeof v !== "boolean") fail(`optIns.${k} must be true or false`);
    }
  }
  for (const k of ["codex", "seedAdr"]) if (a[k] !== undefined && typeof a[k] !== "boolean") fail(`${k} must be true or false`);
  return a;
}

// ---------------------------------------------------------------------------
// Writers. Every one reports what it did to the ledger — wrote / kept /
// skipped — so the runbook can narrate and the tests can assert. Every path
// goes through resolveInside; a new file is created exclusively (`wx`) so a
// file that appears between the check and the write is kept, not clobbered
// (CR-010).
// ---------------------------------------------------------------------------
export class Ledger {
  // dryRun (`upgrade --plan`, 2.2.0): every write is recorded, none lands;
  // a later read of a file this run "wrote" sees the pending content, so a
  // plan computes exactly what the real run will.
  constructor(root, { dryRun = false } = {}) {
    this.root = root;
    this.dryRun = dryRun;
    this.pending = new Map();
    this.wrote = [];
    this.kept = [];
    this.skipped = [];
    this.notes = [];
    this.removed = [];
    this.gone = new Set();
  }
  // A file removed by a move (the ADR split, decision 0034): recorded, and in
  // a dry run only marked gone, so a later read in the same plan agrees.
  remove(rel) {
    const path = this.abs(rel);
    if (!this.removed.includes(rel)) this.removed.push(rel);
    this.pending.delete(rel);
    if (this.dryRun) return void this.gone.add(rel);
    rmSync(path);
  }
  abs(rel) {
    return resolveInside(this.root, rel, rel);
  }
  overwrite(rel, content) {
    const path = this.abs(rel);
    if (!this.wrote.includes(rel)) this.wrote.push(rel);
    if (this.dryRun) return void this.pending.set(rel, content);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  create(rel, content, { executable = false } = {}) {
    if (this.dryRun) {
      if (this.exists(rel)) {
        this.kept.push(rel);
        return false;
      }
      this.pending.set(rel, content);
      this.wrote.push(rel);
      return true;
    }
    const path = this.abs(rel);
    mkdirSync(dirname(path), { recursive: true });
    let fd;
    try {
      fd = openSync(path, "wx");
    } catch (e) {
      if (e.code === "EEXIST") {
        this.kept.push(rel);
        return false;
      }
      throw e;
    }
    try {
      writeSync(fd, content);
    } finally {
      closeSync(fd);
    }
    if (executable) {
      try {
        chmodSync(path, 0o755);
      } catch {
        /* windows */
      }
    }
    this.wrote.push(rel);
    return true;
  }
  exists(rel) {
    if (this.pending.has(rel)) return true;
    if (this.gone.has(rel)) return false;
    try {
      return lstatSync(this.abs(rel)).isFile();
    } catch {
      return false;
    }
  }
  read(rel) {
    return this.pending.has(rel) ? this.pending.get(rel) : readFileSync(this.abs(rel), "utf8");
  }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "app";

const yamlScalar = (s) => JSON.stringify(s); // a JSON string is a valid YAML double-quoted scalar

// The instructions body (templates/instructions.md); the two shapes it is
// written in: the file itself (a header comment, then the body) and the
// AGENTS.md block (markers around a header and the body).
// The template names the artifacts by placeholder (`<GLOSSARY>` …), filled
// from the adopter's configured paths (CR-412): a repo that moved its
// glossary is told where its glossary is. No argument: the defaults.
export function instructionsBody(paths = artifactPaths({})) {
  const p = { ...artifactPaths({}), ...paths };
  // Replacement functions, so a `$` in a configured path is a `$` (CR-520).
  const lit = (s) => () => s;
  return readFileSync(join(TEMPLATES, "instructions.md"), "utf8")
    .replaceAll("<GLOSSARY>", lit(p.glossary))
    // The harness ADR set (decision 0033), only when configured: a repo
    // without one reads the 2.4 sentences exactly.
    .replaceAll("<HARNESS_ADR_LOAD>", lit(p.harnessAdrIndex ? ` (and \`${p.harnessAdrIndex}\`, the harness decisions, when the work touches how the team builds)` : ""))
    .replaceAll("<HARNESS_ADR_INDEX_ITEM>", lit(p.harnessAdrIndex ? ` \`${p.harnessAdrIndex}\`,` : ""))
    .replaceAll("<ADR_INDEX>", lit(p.adrIndex))
    .replaceAll("<BLESSING_INDEX>", lit(p.blessingIndex))
    .replaceAll("<PATTERNS_PLAN>", lit(p.patternsPlan))
    .replaceAll("<METADATA_DIR>", lit(p.metadataDir))
    .replaceAll("<GRAPH>", lit(p.graph))
    // The two-level index's area folder (2.4.1, from the first adopter): named as
    // the engine names it — the index path without its extension.
    .replaceAll("<AGENT_INDEX_DIR>", lit(agentIndexAreaDir(p.agentIndex)))
    .replaceAll("<AGENT_INDEX>", lit(p.agentIndex))
    .replaceAll("<HUMAN_INDEX>", lit(p.humanIndex))
    .replaceAll("<BUNDLE_DIR>", lit(p.bundleDir === "." ? "." : p.bundleDir))
    .replaceAll("<INSTRUCTIONS>", lit(instructionsRel(p.bundleDir)));
}
export function instructionsFileText(paths) {
  return `<!-- ${OWNER_MARK}: "upgrade ZDD" rewrites this whole file. Never hand-edit it; your own rules belong in CLAUDE.md, which ZDD never edits after install. -->\n` + instructionsBody(paths);
}
function snippetText(paths) {
  return `${SNIPPET_BEGIN}\n<!-- ${OWNER_MARK}: "upgrade ZDD" rewrites everything between the zdd:begin and zdd:end markers. Codex has no file import, so this is a copy of ${instructionsRel((paths ?? artifactPaths({})).bundleDir)}. -->\n` + instructionsBody(paths).trimEnd() + `\n${SNIPPET_END}\n`;
}
// Ownership is the HEADER — the mark within the first three lines — not the
// phrase anywhere in the file (CR-006).
const isOwned = (text) => text.split(/\r?\n/, 3).some((l) => l.includes(OWNER_MARK));

// The v0.3.1 workflow template carried neither the ownership line nor a pin,
// so ownership of it is decided by content: sha256 of the file normalised to
// LF, trailing whitespace stripped, one final newline. Regenerate the constant
// with `git show v0.3.1:plugins/zdd/templates/zdd.yml` through normaliseText
// (the test fixture at test/fixtures/v0.3.1/zdd.yml is that exact file).
const LEGACY_WORKFLOW_SHA256 = "a5e8672339dc570c8c154ffed09f01e715f627116f96ec1ef508895a3b906653";
const normaliseText = (s) =>
  s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim() + "\n";
const isLegacyWorkflow = (text) => createHash("sha256").update(normaliseText(text)).digest("hex") === LEGACY_WORKFLOW_SHA256;
// Same idea for the v0.3.1 CLAUDE.md snippet, compared modulo ALL whitespace
// (editors reflow prose; a reflowed stock section is still stock — CR-080).
// Regenerate with `git show v0.3.1:plugins/zdd/templates/claude-md-snippet.md`
// through collapseWhitespace (fixture: test/fixtures/v0.3.1/claude-md-snippet.md).
const LEGACY_SNIPPET_SHA256 = "d4dca24f9b590def6ba926a8bb6660b91b74e72bc792a1d1bc32c85aadcb887d";
const collapseWhitespace = (s) => s.replace(/\s+/g, " ").trim();
const isLegacySnippet = (text) => createHash("sha256").update(collapseWhitespace(text)).digest("hex") === LEGACY_SNIPPET_SHA256;

// A marker counts only as a whole line (CR-011): `<!-- zdd:begin --> extra`
// is not a marker.
const MARKER_LINE = (m) => new RegExp("^" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\r?$", "gm");
function count(hay, marker) {
  return (hay.match(MARKER_LINE(marker)) ?? []).length;
}
function indexOfMarker(hay, marker) {
  const m = MARKER_LINE(marker).exec(hay);
  return m ? m.index : -1;
}

// Insert or refresh the managed block. Cases: exactly one well-formed marker
// pair (refresh in place); the v0.3.1 unmarked snippet, recognised by its
// fingerprint (replace that section, bounded by the next `## ` heading);
// nothing (append); markers present but malformed (refuse — CR-011). Line
// endings follow the file (CR-041).
export function upsertSnippet(existing, snippet) {
  const crlf = /\r\n/.test(existing);
  const norm = (s) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  const body = norm(snippet.trimEnd() + "\n");
  if (!existing) return { text: body, changed: true, how: "created" };
  const nb = count(existing, SNIPPET_BEGIN);
  const ne = count(existing, SNIPPET_END);
  if (nb || ne || existing.includes(SNIPPET_BEGIN) || existing.includes(SNIPPET_END)) {
    const b = indexOfMarker(existing, SNIPPET_BEGIN);
    const e = indexOfMarker(existing, SNIPPET_END);
    const stray = existing.split(SNIPPET_BEGIN).length - 1 !== 1 || existing.split(SNIPPET_END).length - 1 !== 1;
    if (nb !== 1 || ne !== 1 || e < b || stray) return { text: existing, changed: false, how: "refused: the zdd:begin / zdd:end markers are not exactly one well-formed pair — fix them by hand" };
    const next = existing.slice(0, b) + body.trimEnd() + existing.slice(e + SNIPPET_END.length);
    return { text: next, changed: next !== existing, how: "refreshed" };
  }
  const h = existing.indexOf(LEGACY_SNIPPET_HEADING);
  let legacyKept = false;
  if (h !== -1) {
    const after = existing.indexOf("\n## ", h + LEGACY_SNIPPET_HEADING.length);
    const end = after === -1 ? existing.length : after + 1;
    const section = existing.slice(h, end);
    if (isLegacySnippet(section)) {
      const next = existing.slice(0, h) + body + existing.slice(end);
      return { text: next, changed: true, how: "replaced the pre-0.4 snippet" };
    }
    // The heading is there but the section is not the stock snippet — an
    // adopter's line inside it, or their own section: leave it, append.
    legacyKept = LEGACY_FINGERPRINT.every((f) => section.includes(f));
  }
  const sep = existing.endsWith("\n") ? (/\r?\n\r?\n$/.test(existing) ? "" : norm("\n")) : norm("\n\n");
  return {
    text: existing + sep + body,
    changed: true,
    how: "appended",
    note: legacyKept ? `legacy section left in place: the "${LEGACY_SNIPPET_HEADING}" section differs from the v0.3.1 snippet, so it is yours — fold what you want into the marked block and delete the rest by hand` : undefined,
  };
}

function writeSnippet(ledger, file, paths) {
  const existing = ledger.exists(file) ? ledger.read(file) : "";
  const { text, changed, how, note } = upsertSnippet(existing, snippetText(paths));
  if (!changed) {
    ledger.kept.push(file);
    if (how.startsWith("refused")) ledger.notes.push(`${file}: ${how}`);
    return;
  }
  if (existing) ledger.overwrite(file, text);
  else if (!ledger.create(file, text)) return;
  ledger.notes.push(`${file}: ${how} the ZDD instruction block`);
  if (note) ledger.notes.push(`${file}: ${note}`);
}

// The one line CLAUDE.md carries (2.3). Cases: the line is there (nothing to
// do); a marked block (the one-time migration: the block becomes the line);
// the v0.3.1 unmarked snippet (same); nothing (append); malformed markers
// (refuse, as upsertSnippet does). Line endings follow the file.
export function upsertImport(existing, line) {
  const crlf = /\r\n/.test(existing);
  const norm = (s) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  const body = norm(`${IMPORT_COMMENT}\n${line}\n`);
  const present = existing.split(/\r?\n/).some((l) => l === line);
  if (!existing) return { text: body, changed: true, how: "created" };
  const nb = count(existing, SNIPPET_BEGIN);
  const ne = count(existing, SNIPPET_END);
  if (nb || ne || existing.includes(SNIPPET_BEGIN) || existing.includes(SNIPPET_END)) {
    // Markers are judged before the import line (CR-409): a block left beside
    // the line is migrated away, and a malformed one is reported, either way.
    const b = indexOfMarker(existing, SNIPPET_BEGIN);
    const e = indexOfMarker(existing, SNIPPET_END);
    const stray = existing.split(SNIPPET_BEGIN).length - 1 !== 1 || existing.split(SNIPPET_END).length - 1 !== 1;
    if (nb !== 1 || ne !== 1 || e < b || stray) return { text: existing, changed: false, how: "refused: the zdd:begin / zdd:end markers are not exactly one well-formed pair — fix them by hand" };
    const replacement = present ? "" : body.trimEnd();
    let next = existing.slice(0, b) + replacement + existing.slice(e + SNIPPET_END.length);
    if (present) next = next.replace(/(\r?\n){3,}/g, crlf ? "\r\n\r\n" : "\n\n");
    return { text: next, changed: true, how: present ? "removed the leftover ZDD block; the import line already loads the instructions" : "replaced the ZDD block with the import line" };
  }
  if (present) return { text: existing, changed: false, how: "present" };
  const h = existing.indexOf(LEGACY_SNIPPET_HEADING);
  let legacyKept = false;
  if (h !== -1) {
    const after = existing.indexOf("\n## ", h + LEGACY_SNIPPET_HEADING.length);
    const end = after === -1 ? existing.length : after + 1;
    const section = existing.slice(h, end);
    if (isLegacySnippet(section)) return { text: existing.slice(0, h) + body + existing.slice(end), changed: true, how: "replaced the pre-0.4 snippet with the import line" };
    legacyKept = LEGACY_FINGERPRINT.every((f) => section.includes(f));
  }
  const sep = existing.endsWith("\n") ? (/\r?\n\r?\n$/.test(existing) ? "" : norm("\n")) : norm("\n\n");
  return {
    text: existing + sep + body,
    changed: true,
    how: "appended",
    note: legacyKept ? `legacy section left in place: the "${LEGACY_SNIPPET_HEADING}" section differs from the v0.3.1 snippet, so it is yours — fold what you want into your own text and delete the rest by hand` : undefined,
  };
}
function writeImport(ledger, file, bundleDir) {
  const existing = ledger.exists(file) ? ledger.read(file) : "";
  const { text, changed, how, note } = upsertImport(existing, importLine(bundleDir));
  if (!changed) {
    ledger.kept.push(how === "present" ? `${file} (loads ${instructionsRel(bundleDir)})` : file);
    if (how.startsWith("refused")) ledger.notes.push(`${file}: ${how}`);
    return;
  }
  if (existing) ledger.overwrite(file, text);
  else if (!ledger.create(file, text)) return;
  ledger.notes.push(`${file}: ${how} — one line, \`${importLine(bundleDir)}\`, loads ZDD's instructions into every session; the rest of ${file} is yours and ZDD never edits it again`);
  if (note) ledger.notes.push(`${file}: ${note}`);
}
// ZDD's own instructions file: written at install, rewritten on every upgrade
// to this release's text, never hand-edited (the fence refuses).
function writeInstructions(ledger, config) {
  const paths = artifactPaths(config, { lenient: true });
  const rel = instructionsRel(paths.bundleDir);
  const text = instructionsFileText(paths);
  if (ledger.exists(rel)) {
    const cur = ledger.read(rel);
    if (cur === text) ledger.kept.push(rel);
    else if (!isOwned(cur)) {
      // A file of the adopter's at ZDD's name (CR-401): never overwritten.
      ledger.kept.push(`${rel} (yours — not ZDD's file)`);
      ledger.notes.push(`${rel}: a file of yours sits where ZDD writes its instructions, and it carries no "${OWNER_MARK}" header, so it was left untouched — move it (and any import line in CLAUDE.md that loads it) and run again, or set paths.bundleDir elsewhere; until then ZDD's instructions are not installed`);
      return null;
    } else {
      ledger.overwrite(rel, text);
      ledger.notes.push(`${rel}: rewritten to this release's instructions — ZDD's file, never hand-edited; your own rules live in CLAUDE.md`);
    }
    return rel;
  }
  if (ledger.create(rel, text)) ledger.notes.push(`${rel}: written — ZDD's instructions for every session, loaded by one line in CLAUDE.md (and copied into AGENTS.md for Codex, which has no file import)`);
  return rel;
}

// docs/agents/domain.md (1.3.1): Matt Pocock's skills (1.3+) read a root
// GLOSSARY.md and docs/adr/ by name, and the one redirect they honour is this
// file — what their setup skill writes — reached from a "See
// docs/agents/domain.md" line in CLAUDE.md (the ZDD block carries one). It is
// adopter-owned from the first byte: written only when absent, with the
// configured paths filled in, and never rewritten or edited — a hand-written
// one is kept, whatever it says.
export const DOMAIN_DOC = "docs/agents/domain.md";
export function domainDocText(paths) {
  return readFileSync(join(TEMPLATES, "domain.md"), "utf8")
    .replaceAll("<GLOSSARY>", paths.glossary)
    // A harness set at bootstrap (decision 0033) is named; without one the
    // text is 2.4's. An existing domain.md is the adopter's, never rewritten:
    // the split lists it for a hand edit instead.
    .replaceAll("<HARNESS_ADR_RULE>", () => (paths.harnessAdrDir ? ` A decision about how the team builds (review, tests, CI, the tracker, ZDD itself) goes in \`${paths.harnessAdrDir}/\` instead, on the same numbering.` : ""))
    .replaceAll("<ADR_DIR>", () => paths.adrDir)
    .replaceAll("<ADR_INDEX>", () => paths.adrIndex);
}
function writeDomainDoc(ledger, paths) {
  if (ledger.exists(DOMAIN_DOC)) {
    ledger.kept.push(`${DOMAIN_DOC} (yours — never rewritten)`);
    return;
  }
  if (ledger.create(DOMAIN_DOC, domainDocText(paths))) {
    ledger.notes.push(`${DOMAIN_DOC}: written — points Matt Pocock's skills (1.3+, which read a root GLOSSARY.md and docs/adr/) at ${paths.glossary} and ${paths.adrDir}/; yours to edit from here`);
  }
}

// .claude/settings.json (1.3.1, decision 0014): ZDD brings in one pinned
// release of mattpocock-skills from its own marketplace, and Claude Code
// loads two enabled copies of one plugin name as ONE, silently — in the
// 1.3.1 experiment the OTHER copy won. So the repo's committed project
// settings switch the other known copies off, in advance, and switch ZDD's
// pair on. Key-level merge into the adopter's file (every other key and its
// order kept; the analogue of the marked block in CLAUDE.md); never a user or
// local settings file, never an uninstall. A file that is not a JSON object
// is the adopter's problem to name, not ours to replace.
const SETTINGS_FILE = ".claude/settings.json";
// The lock (decision 0021, 2.2.0): the marketplace declared at this
// release's tag, auto-update off — what the session-start release check reads.
// A declaration is OURS when its source is this marketplace's repository; any
// other (a fork, a mirror, a path) is the adopter's, named and never touched.
export const lockEntry = (version) => ({ source: { source: "github", repo: MARKETPLACE_REPO, ref: `v${version}` }, autoUpdate: false });
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export { MARKETPLACE, MARKETPLACE_REPO, isOurDeclaration };
const describeSource = (decl) => {
  const src = isPlainObject(decl?.source) ? decl.source : {};
  return String(src.repo ?? src.url ?? src.path ?? src.source ?? "an unknown source").slice(0, 120);
};

// The lock's half of the settings merge. mode "apply" writes the lock when
// absent and keeps an existing one; "upgrade" moves our lock's ref, and writes
// an absent one only on the user's word (`lock`, from `--lock`). Mutates `obj`;
// returns the ledger notes.
function mergeLock(obj, version, mode, lock) {
  const ekm = obj.extraKnownMarketplaces;
  const declared = isPlainObject(ekm) ? ekm[MARKETPLACE] : undefined;
  const tag = `v${version}`;
  if (ekm !== undefined && !isPlainObject(ekm)) {
    return [`${SETTINGS_FILE}: "extraKnownMarketplaces" is not an object, so this repo is NOT locked — left as it is (bootstrap never rewrites what it cannot read); make it an object and run again to lock it`];
  }
  if (declared !== undefined && !isOurDeclaration(declared)) {
    return [`${SETTINGS_FILE}: declares ${MARKETPLACE} from ${describeSource(declared)}, not this plugin's repository (${MARKETPLACE_REPO}) — yours, left as it is`];
  }
  if (declared === undefined) {
    if (mode === "upgrade" && !lock) {
      return [
        `${SETTINGS_FILE}: no lock — this repo floats on whatever ZDD each machine last fetched, and the release check stays silent. ` +
          `Lock it to ${tag} with \`bootstrap.mjs upgrade --lock\`, on the user's word (decision 0021)`,
      ];
    }
    obj.extraKnownMarketplaces = { ...(ekm ?? {}), [MARKETPLACE]: lockEntry(version) };
    return [
      `${SETTINGS_FILE}: locked this repo to ZDD ${tag} (extraKnownMarketplaces, auto-update off) — every developer runs this release, ` +
        `and moving to a new one is a deliberate PR the session-start release check announces`,
    ];
  }
  // Ours: a lock is only a lock with auto-update off (CR-006).
  const notes = [];
  let next = declared;
  if (declared.autoUpdate !== false) {
    next = { ...next, autoUpdate: false };
    notes.push(`${SETTINGS_FILE}: auto-update switched off on the zero-drift-docs declaration — a locked release moves only by a PR`);
  }
  const was = declared.source.ref;
  const shown = typeof was === "string" ? was.slice(0, 40) : "(no ref)";
  if (was !== tag && mode !== "upgrade") notes.push(`${SETTINGS_FILE}: locked to ${shown} — kept; moving the lock is upgrade's job`);
  else if (was !== tag) {
    next = { ...next, source: { ...next.source, ref: tag } };
    notes.push(
      `${SETTINGS_FILE}: lock moved ${shown} → ${tag}. After this PR merges, each developer's next session prints the route ` +
        `that moves their machine (restart, claude plugin update, restart)`,
    );
  }
  if (next !== declared) obj.extraKnownMarketplaces = { ...ekm, [MARKETPLACE]: next };
  return notes;
}

// The repo's lock ref when the declaration is ours, else null.
function ourLockRef(ledger) {
  if (!ledger.exists(SETTINGS_FILE)) return null;
  try {
    const d = JSON.parse(ledger.read(SETTINGS_FILE))?.extraKnownMarketplaces?.[MARKETPLACE];
    return isOurDeclaration(d) && typeof d.source.ref === "string" ? d.source.ref : null;
  } catch {
    return null;
  }
}

function writePluginSettings(ledger, version, { mode = "apply", lock = false } = {}) {
  const wanted = pluginSettings();
  const pin = pocockPin();
  let existing = "";
  let obj = {};
  if (ledger.exists(SETTINGS_FILE)) {
    existing = ledger.read(SETTINGS_FILE);
    try {
      obj = JSON.parse(existing);
    } catch {
      obj = null;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      ledger.kept.push(SETTINGS_FILE);
      ledger.notes.push(`${SETTINGS_FILE}: not valid JSON (an object) — left untouched; add these by hand under "enabledPlugins": ${JSON.stringify(wanted)}`);
      return;
    }
  }
  const before = JSON.stringify(obj);
  const ep = obj.enabledPlugins;
  const enabled = ep && typeof ep === "object" && !Array.isArray(ep) ? ep : {};
  const pluginsMoved = Object.entries(wanted).some(([k, v]) => enabled[k] !== v);
  if (pluginsMoved) obj.enabledPlugins = { ...enabled, ...wanted }; // existing keys keep their place; ours are updated or appended
  const lockNotes = mergeLock(obj, version, mode, lock);
  if (JSON.stringify(obj) === before) {
    ledger.kept.push(SETTINGS_FILE);
    ledger.notes.push(...lockNotes);
    return;
  }
  let text = JSON.stringify(obj, null, 2) + "\n";
  if (/\r\n/.test(existing)) text = text.replace(/\n/g, "\r\n");
  if (existing) ledger.overwrite(SETTINGS_FILE, text);
  else if (!ledger.create(SETTINGS_FILE, text)) return;
  ledger.notes.push(...lockNotes);
  if (pluginsMoved) ledger.notes.push(
    `${SETTINGS_FILE}: switched off your other Pocock copies in this repo (${pin.otherCopies.join(", ")}) — each still works in your other repos — ` +
      `and switched on ${ZDD_PLUGIN_ID} and ${pin.plugin}@${pin.marketplace}, the ${pin.plugin} ${pin.version} release plugin ${version} is tested with. ` +
      `Only one copy of a plugin name loads per session, so this is what makes the pinned one load here. Claude Code reads this file; Codex ignores it`,
  );
}

function pinEngine(text, version) {
  const re = new RegExp(ENGINE_PACKAGE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "@[^\"'\\s]*", "g");
  return text.replace(re, `${ENGINE_PACKAGE}@${version}`);
}
// 2.0 (2.0.0): the workflow's lint step gates the merge, so it runs
// `lint --merge` — the pattern plan must be gone. An owned workflow is only
// re-pinned by upgrade, never rewritten, so the step is migrated in place: a
// `run:` line invoking the pinned engine's bare `lint` gains the flag. A
// workflow whose lint step has another shape is reported, not guessed at.
// The step is matched by `lint` followed by anything (2.3.0, finding 5):
// The first adopter's `lint ${{ … && '--tempstate' || '' }}` was reported "not found".
// --merge goes right after `lint`, ahead of whatever follows.
// A line up to its YAML comment: a `#` that opens the line or follows
// whitespace, outside quotes.
function stripYamlComment(line) {
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
// A step that already passes --merge somewhere after `lint` — the first adopter's
// `lint ${{ (dispatch || ready PR) && '--tempstate --merge' || '' }}`, a gate
// armed only where the team wants it (2.4.1) — is the team's own shape:
// left as written and named, never made unconditional.
// A YAML comment never counts (CR-007): `# lint --merge` above a bare step,
// or `lint # TODO: add --merge`, is no gate.
export function mergeGate(text) {
  const re = /^(\s*(?:-\s+)?run:\s*npx -y "\$ZDD_ENGINE" lint)\b([^\r\n]*?)[ \t]*(\r?)$/m;
  if (text.split(/\r?\n/).some((l) => /\blint --merge\b/.test(stripYamlComment(l)))) return { text, how: "present" };
  const m = text.match(re);
  if (!m) return { text, how: "absent" };
  if (/--merge\b/.test(stripYamlComment(m[2]))) return { text, how: "conditional" };
  return { text: text.replace(re, (_m, head, rest, cr) => `${head} --merge${rest}${cr}`), how: "added" };
}
// The header lines of an owned workflow are ZDD's, though upgrade only
// re-pins the file: before 2.2 they named `zdd:bootstrap --upgrade` as what
// moves the pin (2.4.1, finding 1). That exact wording, wrapped as the
// template wrapped it, becomes today's; anything else in the file is the
// team's and is left.
const OLD_WORKFLOW_HEADER = /^# Managed by Zero-Drift Docs \(zdd\): written by `zdd:bootstrap`; `zdd:bootstrap(\r?)\n# --upgrade` rewrites the engine pin below\. Remove this header line to take(\r?)\n# ownership of the file\.(\r?)$/m;
export function refreshHeader(text) {
  return text.replace(OLD_WORKFLOW_HEADER, (_m, a, b, c) => `# Managed by Zero-Drift Docs (zdd): written by \`zdd:bootstrap\`; "upgrade ZDD"${a}\n# rewrites the engine pin below. Remove this header line to take ownership${b}\n# of the file.${c}`);
}
// The standard suite's step (0.9, decision 0040): an owned workflow from an
// earlier release gains it, in the template's own words, before the
// freshness step — or, where the team removed that one, after the lint
// step. A workflow that already runs `suite` outside a comment keeps its
// shape; one with neither step to anchor on is named for a hand edit.
const SUITE_STEP_NAME = "- name: Your own adapters pass the standard suite";
function suiteStepBlock() {
  const lines = readFileSync(join(TEMPLATES, "zdd.yml"), "utf8").split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === SUITE_STEP_NAME);
  let from = at;
  while (from > 0 && lines[from - 1].trim().startsWith("#")) from--;
  const indent = lines[at].match(/^\s*/)[0];
  return lines.slice(from, at + 2).map((l) => l.slice(indent.length));
}
export function addSuiteStep(text) {
  if (text.split(/\r?\n/).some((l) => /"\$ZDD_ENGINE"\s+suite\b/.test(stripYamlComment(l)))) return { text, how: "present" };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const block = suiteStepBlock();
  const fresh = lines.findIndex((l) => /^\s*-\s+name:\s*Semantic-map freshness/.test(l));
  if (fresh !== -1) {
    const indent = lines[fresh].match(/^\s*/)[0];
    lines.splice(fresh, 0, ...block.map((l) => indent + l), "");
    return { text: lines.join(eol), how: "added" };
  }
  const lint = lines.findIndex((l) => /^\s*(?:-\s+)?run:\s*npx -y "\$ZDD_ENGINE" lint\b/.test(stripYamlComment(l)));
  if (lint === -1) return { text, how: "absent" };
  let head = lint;
  while (head > 0 && !/^\s*-\s/.test(lines[head])) head--;
  const indent = lines[head].match(/^\s*/)[0];
  lines.splice(lint + 1, 0, "", ...block.map((l) => indent + l));
  return { text: lines.join(eol), how: "added" };
}
const workflowText = (version) => pinEngine(readFileSync(join(TEMPLATES, "zdd.yml"), "utf8"), version);
const prePushText = (version) => pinEngine(readFileSync(join(TEMPLATES, "pre-push"), "utf8"), version);

const hasGit = (root) => existsSync(join(root, ".git"));

// .gitattributes (2.3.0, C15): derive and render write LF, and on a
// Windows checkout with core.autocrlf=true git showed ~49 generated files
// "modified" by line ending alone — a frightening diff for a plain user.
// One rule pins the bundle to LF on checkout and commit, so what the engine
// writes is what git expects. One line, appended to an existing file (its
// own line ending kept), never written for a bundle at the repo root.
export const gitattributesLine = (bundleDir) => `${bundleDir}/** text eol=lf`;
export const GITATTRIBUTES_LINE = gitattributesLine("zdd");
function writeGitattributes(ledger, config) {
  const raw = config?.paths?.bundleDir;
  const normalised = typeof raw === "string" ? raw.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "").replace(/\/$/, "") : raw;
  if (raw !== undefined && (normalised === "." || normalised === "")) {
    ledger.notes.push(".gitattributes: not written — paths.bundleDir is the repo root, so a `./**` rule would touch every file; add `text eol=lf` rules for the generated artifacts by hand");
    return;
  }
  const bundleDir = artifactPaths(config, { lenient: true }).bundleDir;
  // A .gitattributes pattern reads `[`, `]`, `*`, `?`, `#`, `!`, `\` and a
  // space as syntax: a folder holding one would pin something else (CR-313).
  if (/[\[\]*?#!\\\s]/.test(bundleDir)) {
    ledger.notes.push(`.gitattributes: not written — paths.bundleDir '${bundleDir}' holds a character .gitattributes reads as pattern syntax; add a \`text eol=lf\` rule for it by hand`);
    return;
  }
  const line = gitattributesLine(bundleDir);
  const file = ".gitattributes";
  const note = `${file}: ${bundleDir}/ checked out and committed with LF line endings (${line}) — the engine writes LF; without this a Windows checkout with core.autocrlf shows every generated file as modified`;
  if (!ledger.exists(file)) {
    if (ledger.create(file, line + "\n")) ledger.notes.push(note);
    return;
  }
  const text = ledger.read(file);
  if (text.split(/\r?\n/).some((l) => l.trim() === line)) {
    ledger.kept.push(file);
    return;
  }
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  ledger.overwrite(file, text + (text === "" || /\r?\n$/.test(text) ? "" : eol) + line + eol);
  ledger.notes.push(note);
}

// core.hooksPath: set it only when unset or already ours; an adopter's own
// hook manager (Husky, pre-commit, …) is never displaced (CR-007).
function ensureHooksPath(ledger) {
  if (!hasGit(ledger.root)) {
    ledger.notes.push("no .git here — after `git init`, run: git config core.hooksPath .githooks");
    return;
  }
  let current = "";
  try {
    current = execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: ledger.root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    current = "";
  }
  if (current && current !== ".githooks") {
    ledger.notes.push(`core.hooksPath is already ${current} (another hook manager) — left as is; call .githooks/pre-push from your existing pre-push hook`);
    return;
  }
  if (current === ".githooks") return;
  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: ledger.root, stdio: "ignore" });
    ledger.notes.push("git config core.hooksPath .githooks (local config, not committed — each clone runs it once)");
  } catch {
    ledger.notes.push("could not run git config — set it yourself: git config core.hooksPath .githooks");
  }
}

// A plugin-owned file: created when missing; an existing file is kept, and
// one we do not own is called out (CR-006).
function ensureOwned(ledger, rel, content, opts) {
  if (!ledger.exists(rel)) return ledger.create(rel, content, opts);
  ledger.kept.push(rel);
  if (!isOwned(ledger.read(rel))) ledger.notes.push(`${rel}: exists and is not managed by zdd — left untouched; merge the template by hand (${posixify(relative(ledger.root, join(TEMPLATES, basename(rel) === "pre-push" ? "pre-push" : "zdd.yml")))})`);
  return false;
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------
// Options merge (repair apply): objects deep, anything else replaced.
function mergeOptions(base, next) {
  if (!isPlainObject(base) || !isPlainObject(next)) return next;
  const out = { ...base };
  for (const [k, v] of Object.entries(next)) out[k] = mergeOptions(base[k], v);
  return out;
}

export function apply(root, rawAnswers, { date = today(), home } = {}) {
  // Detection first: it writes nothing, and the answers are checked against
  // the adapters' own option shapes (decision 0039).
  const detection = detect(root);
  const answers = validateAnswers(rawAnswers, detection.adapters);
  const ledger = new Ledger(root);
  const version = pluginVersion();
  const cfg = readConfig(root);
  if (cfg.state === "invalid") throw new Error(`${cfg.error} — fix or remove it; bootstrap never replaces a config it cannot read`);
  const existingConfig = cfg.config;
  const paths = artifactPaths(existingConfig); // throws on a bad configured path — before any write
  const mode = existingConfig ? "repair" : detection.mode;

  // Opt-ins: fresh adoption defaults all on; repair defaults to the current
  // state, so an omitted answer never reverses an earlier choice (CR-005).
  // Only a file the plugin OWNS counts as a current opt-in — an adopter's own
  // workflow or hook is not a ZDD choice to inherit or activate (CR-048).
  const owned = (rel) => ledger.exists(rel) && isOwned(ledger.read(rel));
  const current = existingConfig
    ? {
        autoLoad: existingConfig.hooks?.autoLoad ?? true,
        fence: existingConfig.hooks?.fence ?? false,
        stop: existingConfig.hooks?.stop ?? false,
        ci: owned(".github/workflows/zdd.yml"),
        prePush: owned(".githooks/pre-push"),
      }
    : { autoLoad: true, fence: true, stop: true, ci: true, prePush: true };
  const optIns = { ...current, ...(answers.optIns ?? {}) };
  // The shipped workflow is GitHub Actions (C6): on another host it would
  // never run and the user would believe they had a merge gate. The opt-in
  // is recorded as off, the three commands are printed for their own
  // pipeline, and the pre-push hook is offered as the fallback.
  const host = detection.host ?? hostOf(null);
  const ciOffHost = optIns.ci && !["github", "none"].includes(host.kind);
  if (ciOffHost) optIns.ci = false;

  // --- config.json -------------------------------------------------------
  let config = existingConfig;
  const stack = fromStack(answers.stack, detection);
  if (!config) {
    let extractors = answers.extractors;
    let extractorOptions = answers.extractorOptions;
    if (!extractors?.length && stack.extractors.length) ({ extractors, extractorOptions } = stack);
    if (!extractors?.length) {
      extractors = detection.proposals.map((p) => p.name);
      extractorOptions = Object.fromEntries(detection.proposals.map((p) => [p.name, p.options]));
    }
    if (!extractors?.length) extractors = ["generic"];
    if (!extractorOptions) {
      extractorOptions = {};
      for (const name of extractors) {
        const found = detection.proposals.find((p) => p.name === name);
        extractorOptions[name] = found?.options ?? stack.extractorOptions[name] ?? {};
      }
    }
    config = {
      name: answers.name || basename(root),
      repoBase: answers.repoBase || "",
      baseBranch: answers.baseBranch || "main",
      engine: version,
      extractors,
      extractorOptions: Object.fromEntries(extractors.map((n) => [n, extractorOptions[n] ?? {}])),
      hooks: { autoLoad: optIns.autoLoad, fence: optIns.fence, stop: optIns.stop },
      // The first map check, done with the developer (decision 0039 points 3
      // and 4): owed until `bootstrap.mjs check --done` clears it. On a
      // greenfield repo it waits for the first derive that finds records.
      mapCheck: "owed",
      // Every check of the standard suite blocks from day one (decision
      // 0040): a fresh install has no adapter of its own that predates one.
      suiteChecks: SUITE_CHECK_COUNT,
    };
    if (!hasGit(root)) config.render = { storeChanges: false };
    // A fresh install never writes a retired name (the alias is for configs
    // that already exist): an answer or a stack spelt the old way is written
    // the current way, options key and all.
    migrateRenames(config, []);
    migrateJobs(config, [], root);
    finalOptions(config.extractorOptions, detection.adapters);
    ledger.create("zdd/config.json", JSON.stringify(config, null, 2) + "\n");
  } else {
    // Repair: only an explicit answer changes the config. A pre-1.0 config's
    // extractors live under `adapter`; adding `extractors` beside it makes a
    // shape the engine refuses (CR-010), so upgrade migrates it first.
    if (existingConfig.adapter !== undefined && (answers.extractors?.length || answers.extractorOptions)) {
      throw new Error('zdd/config.json still uses the legacy "adapter" — run upgrade first (it migrates to "extractors"), then this answer');
    }
    const before = JSON.stringify(existingConfig);
    const repairNotes = [];
    if (
      optIns.autoLoad !== current.autoLoad ||
      optIns.fence !== current.fence ||
      optIns.stop !== current.stop ||
      // An explicit answer to a question the config has never recorded is a
      // change even when the effective value stays the same: a 1.0 config with
      // no `hooks.stop` answered "no" must say so, or --upgrade asks again
      // forever (CR-008).
      (answers.optIns && Object.hasOwn(answers.optIns, "stop") && typeof existingConfig.hooks?.stop !== "boolean")
    ) {
      // The hooks block is plugin-owned.
      existingConfig.hooks = { autoLoad: optIns.autoLoad, fence: optIns.fence, stop: optIns.stop };
      repairNotes.push("zdd/config.json: hooks block updated to the new answers");
    }
    // An opt-in extractor or a Realtime wrapper the upgrade confirmed with the
    // user (2.2.0): an explicit `extractors` answer is the list; explicit
    // `extractorOptions` merge into each extractor's options.
    if (answers.extractors?.length) {
      const was = Array.isArray(existingConfig.extractors) ? existingConfig.extractors : [];
      if (JSON.stringify(was) !== JSON.stringify(answers.extractors)) {
        existingConfig.extractors = answers.extractors;
        repairNotes.push(`zdd/config.json: extractors ${was.join(", ") || "(none)"} → ${answers.extractors.join(", ")}`);
      }
    }
    if (answers.extractorOptions) {
      const opts = isPlainObject(existingConfig.extractorOptions) ? existingConfig.extractorOptions : {};
      const moved = [];
      for (const [name, value] of Object.entries(answers.extractorOptions)) {
        const merged = mergeOptions(opts[name], value);
        if (JSON.stringify(merged) !== JSON.stringify(opts[name])) {
          opts[name] = merged;
          moved.push(name);
        }
      }
      if (moved.length) {
        finalOptions(Object.fromEntries(moved.map((n) => [n, opts[n]])), detection.adapters);
        existingConfig.extractorOptions = opts;
        repairNotes.push(`zdd/config.json: extractorOptions updated for ${moved.join(", ")}`);
      }
    }
    if (JSON.stringify(existingConfig) !== before) {
      ledger.overwrite("zdd/config.json", JSON.stringify(existingConfig, null, 2) + "\n");
      ledger.notes.push(...repairNotes);
    } else ledger.kept.push("zdd/config.json");
  }

  // --- curated skeleton (empty templates; never overwritten) ---------------
  ledger.create(paths.glossary, "# Glossary\n\n<!-- One paragraph per term: **Term**: definition. Canonical, not descriptive. -->\n");
  // Fresh skeleton: the hand-written pages for third-party systems live in
  // `external-services/` (2.3 rename, 2.3.0, pick 3). An adopter's existing
  // `services/` folder is theirs: suggested, never renamed (upgrade's note).
  for (const sub of ["features", "apps", "external-services"]) {
    const dir = ledger.abs(`${paths.mapDir}/${sub}`);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      ledger.create(`${paths.mapDir}/${sub}/.gitkeep`, "");
    }
  }
  // The blessing store (2.5, decision 0031): one file per blessing, empty
  // at adoption; "update ZDD" mints them.
  if (!existsSync(ledger.abs(paths.blessingsDir))) {
    mkdirSync(ledger.abs(paths.blessingsDir), { recursive: true });
    ledger.create(`${paths.blessingsDir}/.gitkeep`, "");
  }
  const apps = answers.apps ?? (answers.stack ? stack.apps : detection.apps.map((a) => a.name));
  const slugs = dedupe(apps.map(slug)); // CR-013
  apps.forEach((app, i) => {
    ledger.create(
      `${paths.mapDir}/apps/${slugs[i]}.md`,
      `---\ntype: Application\ntitle: ${yamlScalar(app)}\ndescription: ${yamlScalar(`${app} — declared at bootstrap; fill in as the code lands.`)}\nresource: .\ntags: []\n---\n\n${app.replace(/[<>]/g, "")}: planned at adoption, before any code existed. Link its features here as they appear.\n`,
    );
  });
  // One example feature slice, so `features/` never sits as an unexplained
  // .gitkeep: it shows the shape (a feature CLAIMS records by linking them)
  // with example lines drawn from the configured extractors. Created only
  // when the folder holds no slice yet; the adopter renames or deletes it.
  // Fresh adoption only (CR-013): a repair `apply` (the documented way to
  // answer a new opt-in after --upgrade) never writes into an adopter's map.
  if (!existingConfig) {
    const featuresDir = ledger.abs(`${paths.mapDir}/features`);
    const hasSlice = readdirSync(featuresDir).some((f) => /\.md$/i.test(f));
    if (!hasSlice) ledger.create(`${paths.mapDir}/features/example-feature.md`, exampleFeature(config, paths, detection.adapters));
    else ledger.kept.push(`${paths.mapDir}/features/ (a slice is present — example skipped)`);
  }
  const adrDir = ledger.abs(paths.adrDir);
  mkdirSync(adrDir, { recursive: true });
  const adrFiles = readdirSync(adrDir).filter((f) => /^\d{4}-.*\.md$/.test(f));
  if (answers.seedAdr !== false) {
    if (adrFiles.length) ledger.kept.push(`${paths.adrDir}/ (${adrFiles.length} ADR${adrFiles.length === 1 ? "" : "s"} present — seed skipped)`);
    else ledger.create(`${paths.adrDir}/0001-adopt-zero-drift-docs.md`, readFileSync(join(TEMPLATES, "adr-0001-adopt-zero-drift-docs.md"), "utf8").replace("<DATE>", date));
  } else ledger.skipped.push(`${paths.adrDir}/0001-adopt-zero-drift-docs.md (declined)`);
  mkdirSync(ledger.abs(paths.metadataDir), { recursive: true });

  // --- opt-ins ------------------------------------------------------------
  ledger.notes.push(`hooks: autoLoad ${optIns.autoLoad ? "on" : "off"}, fence ${optIns.fence ? "on" : "off"}, stop ${optIns.stop ? "on" : "off"} (recorded in zdd/config.json; the plugin's hooks.json reads it)`);

  if (ciOffHost) {
    ledger.notes.push(`CI workflow not written: this repo's origin is ${host.kind} (${host.remote}), and the workflow ZDD ships runs only on GitHub Actions — a file there would never run. The merge gate for your own pipeline is the three commands the summary prints; the pre-push hook is the local fallback`);
  }
  if (optIns.ci) {
    ensureOwned(ledger, ".github/workflows/zdd.yml", workflowText(version));
    if (ledger.exists(".githooks/pre-push")) ledger.notes.push(".githooks/pre-push also present — with CI accepted it is redundant; remove it if you no longer want the local check");
    else ledger.skipped.push(".githooks/pre-push (CI accepted — not needed)");
  } else {
    if (ledger.exists(".github/workflows/zdd.yml")) ledger.notes.push(".github/workflows/zdd.yml is present although CI was declined — delete it to make the choice real");
    else ledger.skipped.push(".github/workflows/zdd.yml (CI declined)");
    if (optIns.prePush) {
      ensureOwned(ledger, ".githooks/pre-push", prePushText(version), { executable: true });
      // Point git at .githooks only when the hook there is ours (CR-006, CR-048).
      if (owned(".githooks/pre-push")) ensureHooksPath(ledger);
    } else ledger.skipped.push(".githooks/pre-push (declined)");
  }

  const instructionsWritten = writeInstructions(ledger, config) !== null;
  if (instructionsWritten) writeImport(ledger, "CLAUDE.md", paths.bundleDir);
  else ledger.skipped.push("CLAUDE.md (the import line waits until ZDD's instructions file can be written)");
  // An AGENTS.md that already carries the block is refreshed on a repair
  // apply with no codex answer (2.3.0, finding 9: the ledger said "not
  // using Codex" about a file it had just refreshed).
  const codex = answers.codex ?? Boolean(existingConfig && ledger.exists("AGENTS.md") && ledger.read("AGENTS.md").includes(SNIPPET_BEGIN));
  if (codex) writeSnippet(ledger, "AGENTS.md", paths);
  else ledger.skipped.push('AGENTS.md (not using Codex — answer "codex": true to add the block there too)');
  writeGitattributes(ledger, config);
  writeDomainDoc(ledger, paths);
  writePluginSettings(ledger, version);

  const pocock = findPocock(root, home);
  return { mode, version, date, config, optIns, pocock, detection, host, ciCommands: ciCommands(version), ...ledgerOut(ledger) };
}
// The merge gate as four commands, for a pipeline ZDD ships no workflow for.
export const ciCommands = (version) => [`npx -y ${ENGINE_PACKAGE}@${version} derive --check`, `npx -y ${ENGINE_PACKAGE}@${version} render --check`, `npx -y ${ENGINE_PACKAGE}@${version} lint --merge`, `npx -y ${ENGINE_PACKAGE}@${version} suite`];

// The example feature slice's text, from the configured extractors and the
// records each adapter says an example can link (DETECTION.exampleClaims). The
// example TARGETS are shown as bare paths, never in the `[x](y.json)` shape:
// the render's link scanner reads that shape wherever it appears (inline
// code included), and a link it cannot resolve blocks the render — and at
// bootstrap no metadata exists yet.
export function exampleFeature(config, paths, adapters = {}) {
  // Relative to the slice's own folder, whatever the configured layout (CR-022).
  const toMeta = posixify(relative(join(paths.mapDir, "features"), paths.metadataDir)) || ".";
  const targets = [];
  for (const name of config.extractors ?? []) for (const t of adapters[name]?.exampleClaims ?? []) if (!targets.includes(t)) targets.push(t.replaceAll("../../metadata", toMeta));
  if (!targets.length) targets.push(`a record: \`${toMeta}/<kind>/<file>.json\``);
  const roots = [];
  for (const name of config.extractors ?? []) {
    const o = config.extractorOptions?.[name] ?? {};
    const candidates = [o.appDir, o.routesFile && posixify(dirname(o.routesFile)), ...(Array.isArray(o.roots) ? o.roots : []), ...(Array.isArray(o.migrationNamespaces) ? o.migrationNamespaces.map((m) => m?.dir) : [])];
    for (const r of candidates) if (typeof r === "string" && r && !roots.includes(r)) roots.push(r);
  }
  return [
    "---",
    "type: Feature",
    "title: Example feature",
    'description: "A worked example of a feature slice - rename it to a real feature, or delete it."',
    `resource: ${yamlScalar(roots[0] ?? ".")}`,
    "tags: [example]",
    "---",
    "",
    "A **feature slice** is one file here per user-facing capability. It says",
    "*where* the capability lives (`resource:`), *what connects* (links to the",
    "records `derive` inventoried - a feature CLAIMS a record by linking it, and",
    "`zdd-engine lint` lists every route, table, function and surface no slice",
    "claims). *What to copy* lives apart, in the blessing store",
    `(\`${paths.blessingsDir}/\`): one file per pattern, opening with the question it`,
    "answers - \"Adding an endpoint?\" - with `where:` (the code to copy or",
    "extend) and `kind:` in its header, then the pattern to refuse and the",
    "reason: an ADR, or \"because ...\". A unit of work that adds or changes",
    "user-facing behaviour adds a slice or extends one; \"choose patterns\" reads",
    "the blessings before the code is written.",
    "",
    "Claim a record with a markdown link, `[title](path)`, the path relative to",
    "this file - for this stack, for example:",
    "",
    ...targets.map((t) => `- ${t}`),
    "",
    "(Shown as bare paths: no metadata exists at bootstrap, and a link that does",
    "not resolve blocks `render`. Run `derive`, then link what it wrote.)",
    "",
  ].join("\n");
}

function ledgerOut(l) {
  return { wrote: l.wrote, kept: l.kept, skipped: l.skipped, notes: l.notes, ...(l.removed.length ? { removed: l.removed } : {}) };
}

// ---------------------------------------------------------------------------
// split-adrs (ZDD-1, decision 0034): the opt-in step that turns one ADR set
// into an application set and a harness set. `--plan` proposes a set for each
// ADR — a tag line (`Scope: harness` / `Scope: product`, exactly) decides;
// anything else is left for the developer, with the AI's proposal from the
// content. The write takes the plan's token and an explicit set for every
// untagged ADR; it writes the two config keys, moves the harness ADRs
// (numbers unchanged), re-points every link inside the bundle, and lists the
// links and paths outside it for a hand edit. Everything is judged before
// the first write.
// ---------------------------------------------------------------------------
const parseNums = (v, flag) => {
  if (v === null || v === undefined || v === false || v === true || v === "") return [];
  const nums = String(v).split(",").map((x) => x.trim()).filter(Boolean);
  for (const n of nums) if (!/^\d{4}$/.test(n)) throw new Error(`${flag} takes ADR numbers, four digits each, comma-separated — got '${n.slice(0, 20)}'`);
  return nums;
};

export function splitAdrs(root, { plan = false, harness = null, application = null, token = null, dir = null, index = null } = {}) {
  const cfg = readConfig(root);
  if (cfg.state === "absent") throw new Error(`no zdd/config.json under ${root} — adopt ZDD first (bootstrap)`);
  if (cfg.state === "invalid") throw new Error(`${cfg.error} — fix it by hand; the split never rewrites a config it cannot read`);
  const config = cfg.config;
  const current = artifactPaths(config);
  const configured = current.harnessAdrDir !== undefined;
  if (configured && (dir || index)) throw new Error(`paths.harnessAdrDir is already ${current.harnessAdrDir} — --dir and --index name a new set; leave them out`);
  // The set's paths, judged by the same rules as every other path (CR-030:
  // the full overlap rule the engine applies).
  const nextConfig = configured ? config : { ...config, paths: { ...(config.paths ?? {}), harnessAdrDir: dir ?? "zdd/adr-harness", harnessAdrIndex: index ?? "zdd/adr-harness-index.md" } };
  const paths = artifactPaths(nextConfig);
  const ledger = new Ledger(root, { dryRun: plan });
  // --- what there is: every ADR, read whole (CR-026, CR-034) ---
  const listDir = (rel) => {
    const abs = ledger.abs(rel);
    if (!existsSync(abs)) return [];
    if (!lstatSync(abs).isDirectory()) throw new Error(`${rel} is not a folder — an ADR set is a folder of NNNN-*.md files`);
    return readdirSync(abs).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();
  };
  const unfit = [];
  const proposals = listDir(paths.adrDir).map((file) => {
    const rel = `${paths.adrDir}/${file}`;
    let text = null;
    try {
      const st = lstatSync(ledger.abs(rel));
      if (!st.isFile()) unfit.push(`${rel} (not a regular file)`);
      else if (st.size > MAX_SCAN_BYTES) unfit.push(`${rel} (over ${MAX_SCAN_BYTES / 1024} KiB)`);
      else text = ledger.read(rel);
    } catch (e) {
      unfit.push(`${rel} (unreadable: ${e.code ?? "error"})`);
    }
    return { num: file.slice(0, 4), file, from: rel, tag: text === null ? null : scopeTag(text), text };
  });
  // One number line (CR-036): a number twice, or already in the harness set,
  // makes --harness=NNNN name two files — refused before anything is shown.
  const seen = new Map(listDir(paths.harnessAdrDir).map((f) => [f.slice(0, 4), `${paths.harnessAdrDir}/${f}`]));
  const dupes = [];
  for (const p of proposals) {
    if (seen.has(p.num)) dupes.push(`ADR-${p.num}: ${seen.get(p.num)} and ${p.from}`);
    else seen.set(p.num, p.from);
  }
  if (dupes.length) throw new Error(`two ADRs share a number (${dupes.join("; ")}) — renumber the later one first (lint names it); the split addresses ADRs by number`);
  const digest = (t) => (t === null ? null : createHash("sha256").update(t).digest("hex").slice(0, 16));
  const tokenNow = createHash("sha256").update(JSON.stringify([paths.harnessAdrDir, paths.harnessAdrIndex, proposals.map((p) => [p.num, p.file, p.tag, digest(p.text)])])).digest("hex").slice(0, 8);
  const untagged = proposals.filter((p) => !p.tag);
  const shown = proposals.map(({ text, ...p }) => p);
  if (plan && !token) {
    ledger.notes.push(
      untagged.length
        ? `${untagged.length} of ${proposals.length} ADRs carry no Scope tag line — propose a set for each from what it decides (harness: how the team builds — review, tests, CI, the tracker, ZDD itself; application: what the product does), and let the developer confirm or change each one`
        : `every ADR carries a Scope tag line — the developer confirms the list`,
    );
    for (const u of unfit) ledger.notes.push(`${u}: cannot be moved by the split — fix it, or keep it in the application set`);
    return { plan: true, token: tokenNow, dir: paths.harnessAdrDir, index: paths.harnessAdrIndex, proposals: shown, ...ledgerOut(ledger) };
  }
  // --- judged whole before the first write ---
  if (!token) throw new Error("split-adrs takes the token split-adrs --plan printed (--token=<token>), so the write moves exactly the list the developer read");
  if (!/^[0-9a-f]{8}$/.test(String(token))) throw new Error("--token takes the 8 hex characters split-adrs --plan printed");
  if (token !== tokenNow) throw new Error(`--token=${token}: the ADRs changed since the plan (its token is now ${tokenNow}) — run split-adrs --plan again`);
  const h = new Set(parseNums(harness, "--harness"));
  const a = new Set(parseNums(application, "--application"));
  const known = new Set(proposals.map((p) => p.num));
  for (const n of [...h, ...a]) if (!known.has(n)) throw new Error(`ADR-${n} is not in ${paths.adrDir}/ (this run lists ${proposals.length ? proposals.map((p) => p.num).join(", ") : "none"})`);
  const both = [...h].filter((n) => a.has(n));
  if (both.length) throw new Error(`ADR-${both.join(", ADR-")} named in both --harness and --application — one set each`);
  const undecided = untagged.filter((p) => !h.has(p.num) && !a.has(p.num));
  if (undecided.length) throw new Error(`no set given for the untagged ADR${undecided.length === 1 ? "" : "s"} ${undecided.map((p) => `ADR-${p.num}`).join(", ")} — name each in --harness or --application; the split never decides an untagged ADR`);
  for (const p of proposals) p.set = h.has(p.num) ? "harness" : a.has(p.num) ? "application" : p.tag;
  const toMove = proposals.filter((p) => p.set === "harness");
  const cannot = toMove.filter((p) => p.text === null);
  if (cannot.length) throw new Error(`cannot move ${cannot.map((p) => p.from).join(", ")}: ${unfit.filter((u) => cannot.some((c) => u.startsWith(c.from))).join("; ")} — fix it first, or keep it in --application`);
  const moved = new Map(toMove.map((p) => [p.from, `${paths.harnessAdrDir}/${p.file}`]));
  // A destination is free only when nothing is there and its path is safe (CR-027).
  for (const p of toMove) {
    const state = destinationState(root, `${paths.harnessAdrDir}/${p.file}`);
    if (state !== "absent") throw new Error(`${paths.harnessAdrDir}/${p.file} ${state === "present" ? "is already there" : "cannot be written safely (a link, or a path ZDD may not use)"} — move it by hand, then run split-adrs --plan again`);
  }
  // Every Markdown file whose links may need re-pointing: the bundle's, and
  // both ADR folders' wherever they live (CR-026); the generated ones never.
  // A page the walk could not read refuses the split (its links would break).
  const generated = new Set([paths.agentIndex, paths.adrIndex, paths.blessingIndex, paths.harnessAdrIndex, paths.patternsPlan].filter(Boolean));
  const areaDir = agentIndexAreaDir(paths.agentIndex);
  const pages = new Set();
  const skippedPages = [];
  for (const top of [paths.bundleDir, paths.adrDir, paths.harnessAdrDir]) {
    const { files, skipped } = listMapPages(ledger, top);
    skippedPages.push(...skipped);
    for (const f of files) if (!generated.has(f) && !(areaDir && f.startsWith(`${areaDir}/`)) && !f.startsWith(`${paths.metadataDir}/`) && !moved.has(f)) pages.add(f);
  }
  if (skippedPages.length) throw new Error(`the split could not read ${skippedPages.slice(0, 5).join(", ")}${skippedPages.length > 5 ? ", …" : ""} — links there could break unseen; fix or move it, then run split-adrs --plan again`);
  const bundle = paths.bundleDir === "." ? "" : paths.bundleDir;
  const repoint = (text, oldRel, newRel) => outsideFences(text, (chunk) => repointLinks(chunk, { oldRel, newRel, moved, bundleDir: paths.bundleDir }));
  // --- writes: every new file first, undone if any is refused (CR-025) ---
  const created = [];
  for (const p of toMove) {
    const to = moved.get(p.from);
    if (ledger.create(to, repoint(p.text, p.from, to))) created.push(to);
    else {
      for (const c of created) ledger.remove(c);
      throw new Error(`${to} appeared during the run — nothing was moved; run split-adrs --plan again`);
    }
  }
  if (!toMove.length && !entryExists(root, paths.harnessAdrDir)) ledger.create(`${paths.harnessAdrDir}/.gitkeep`, "");
  for (const p of toMove) ledger.remove(p.from);
  let repointed = 0;
  for (const rel of [...pages].sort()) {
    const text = ledger.read(rel);
    const next = repoint(text, rel, rel);
    if (next !== text) {
      ledger.overwrite(rel, next);
      repointed++;
    }
  }
  if (!configured) {
    ledger.overwrite("zdd/config.json", JSON.stringify(nextConfig, null, 2) + "\n");
    ledger.notes.push(`zdd/config.json: paths.harnessAdrDir = ${paths.harnessAdrDir}, paths.harnessAdrIndex = ${paths.harnessAdrIndex} (decision 0033)`);
    // ZDD's instructions name the harness index from now on (CR-038).
    writeInstructions(ledger, nextConfig);
    if (ledger.exists("AGENTS.md")) {
      const cur = ledger.read("AGENTS.md");
      if (cur.includes(SNIPPET_BEGIN) || cur.includes(LEGACY_SNIPPET_HEADING)) writeSnippet(ledger, "AGENTS.md", artifactPaths(nextConfig, { lenient: true }));
    }
  }
  if (toMove.length) ledger.notes.push(`${toMove.length} ADR${toMove.length === 1 ? "" : "s"} moved to ${paths.harnessAdrDir}/ with ${toMove.length === 1 ? "its number" : "their numbers"} unchanged; ${repointed} other file${repointed === 1 ? "" : "s"} re-pointed`);
  // Outside the bundle and the ADR folders ZDD writes nothing: what still
  // points at an old path is listed — every file git sees, untracked ones
  // included, and what was too big to read is said (CR-029).
  const outside = [];
  let tooBig = 0;
  let unread = 0;
  const inside = (rel, top) => top && (rel === top || rel.startsWith(`${top}/`));
  for (const rel of repoFiles(ledger)) {
    if (inside(rel, bundle) || inside(rel, paths.adrDir) || inside(rel, paths.harnessAdrDir) || !RETIRED_SCAN_EXT.test(rel)) continue;
    let text;
    try {
      if (lstatSync(ledger.abs(rel)).size > MAX_SCAN_BYTES) {
        tooBig++;
        continue;
      }
      text = ledger.read(rel);
    } catch {
      unread++;
      continue;
    }
    for (const hit of linksToMoved(text, { fileRel: rel, moved, bundleDir: paths.bundleDir })) outside.push({ file: rel, ...hit });
  }
  for (const o of outside.slice(0, 50)) {
    const target = [...moved].find(([old]) => o.link.includes(posix.basename(old)))?.[1];
    ledger.notes.push(`${o.file}:${o.line} still points at ${o.link}${target ? ` — now ${target}` : ""}; ZDD never edits outside ${paths.bundleDir}/, so change it by hand`);
  }
  if (outside.length > 50) ledger.notes.push(`… and ${outside.length - 50} more lines outside ${paths.bundleDir}/ that point at a moved ADR`);
  if (tooBig) ledger.notes.push(`${tooBig} file${tooBig === 1 ? "" : "s"} outside ${paths.bundleDir}/ over ${MAX_SCAN_BYTES / 1024} KiB not read for links to the moved ADRs — search ${tooBig === 1 ? "it" : "them"} by hand`);
  if (unread) ledger.notes.push(`${unread} file${unread === 1 ? "" : "s"} outside ${paths.bundleDir}/ could not be read for links to the moved ADRs — search ${unread === 1 ? "it" : "them"} by hand`);
  if (toMove.length && ledger.exists(DOMAIN_DOC)) ledger.notes.push(`${DOMAIN_DOC} is yours and names only ${paths.adrDir}/ — add ${paths.harnessAdrDir}/ for harness decisions, so Matt Pocock's skills file them there`);
  ledger.notes.push(`run \`render\` (it writes ${paths.harnessAdrIndex} and rewrites ${paths.adrIndex}), then \`lint\`, and commit the split in one PR`);
  return { plan, token: tokenNow, dir: paths.harnessAdrDir, index: paths.harnessAdrIndex, proposals: shown, moved: [...moved].map(([from, to]) => ({ from, to })), outside, ...ledgerOut(ledger) };
}

// "absent" (nothing there), "present" (anything at all, not followed), or
// "unsafe" (the path escapes the repo, crosses a link, or cannot be checked).
function destinationState(root, rel) {
  let abs;
  try {
    abs = resolveInside(root, rel, rel);
  } catch {
    return "unsafe";
  }
  try {
    lstatSync(abs);
    return "present";
  } catch (e) {
    return e.code === "ENOENT" ? "absent" : "unsafe";
  }
}

export function narrateSplit(r) {
  const out = [r.plan ? `ADR split plan — nothing written yet (harness set: ${r.dir}/, index ${r.index})` : `ADR split into ${r.dir}/`];
  if (r.plan && !r.moved) {
    out.push(`  token: ${r.token} — pass it with --token once the developer has confirmed every set`);
    for (const p of r.proposals) out.push(`  ADR-${p.num}  ${p.tag ? `${p.tag} (its Scope tag line)` : "untagged — propose a set from its content"}  ${p.from}`);
  }
  const verb = r.plan ? "would write" : "wrote";
  for (const f of r.wrote) out.push(`  ${verb} ${f}`);
  for (const f of r.removed ?? []) out.push(`  ${r.plan ? "would remove" : "removed"} ${f}`);
  for (const n of r.notes) out.push(`  note    ${n}`);
  return out.map(printable).join("\n");
}

// ---------------------------------------------------------------------------
// upgrade
// ---------------------------------------------------------------------------
// The guided upgrade (2.2.0): `plan` writes nothing and says what would
// change; `drop` (ids from the plan's duplicates) removes adopter sections the
// block now covers, on the user's word; `to` (a tag newer than this plugin)
// moves only the lock — the rest waits for that release's own upgrade.
export function upgrade(root, { lock = false, plan = false, drop = null, to = null, moveBlessings: move = false, kinds = null, remote, home } = {}) {
  const version = pluginVersion();
  if (to !== null) return moveLockOnly(root, version, to, { plan, lock, remote, home });
  const cfg = readConfig(root);
  if (cfg.state === "absent") throw new Error(`no zdd/config.json under ${root} — nothing to upgrade (run bootstrap without --upgrade to adopt)`);
  if (cfg.state === "invalid") throw new Error(`${cfg.error} — fix it by hand; upgrade never rewrites a config it cannot read`);
  // Never backwards (CR-005): a teammate may already have moved the repo past
  // the release this machine runs. The machine moves first.
  const locked = ourLockRef(new Ledger(root));
  if (locked && RELEASE_TAG.test(locked) && compareVersions(locked, version) > 0) {
    throw new Error(`this repo locks ${locked}, newer than this plugin (${version}) — update this machine first (the session-start line names the commands), restart, then say "upgrade ZDD" again`);
  }
  if (typeof cfg.config.engine === "string" && /^\d+\.\d+\.\d+$/.test(cfg.config.engine) && compareVersions(cfg.config.engine, version) > 0) {
    throw new Error(`zdd/config.json's engine pin ${cfg.config.engine} is newer than this plugin (${version}) — update this machine's plugin first; upgrade never moves a repo backwards`);
  }
  const dropIds = parseDrop(drop);
  const kindOf = parseKinds(kinds);
  if (move !== false && move !== true && !/^[0-9a-f]{8}$/.test(String(move))) throw new Error("--move-blessings takes the token upgrade --plan printed (8 hex characters)");
  if (move === true) throw new Error("--move-blessings takes the token upgrade --plan printed (--move-blessings=<token>), so the write moves exactly the list the developer read");
  // The move is judged whole before the first write (CR-002, CR-003,
  // CR-009): the paths as configured, strictly; every --kinds answer against
  // the proposals; the token against the list the plan showed; every
  // destination free. A plan run is the computation, as for --drop.
  if (!plan && (move || kindOf.size)) {
    try {
      artifactPaths(cfg.config);
    } catch (e) {
      throw new Error(`${e.message} — fix zdd/config.json's paths before moving blessings; the move never guesses where the store is`);
    }
    const preview = upgrade(root, { lock, plan: true, kinds }).blessingMoves;
    if (move && preview.token !== move) throw new Error(`--move-blessings=${move}: the blessings on the map changed since the plan (its token is now ${preview.token}) — run upgrade --plan again and read the new list`);
    const taken = preview.proposals.filter((p) => !p.problem && entryExists(root, p.file));
    if (taken.length) throw new Error(`the blessing store already holds ${taken.map((p) => p.file).join(", ")} — move or rename it by hand, then run upgrade --plan again`);
  }
  if (dropIds.length && !plan) {
    const known = upgrade(root, { lock, plan: true }).duplicates.map((d) => d.id);
    const bad = dropIds.find((id) => !known.includes(id));
    if (bad !== undefined) throw new Error(`--drop: no duplicate ${bad} (this run names ${known.length ? known.join(", ") : "none"}) — run upgrade --plan for the list`);
  }
  const ledger = new Ledger(root, { dryRun: plan });
  const config = cfg.config;
  const fromEngine = typeof config.engine === "string" ? config.engine : null;
  const hasLegacy = config.adapter !== undefined || config.adapterOptions !== undefined;
  const hasNew = config.extractors !== undefined || config.extractorOptions !== undefined;
  if (hasLegacy && hasNew) throw new Error("zdd/config.json has both 'adapter' and 'extractors' — keep one by hand before upgrading (the engine refuses this shape too)"); // CR-008
  const before = JSON.stringify(config);
  const changes = [];

  if (config.adapter !== undefined) {
    const adapterName = config.adapter;
    const legacy = LEGACY_ADAPTERS[config.adapter];
    if (!legacy) throw new Error(`unknown legacy adapter '${config.adapter}' — migrate by hand to "extractors": [...]`);
    const split = legacy.split(config.adapterOptions);
    const next = {};
    // Keep the adopter's key order, with the new keys where the old ones sat.
    for (const [k, v] of Object.entries(config)) {
      if (k === "adapter") next.extractors = legacy.extractors;
      else if (k === "adapterOptions") next.extractorOptions = Object.fromEntries(legacy.extractors.map((n) => [n, split[n] ?? {}]));
      else next[k] = v;
    }
    if (!next.extractorOptions) next.extractorOptions = Object.fromEntries(legacy.extractors.map((n) => [n, split[n] ?? {}]));
    for (const k of Object.keys(config)) delete config[k];
    Object.assign(config, next);
    changes.push(`adapter "${adapterName}" → extractors ${JSON.stringify(next.extractors)}; adapterOptions split into extractorOptions`);
  }
  const renamed = [];
  migrateRenames(config, renamed);
  migrateJobs(config, renamed, root);
  changes.push(...renamed);
  if (config.viewer && typeof config.viewer === "object" && Array.isArray(config.viewer.nonAreaTags)) {
    if (config.nonAreaTags === undefined) config.nonAreaTags = config.viewer.nonAreaTags;
    delete config.viewer.nonAreaTags;
    if (!Object.keys(config.viewer).length) delete config.viewer;
    changes.push("viewer.nonAreaTags → top-level nonAreaTags (it shapes graph.json, not just the viewer)");
  }
  if (config.engine !== version) {
    changes.push(`engine pin ${typeof config.engine === "string" ? config.engine : "(none)"} → ${version}`);
    config.engine = version;
  }
  // The standard suite (decision 0040): with no adapter of the repo's own,
  // every check blocks at once — there is nothing a new check could turn
  // red. With some, the number stays where it is (absent: every check
  // warns) until `bootstrap.mjs adapters --raise`, after the interview.
  const own = ownAdapters(root, config);
  if (!own.length && config.suiteChecks !== SUITE_CHECK_COUNT) {
    changes.push(`suiteChecks ${config.suiteChecks ?? "(none)"} → ${SUITE_CHECK_COUNT}: no adapter of this repo's own, so every check of the standard suite blocks (decision 0040)`);
    config.suiteChecks = SUITE_CHECK_COUNT;
  }
  // The Stop hook (plugin 1.1, decision 0008) is a new opt-in; upgrade names
  // it but never answers it — the skill asks, and a repair `apply` records it.
  const stopUnset = !(config.hooks && typeof config.hooks === "object" && !Array.isArray(config.hooks) && typeof config.hooks.stop === "boolean");
  if (JSON.stringify(config) !== before) {
    ledger.overwrite("zdd/config.json", JSON.stringify(config, null, 2) + "\n");
    for (const c of changes) ledger.notes.push(`zdd/config.json: ${c}`);
  } else ledger.kept.push("zdd/config.json");

  // Plugin-owned files: rewrite to this version, only where they exist AND
  // carry the ownership line. A file we do not own is reported, not edited.
  for (const [rel, fresh] of [
    [".github/workflows/zdd.yml", () => workflowText(version)],
    [".githooks/pre-push", () => prePushText(version)],
  ]) {
    if (!ledger.exists(rel)) continue;
    const cur = ledger.read(rel);
    if (!isOwned(cur)) {
      // The v0.3.1 template had no ownership line and no pin; the exact file
      // (modulo line endings / trailing whitespace) is still ours (CR-081).
      if (rel.endsWith("zdd.yml") && isLegacyWorkflow(cur)) {
        ledger.overwrite(rel, fresh());
        ledger.notes.push(`${rel}: the unmodified v0.3.1 workflow (unpinned npx, no ownership line) replaced with the pinned template (${version})`);
        continue;
      }
      ledger.kept.push(`${rel} (not managed by zdd — left untouched; check its engine pin by hand)`);
      continue;
    }
    let next = rel.endsWith("pre-push") ? fresh() : pinEngine(cur, version);
    const pinMoved = next !== cur; // before the gate, header and suite step change it too
    let gate = null;
    let headerNote = null;
    let suite = null;
    if (rel.endsWith("zdd.yml")) {
      gate = mergeGate(next);
      next = gate.text;
      if (gate.how === "absent") {
        ledger.notes.push(`${rel}: no \`run: npx -y "$ZDD_ENGINE" lint\` step found — add --merge to your lint step by hand, so the merge gate fails while ${artifactPaths(config, { lenient: true }).patternsPlan} exists`);
      }
      if (gate.how === "conditional") {
        ledger.notes.push(`${rel}: the lint step passes --merge in a shape of its own (under a condition?) — kept as written; check by hand that it runs on every pull request that can merge, so the merge gate fails while ${artifactPaths(config, { lenient: true }).patternsPlan} exists`);
      }
      const head = refreshHeader(next);
      if (head !== next) {
        next = head;
        headerNote = `${rel}: its header comment now names "upgrade ZDD" (it named the retired \`zdd:bootstrap --upgrade\`)`;
      }
      suite = addSuiteStep(next);
      next = suite.text;
      if (suite.how === "absent") ledger.notes.push(`${rel}: no lint or freshness step to place it beside — add a step that runs \`npx -y "$ZDD_ENGINE" suite\` by hand (the standard suite on this repo's own adapters, decision 0040)`);
    }
    if (next !== cur) {
      ledger.overwrite(rel, next);
      if (rel.endsWith("pre-push")) ledger.notes.push(`${rel}: rewritten from the template (${version})`);
      else if (pinMoved) ledger.notes.push(`${rel}: engine pin updated (${version})`);
      if (gate?.how === "added") ledger.notes.push(`${rel}: the lint step now runs \`lint --merge\` (2.0) — the merge gate fails while the branch's pattern plan exists`);
      if (headerNote) ledger.notes.push(headerNote);
      if (suite?.how === "added") ledger.notes.push(`${rel}: a step now runs the standard suite on this repo's own adapters (0.9, decision 0040)`);
    } else ledger.kept.push(rel);
  }
  // Links in the map move whenever any still point at a renamed kind's folder
  // (CR-305): a repo whose config was renamed by hand gets them too.
  {
    const mapDir = artifactPaths(config, { lenient: true }).mapDir;
    const links = migrateMapLinks(ledger, mapDir, artifactPaths(config, { lenient: true }).metadataDir);
    for (const rel of links.touched) ledger.notes.push(`${rel}: links to a renamed kind's records now point at its new folder (metadata/service/ → metadata/external-service/, 2.3; metadata/job/ → metadata/background-task/, 0.9) — the next derive moves the records there`);
    for (const what of links.skipped) ledger.notes.push(`${mapDir}: ${what} was not read for old metadata/service/ or metadata/job/ links — check it by hand`);
    if (renamed.length && existsSync(ledger.abs(`${mapDir}/services`))) ledger.notes.push(`${mapDir}/services/ is your hand-written folder for third-party systems — ZDD now calls them external services and a fresh install names the folder external-services/; rename it if you like (git mv), it is never renamed for you`);
  }
  // Blessings leave the map for the blessing store (2.5, decision 0032):
  // proposed on every run, written only with --move-blessings, which the
  // skill passes once the developer has read the list and said yes.
  const blessingMoves = moveBlessings(ledger, artifactPaths(config, { lenient: true }), { move: Boolean(move), kindOf });
  // The store exists after every upgrade (CR-005): lint and render say so
  // when it does not, and a repo with no blessings yet still has its folder.
  {
    const dir = artifactPaths(config, { lenient: true }).blessingsDir;
    if (!entryExists(root, dir) && !blessingMoves.moved.length) ledger.create(`${dir}/.gitkeep`, "");
  }
  const upgradePaths = artifactPaths(config, { lenient: true });
  const instructionsOk = writeInstructions(ledger, config) !== null;
  if (instructionsOk && ledger.exists("CLAUDE.md")) {
    const cur = ledger.read("CLAUDE.md");
    if (IMPORT_LINE_RE.test(cur) || cur.includes(SNIPPET_BEGIN) || cur.includes(SNIPPET_END) || cur.includes(LEGACY_SNIPPET_HEADING)) writeImport(ledger, "CLAUDE.md", upgradePaths.bundleDir);
    else {
      ledger.kept.push("CLAUDE.md (no ZDD block or import line to refresh)");
      ledger.notes.push(`CLAUDE.md does not load ${instructionsRel(upgradePaths.bundleDir)} — add the line \`${importLine(upgradePaths.bundleDir)}\` by hand, or run a repair apply, which adds it`);
    }
  }
  if (ledger.exists("AGENTS.md")) {
    const cur = ledger.read("AGENTS.md");
    if (!cur.includes(SNIPPET_BEGIN) && !cur.includes(SNIPPET_END) && !cur.includes(LEGACY_SNIPPET_HEADING)) ledger.kept.push("AGENTS.md (no ZDD block to refresh)");
    else writeSnippet(ledger, "AGENTS.md", upgradePaths);
  }
  // Adopter text outside the block that the block now covers (2.2.0):
  // named with its lines, removed only by --drop, after the block refresh so
  // the plan's line numbers are the real run's.
  let duplicates = findAllDuplicates(ledger, fromEngine);
  if (dropIds.length && !plan) {
    dropSections(ledger, duplicates.filter((d) => dropIds.includes(d.id)));
    duplicates = findAllDuplicates(ledger, fromEngine);
  }
  writeGitattributes(ledger, config);
  writeDomainDoc(ledger, artifactPaths(config, { lenient: true }));
  const lockBefore = ourLockRef(ledger);
  writePluginSettings(ledger, version, { mode: "upgrade", lock });
  // Names a release retired, still in the adopter's own text (2.3.0, 7, C9):
  // the plan greps for each and lists every hit with its replacement — the
  // old engine pin and the lock's old tag included (the first adopter keeps the tag in a
  // lock test of its own).
  const retired = findRetiredNames(ledger, {
    oldEngine: fromEngine && fromEngine !== version ? fromEngine : null,
    oldLock: lockBefore && lockBefore !== `v${version}` ? lockBefore : null,
    metadataRel: artifactPaths(config, { lenient: true }).metadataDir,
  });
  for (const r of retired) ledger.notes.push(r);
  if (stopUnset) ledger.notes.push('hooks.stop is not set (new in 1.1: the Stop hook prompts for the curated half once per session) — it stays OFF until answered: run bootstrap apply with {"optIns":{"stop":true}} (repair mode, keeps every other choice), or add "stop": true inside the existing "hooks" object by hand');
  const ctx = { root, config, version, paths: artifactPaths(config, { lenient: true }) };
  for (const [release, notes] of Object.entries(UPGRADE_NOTES)) {
    if (fromEngine && compareVersions(release, fromEngine) <= 0) continue;
    // A note never stops an upgrade mid-write (CR-011): a config shape it
    // did not expect is named, and the run goes on.
    try {
      ledger.notes.push(...notes(ctx));
    } catch {
      ledger.notes.push(`${release}: this release's note could not read zdd/config.json's shape — see the upgrade skill's "Upgrading to" section for it`);
    }
  }
  ledger.notes.push(...offerOptIns(root, config));
  if (own.length) ledger.notes.push(`this repo's own adapters (${own.join(", ")}): run \`bootstrap.mjs adapters\` — the standard suite on each one's fixture, and the steps of the adapter contract each is behind on (decision 0040); fix what it names through the extractor skill, then \`bootstrap.mjs adapters --raise\` (suiteChecks stays at ${config.suiteChecks ?? "0, every check warning,"} until then)`);
  ledger.notes.push("curated artifacts (glossary, ADRs, map pages, metadata) untouched — upgrade never writes them, save two mechanical moves named above: a map link to a record whose kind a release renamed, and blessings moved out of the map on --move-blessings");
  ledger.notes.push("if the engine pin moved: run `derive` and `render`, then `lint`, and commit the regenerated artifacts in the same PR");
  return { version, plan, ...ledgerOut(ledger), duplicates, blessingMoves };
}

// Every file in the adopter's repo, once per run: git's list when there is
// one (what is tracked or not ignored), else a bounded walk that skips the
// usual build and dependency folders. Used to find the one file a path
// written relative to its app means. `.claude/worktrees/` is never source
// (decision 0026, the engine's ALWAYS_IGNORED): every file there is a second
// copy from another checkout, and would make every path ambiguous.
const REPO_FILES = new WeakMap();
const notSource = (rel) => /^\.claude\/worktrees(\/|$)/i.test(rel) || rel.split("/").some((seg) => RETIRED_SKIP_DIRS.has(seg));
function repoFiles(ledger) {
  if (REPO_FILES.has(ledger)) return REPO_FILES.get(ledger);
  let files = null;
  if (hasGit(ledger.root)) {
    try {
      files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ledger.root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, maxBuffer: 256 * 1024 * 1024 }).split("\0").filter(Boolean);
    } catch {
      files = null;
    }
  }
  if (!files) {
    files = [];
    const rec = (dir, depth) => {
      if (depth > 12 || files.length > 100_000) return;
      let names;
      try {
        names = readdirSync(dir).sort();
      } catch {
        return;
      }
      for (const name of names) {
        const p = join(dir, name);
        let st;
        try {
          st = lstatSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (!RETIRED_SKIP_DIRS.has(name) && !name.startsWith(".")) rec(p, depth + 1);
        } else if (st.isFile()) files.push(posixify(relative(ledger.root, p)));
      }
    };
    rec(ledger.root, 0);
  }
  files = files.filter((f) => !notSource(f));
  REPO_FILES.set(ledger, files);
  return files;
}

// Anything at all at a repo-relative path — a file, a folder, a link
// (lstat, never followed).
function entryExists(root, rel) {
  try {
    lstatSync(resolveInside(root, rel, rel));
    return true;
  } catch {
    return false;
  }
}

// --kinds=<id>:<copy|extend>,… — the developer's answers to the proposed
// kinds, by the proposed file name.
function parseKinds(kinds) {
  const out = new Map();
  if (kinds === null || kinds === undefined || kinds === false || kinds === "") return out;
  for (const pair of String(kinds).split(",").map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z0-9][a-z0-9-]*):(copy|extend)$/.exec(pair);
    if (!m) throw new Error(`--kinds takes <file name>:<copy|extend> pairs, comma-separated (the names upgrade --plan printed) — got '${pair.slice(0, 60)}'`);
    out.set(m[1], m[2]);
  }
  return out;
}

// Every blessing still on a map page, with what the move would write
// (decision 0032). With `move`, each that can move is written to the store
// (created exclusively) and removed from its page; one that cannot (no
// question, no repo file for where:) stays and is named. Returns
// { proposals, moved, left }, each proposal { id, file, from, question,
// where, symbol, kind, appliesTo, firstBuiltIn, adrs, problem }.
function moveBlessings(ledger, paths, { move, kindOf }) {
  const binding = [];
  const { files, skipped } = listMapPages(ledger, paths.mapDir);
  for (const what of skipped) ledger.notes.push(`${paths.mapDir}: ${what} was not read for blessings to move — check it by hand`);
  const taken = new Set();
  const proposals = [];
  for (const rel of files) {
    const text = ledger.read(rel);
    const found = findMapBlessings(text);
    if (!found.items.length) continue;
    const pageType = /^---\r?\n[\s\S]*?^type:\s*(.+?)\s*$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
    const ctx = {
      page: rel,
      pageType,
      mapDir: paths.mapDir,
      blessingsDir: paths.blessingsDir,
      bundleDir: paths.bundleDir,
      metadataDir: paths.metadataDir,
      adrDir: paths.adrDir,
      isFile: (r) => {
        try {
          return ledger.exists(r);
        } catch {
          return false;
        }
      },
      readRecord: (r) => {
        try {
          return JSON.parse(ledger.read(r));
        } catch {
          return null;
        }
      },
      isDir: (r) => {
        try {
          return lstatSync(ledger.abs(r.replace(/\/+$/, ""))).isDirectory();
        } catch {
          return false;
        }
      },
      filesEndingWith: (tail) => repoFiles(ledger).filter((f) => f === tail || f.endsWith(`/${tail}`)),
    };
    const moved = [];
    for (const item of found.items) {
      const p = proposeMove(item, ctx);
      // A name is free only when nothing at all is there — a folder or a
      // link of that name takes it too (CR-001).
      let id = blessingSlug(p.question ?? item.text);
      for (let n = 2; taken.has(id) || ledger.pending.has(`${paths.blessingsDir}/${id}.md`) || entryExists(ledger.root, `${paths.blessingsDir}/${id}.md`); n++) id = `${blessingSlug(p.question ?? item.text)}-${n}`;
      taken.add(id);
      const proposed = p.kind;
      if (kindOf.has(id)) p.kind = kindOf.get(id);
      const proposal = { id, file: `${paths.blessingsDir}/${id}.md`, from: `${rel}:${item.first + 1}`, ...p };
      // The token covers what the developer reads, the proposed kind included
      // and the answer to it left out.
      binding.push(JSON.stringify([id, proposal.from, p.text, p.where, p.symbol, proposed, p.appliesTo, p.firstBuiltIn, p.adrs, p.problem]));
      delete proposal.text;
      proposals.push(proposal);
      if (!move || p.problem) continue;
      // The blessing leaves its page only once its file exists (CR-001).
      if (ledger.create(proposal.file, blessingFileText(p))) moved.push(item);
      else {
        proposal.problem = `${proposal.file} appeared during the run — it stays on the map; run upgrade --plan again`;
        ledger.notes.push(`${proposal.from}: this blessing was not moved — ${proposal.problem}`);
      }
    }
    if (moved.length) {
      ledger.overwrite(rel, removeMoved(text, found, moved));
      ledger.notes.push(`${rel}: ${moved.length} blessing${moved.length === 1 ? "" : "s"} moved to ${paths.blessingsDir}/ (2.5, decision 0032)`);
      // A Blessings heading that keeps prose of its own stays, and lint fails
      // on it until the prose finds a home (CR-019).
      const after = findMapBlessings(removeMoved(text, found, moved));
      if (!after.items.length && after.sections.length) ledger.notes.push(`${rel}: its Blessings heading stays, because something other than a blessing is under it — move that into the page's prose or a blessing, and remove the heading (lint fails while it is there)`);
    }
  }
  const unknownKind = [...kindOf.keys()].filter((id) => !proposals.some((p) => p.id === id));
  if (unknownKind.length) throw new Error(`--kinds names ${unknownKind.join(", ")}, which this run does not propose (it proposes ${proposals.length ? proposals.map((p) => p.id).join(", ") : "none"})`);
  const token = createHash("sha256").update(binding.join("\n")).digest("hex").slice(0, 8);
  const left = proposals.filter((p) => p.problem);
  if (proposals.length && !move) ledger.notes.push(`${proposals.length} blessing${proposals.length === 1 ? "" : "s"} still on map pages — listed below with what the move would write; once the developer has read the list (and the kind of each), run upgrade again with --move-blessings=${token} (and --kinds=<name>:<copy|extend>,… for any kind they change). lint fails while a blessing stays in the map`);
  for (const p of left) if (!/appeared during the run/.test(p.problem)) ledger.notes.push(`${p.from}: this blessing cannot move — ${p.problem}`);
  return { token, proposals, moved: move ? proposals.filter((p) => !p.problem) : [], left };
}


// ---------------------------------------------------------------------------
// What each release brings an existing adopter (2.2.0): one entry per
// release an upgrade crosses, said only when the repo's engine pin is older.
// Every minor has an entry — a test fails a release without one, and the
// `upgrade` skill carries a matching "Upgrading to X.Y" section. Each note
// opens with its release so the narration reads as a changelog.
// ---------------------------------------------------------------------------
const extractorsOn = (config) => new Set((Array.isArray(config.extractors) ? config.extractors : []).map((n) => (Object.hasOwn(RENAMED_EXTRACTORS, n) ? RENAMED_EXTRACTORS[n] : n)));
// Every upgrade re-runs detection and offers each opt-in extractor that is
// off but has evidence (2.4.1, from the first adopter: the offer lived in the 2.1
// note, so the first adopter's 2.2.1 → 2.4.0 never saw `jobs`, though 2.3 had widened it
// to the first adopter's cron and worker). Never added by upgrade, and a
// "no" is not remembered: the line comes back while the evidence does.
// Which adapters are opt-ins is each adapter's word (DETECTION.optIn, 0039).
function offerOptIns(root, config) {
  const notes = [];
  const have = extractorsOn(config);
  let d;
  try {
    d = detect(root);
  } catch {
    return ["could not re-run detection here — run `bootstrap.mjs detect` to see whether an opt-in extractor applies"];
  }
  for (const p of d.proposals ?? []) {
    if (!d.adapters?.[p.name]?.optIn || have.has(p.name)) continue;
    notes.push(
      `offers the opt-in extractor \`${p.name}\` — evidence: ${(p.evidence ?? []).join("; ")}. ` +
        `Never added by upgrade: on the user's word, a repair apply with it in "extractors" (and its options: ${JSON.stringify(p.options ?? {})})`,
    );
  }
  return notes;
}
// 2.3 (2.3.0, pick 3): the extractor `services` is `external-services`, its
// record kind `service` is `external-service`. The engine accepts the old
// names for one release; upgrade rewrites them here, so the alias is never
// what an upgraded repo relies on.
const RENAMED_EXTRACTORS = { services: "external-services" };
// 0.9 (decision 0038): the record `job` is `background-task`.
const RENAMED_KINDS = { service: "external-service", job: "background-task" };
// border: names a stack (the 0.9 migration of `jobs` names the readers that replace it)
// 0.9 (decision 0038): the `jobs` extractor is one reader per platform file.
// The readers are the ones detection finds evidence for, plus
// background-declared when the config declares tasks by hand
// (`jobs.entries`) and background-github-actions when it opted in
// (`includeGithubActions`). `roots` goes to every reader (each walks it);
// `exclude` and `modes` to the readers that read processes; `entries` and
// `modes` to background-declared (an entry's mode may live in `modes`,
// CR-081). Written where `jobs` sat, in name order. A reader's options that
// already exist are kept when they hold the same values, else the upgrade
// stops before writing (CR-085). When `jobs` is listed and no reader can be
// named — detection failed or found nothing — the upgrade stops rather than
// write a config with no reader in its place (CR-084).
const PROCESS_READERS = new Set(["background-procfile", "background-compose", "background-railway"]);
function migrateJobs(config, changes, root) {
  const listed = Array.isArray(config.extractors) && config.extractors.includes("jobs");
  const hasOpts = isPlainObject(config.extractorOptions) && Object.hasOwn(config.extractorOptions, "jobs");
  if (!listed && !hasOpts) return;
  const o = hasOpts && isPlainObject(config.extractorOptions.jobs) ? config.extractorOptions.jobs : {};
  let found = [];
  let detectError = null;
  try {
    found = (detect(root).proposals ?? []).filter((p) => (p.parts ?? []).includes("background tasks")).map((p) => p.name);
  } catch (e) {
    detectError = e;
  }
  const readers = [...new Set([...found, ...(Array.isArray(o.entries) && o.entries.length ? ["background-declared"] : []), ...(o.includeGithubActions === true ? ["background-github-actions"] : [])])].sort();
  if (listed && !readers.length) {
    throw new Error(
      `zdd/config.json lists "jobs", which 0.9 splits into one background-* reader per platform file (decision 0038), but ${detectError ? `detection could not run here (${detectError.message})` : "detection finds no background work under the repo (it reads six folders deep)"} — nothing was written. ` +
        `Replace "jobs" in "extractors" by hand with the readers for the files you commit (background-procfile, background-railway, background-vercel, background-cloudflare, background-compose, background-pg-cron, background-bullmq, background-inngest, background-trigger-dev, background-sqs, background-github-actions, background-declared), move extractorOptions.jobs to them, and run the upgrade again`,
    );
  }
  if (listed) {
    const at = config.extractors.indexOf("jobs");
    const rest = config.extractors.filter((n) => n !== "jobs");
    const add = readers.filter((n) => !rest.includes(n));
    config.extractors = [...rest.slice(0, at), ...add, ...rest.slice(at)];
  }
  if (hasOpts) {
    const pick = (keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
    const optionsFor = (n) => (n === "background-declared" ? pick(["roots", "entries", "modes"]) : PROCESS_READERS.has(n) ? pick(["roots", "exclude", "modes"]) : pick(["roots"]));
    // A reader whose options already exist (a half-migrated config): kept
    // when every moved value is already there unchanged, else stop (CR-085).
    for (const n of readers) {
      if (!Object.hasOwn(config.extractorOptions, n)) continue;
      const have = isPlainObject(config.extractorOptions[n]) ? config.extractorOptions[n] : {};
      const moved = optionsFor(n);
      const differs = Object.keys(moved).filter((k) => JSON.stringify(have[k]) !== JSON.stringify(moved[k]));
      if (differs.length) throw new Error(`zdd/config.json has both extractorOptions.jobs and extractorOptions["${n}"], and they disagree on ${differs.join(", ")} — merge them by hand into "${n}", delete extractorOptions.jobs, then run the upgrade again; nothing was written`);
    }
    const next = {};
    for (const [k, v] of Object.entries(config.extractorOptions)) {
      if (k !== "jobs") next[k] = v;
      else for (const n of readers) if (!Object.hasOwn(config.extractorOptions, n)) next[n] = optionsFor(n);
    }
    config.extractorOptions = next;
  }
  changes.push(
    readers.length
      ? `extractor "jobs" → ${readers.map((n) => `"${n}"`).join(", ")} (0.9, decision 0038: one reader per platform file, from what detection finds), its options moved to the readers that own them`
      : `extractor "jobs" removed (0.9, decision 0038): detection finds no background work here — add the background-* reader for a platform file you commit`,
  );
}
// border: end

function migrateRenames(config, changes) {
  // Each step on its own (CR-305): a half-migrated config — the new extractor
  // name beside the old options key, or the old strict kind — is finished
  // whichever part is left.
  for (const [old, now] of Object.entries(RENAMED_EXTRACTORS)) {
    if (Array.isArray(config.extractors) && config.extractors.includes(old)) {
      // Every occurrence (CR-317): a duplicated old name collapses to one new one.
      const rest = config.extractors.filter((n) => n !== old);
      const at = config.extractors.indexOf(old);
      config.extractors = rest.includes(now) ? rest : [...rest.slice(0, at), now, ...rest.slice(at)];
      changes.push(`extractor "${old}" → "${now}" (2.3: the records are third-party systems, not a code service layer)`);
    }
    if (isPlainObject(config.extractorOptions) && Object.hasOwn(config.extractorOptions, old)) {
      // Both keys with different contents is a conflict the engine refuses;
      // upgrade must not pick one silently (CR-402).
      if (Object.hasOwn(config.extractorOptions, now) && JSON.stringify(config.extractorOptions[old]) !== JSON.stringify(config.extractorOptions[now])) {
        throw new Error(`zdd/config.json has both extractorOptions.${old} and extractorOptions["${now}"] with different contents — merge them by hand into "${now}" (they are one extractor), then run the upgrade again; nothing was written`);
      }
      // Keep the adopter's key order: the new key where the old one sat.
      const next = {};
      for (const [k, v] of Object.entries(config.extractorOptions)) {
        if (k === old) {
          if (!Object.hasOwn(config.extractorOptions, now)) next[now] = v;
        } else next[k] = v;
      }
      config.extractorOptions = next;
      changes.push(`extractorOptions.${old} → extractorOptions["${now}"]`);
    }
  }
  if (isPlainObject(config.claims)) {
    for (const [old, now] of Object.entries(RENAMED_KINDS)) {
      if (Array.isArray(config.claims.strictKinds) && config.claims.strictKinds.includes(old)) {
        const at = config.claims.strictKinds.indexOf(old);
        const rest = config.claims.strictKinds.filter((k) => k !== old);
        config.claims.strictKinds = rest.includes(now) ? rest : [...rest.slice(0, at), now, ...rest.slice(at)];
        changes.push(`claims.strictKinds "${old}" → "${now}"`);
      }
      // The allow-list names records by id; the ids move with the kind (CR-304).
      if (Array.isArray(config.claims.allowUnclaimed) && config.claims.allowUnclaimed.some((id) => typeof id === "string" && id.startsWith(`${old}:`))) {
        config.claims.allowUnclaimed = config.claims.allowUnclaimed.map((id) => (typeof id === "string" && id.startsWith(`${old}:`) ? `${now}:${id.slice(old.length + 1)}` : id));
        changes.push(`claims.allowUnclaimed "${old}:…" ids → "${now}:…"`);
      }
    }
  }
}
// The map's links to records of a renamed kind: `…/metadata/service/x.json`
// → `…/metadata/external-service/x.json`, in every page under mapDir. A
// mechanical pointer at a generated file, never the adopter's prose — the
// old folder is gone after the next derive, and a link the render cannot
// resolve blocks it.
const MAP_WALK_DEPTH = 16; // the render's own bound (lib/walk-markdown.mjs)
const MAP_WALK_ENTRIES = 20_000; // and its entry budget
// Apply `fn` to the text outside fenced code blocks (``` or ~~~, the
// CommonMark shape), leaving the fences and their contents byte for byte.
export function outsideFences(text, fn) {
  const lines = text.split("\n");
  const out = [];
  let run = [];
  let fence = null;
  const flush = () => {
    if (run.length) out.push(fn(run.join("\n")));
    run = [];
  };
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim()) fence = null;
      continue;
    }
    if (m) {
      flush();
      fence = m[1];
      out.push(line);
      continue;
    }
    run.push(line);
  }
  flush();
  return out.join("\n");
}

// Every Markdown page under mapDir, walked the render's way: bounded depth
// and entries, symlinks never followed, oversized pages named and skipped.
function listMapPages(ledger, mapDir) {
  const abs = ledger.abs(mapDir);
  if (!existsSync(abs)) return { files: [], skipped: [] };
  const skipped = [];
  const found = [];
  let entries = 0;
  const rec = (dir, depth) => {
    if (++entries > MAP_WALK_ENTRIES) {
      if (entries === MAP_WALK_ENTRIES + 1) skipped.push(`${mapDir}/ (more than ${MAP_WALK_ENTRIES} entries — the rest was not read)`);
      return;
    }
    if (depth > MAP_WALK_DEPTH) {
      skipped.push(`${posixify(relative(ledger.root, dir))}/ (deeper than ${MAP_WALK_DEPTH} folders)`);
      return;
    }
    let names;
    try {
      names = readdirSync(dir).sort();
    } catch {
      skipped.push(`${posixify(relative(ledger.root, dir))}/ (unreadable)`);
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        skipped.push(`${posixify(relative(ledger.root, p))} (unreadable)`);
        continue;
      }
      if (++entries > MAP_WALK_ENTRIES) {
        if (entries === MAP_WALK_ENTRIES + 1) skipped.push(`${mapDir}/ (more than ${MAP_WALK_ENTRIES} entries — the rest was not read)`);
        return;
      }
      if (st.isSymbolicLink()) skipped.push(`${posixify(relative(ledger.root, p))} (a symlink — never followed)`);
      else if (st.isDirectory()) rec(p, depth + 1);
      else if (st.isFile() && /\.md$/i.test(name)) found.push(p);
    }
  };
  rec(abs, 0);
  const files = [];
  for (const p of found) {
    const rel = posixify(relative(ledger.root, p));
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.size > MAX_SCAN_BYTES) {
      skipped.push(`${rel} (over ${MAX_SCAN_BYTES / 1024} KiB — not read)`);
      continue;
    }
    files.push(rel);
  }
  return { files, skipped };
}

function migrateMapLinks(ledger, mapDir, metadataDir = "zdd/metadata") {
  const touched = [];
  const { files, skipped } = listMapPages(ledger, mapDir);
  const metaPrefix = metadataDir.replace(/\/+$/, "");
  for (const rel of files) {
    const text = ledger.read(rel);
    const pageDir = posix.dirname(rel);
    // A fenced code block is an example, not a pointer: left as written (CR-518).
    const rewrite = (chunk) => {
    let next = chunk;
    for (const [old, now] of Object.entries(RENAMED_KINDS)) {
      // A link destination as the render reads it: `](dest)` or `](<dest>)`,
      // with an optional `#fragment`. Rewritten only when the destination,
      // resolved from the page, lands under <metadataDir>/<old>/ (CR-410): a
      // URL, or some other tree that happens to hold a `service/` folder,
      // is the adopter's prose and stays.
      next = next.replace(new RegExp(`\\]\\((<?)([^)<>\\s]*/${old}/[^)<>/\\s#]+\\.json)((?:#[^)<>\\s]*)?)(>?)\\)`, "g"), (whole, lt, dest, frag, gt) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("//")) return whole;
        // A leading `/` is BUNDLE-relative — `/metadata/service/x.json` is
        // how the render reads it (lib/map-links.mjs: `join(bundleDir,
        // target)`), and how every adopter's map writes it — never
        // repo-root-relative (2.4.0: 2.3's rewrite read it as
        // `metadata/service/…` from the repo root, matched nothing, and
        // the second adopter's dry run went red on the records the links no longer
        // claimed). `/service/x.json` is still prose (CR-428).
        const bundle = posix.dirname(metaPrefix);
        const resolved = dest.startsWith("/") ? posix.normalize(posix.join(bundle === "." ? "" : bundle, dest.replace(/^\/+/, ""))) : posix.normalize(posix.join(pageDir, dest));
        if (!(resolved === `${metaPrefix}/${old}` || resolved.startsWith(`${metaPrefix}/${old}/`))) return whole;
        const moved = dest.replace(new RegExp(`/${old}/([^/]+\\.json)$`), `/${now}/$1`);
        return `](${lt}${moved}${frag}${gt})`;
      });
    }
    return next;
    };
    const next = outsideFences(text, rewrite);
    if (next !== text) {
      ledger.overwrite(rel, next);
      touched.push(rel);
    }
  }
  return { touched, skipped };
}
// border: names a stack (each release's upgrade note, as that release printed it)
export const UPGRADE_NOTES = {
  "1.1.0": ({ version }) => [
    "1.1 adds a blocking lint (a blessing citing a superseded or missing ADR fails `lint`) — run `npx -y " + ENGINE_PACKAGE + "@" + version + " lint` before pushing; a red result is the lint doing its job on a stale blessing",
  ],
  "1.2.0": () => [
    "1.2 adds the `react-router` extractor (detection offers it), a lint warning listing unclaimed records (never a failure), and their count in the human index header — the human index re-renders on the bump",
  ],
  "1.3.0": ({ config }) => [
    "1.3 adds the `extractor` skill: it scaffolds a local extractor for a stack ZDD does not read yet",
    ...(config.claims === undefined
      ? [
          '1.3 adds claims.strict: lint can enforce "every record belongs to exactly one feature slice" — an unclaimed record not on an allow-list, a stale allow-list entry, or a record two slices claim then FAILS. It is off until you add it to zdd/config.json: "claims": { "strict": true, "allowUnclaimed": ["route:/health"] }. Without it, double claims are a warning beside the unclaimed list',
        ]
      : []),
  ],
  "1.3.1": () => ["1.3.1 fixes the ADR index link cut — render bytes change only where an index line was cut inside a link"],
  "2.0.0": ({ paths }) => [
    `2.0 adds "choose patterns" (skill: patterns) and a fifth generated artifact, ${paths.blessingIndex} — run \`render\` and commit it in this PR, or render --check fails`,
    '2.0 makes a blessing that does not open with its trigger question ("Adding an endpoint? …") FAIL lint — run `lint` and show the developer every blessing it names; upgrade never rewrites the map, so add each question on their word',
  ],
  "2.1.0": ({ root, config }) => {
    const notes = [];
    const have = extractorsOn(config);
    // The opt-in extractors are offered by every upgrade (offerOptIns), not here.
    // Per web extractor (CR-009); a malformed list counts as unnamed (CR-011).
    const opts = isPlainObject(config.extractorOptions) ? config.extractorOptions : {};
    const named = { "react-router": opts["react-router"]?.subscribeCalls, nextjs: opts.nextjs?.refs?.subscribeCalls };
    const unnamed = have.has("supabase") ? ["react-router", "nextjs"].filter((w) => have.has(w) && !(isCallList(named[w]) && named[w].length)) : [];
    if (unnamed.length) {
      notes.push(
        '2.1 maps realtime subscriptions as `subscribes` edges: the Supabase client\'s own `.on("postgres_changes", { table })` needs nothing, but a wrapper (e.g. `live.onInsert("table", …)`) is invisible until named — ask whether the app has one, and record it in ' +
          unnamed.map((w) => (w === "nextjs" ? "extractorOptions.nextjs.refs.subscribeCalls" : "extractorOptions.react-router.subscribeCalls")).join(" / "),
      );
    }
    if (config.claims?.strict === true && config.claims.strictKinds === undefined) {
      notes.push("2.1 adds claims.strictKinds: strict governs the new kinds (component, job, external-service — spelt service before 2.3) only where listed, so switching an opt-in extractor on never turns lint red by itself (decision 0017)");
    }
    notes.push(
      "2.1 corrects a `*` in a scanned url: it no longer matches a fixed route segment (`/health`), so refs drop wherever a wildcard had reached one — expect a `derive --check` diff on the pin bump, and lint names the calls it could not place",
    );
    return notes;
  },
  "2.1.1": () => [
    "2.1.1 moves bytes wherever a fix applies — schema-qualified tables (`public.x`) gain their edges and trigger facts, component descriptions come from the comment attached to the component, an External services list links `.json` — so re-derive and re-render on the bump",
  ],
  "2.2.0": () => [
    '2.2 locks the repo to its ZDD release (decision 0021) and adds a spoken verb, "upgrade ZDD" (skill: upgrade) — this guided flow. The instruction block gains the rules every adopter needs: a release or skew line is the first line of the reply; generated-file conflicts are merged, committed, then regenerated, never hand-resolved; "update ZDD" is never delegated; a developer joining the repo installs zdd for this project',
    "2.2 next step for the team: after this PR merges, each developer's next session start prints one line naming the exact commands that move their machine to this release — run them, then restart",
  ],
  "2.2.1": () => ["2.2.1 makes the session-start checks read Claude Code's own profile (CLAUDE_CONFIG_DIR when set, CLAUDE_CODE_PLUGIN_CACHE_DIR for the plugins folder, and the transcript path when a hook's environment is scrubbed) — in the repo only the engine pins and the lock move"],
  "2.3.0": ({ config, paths }) => {
    const notes = [
      `2.3 moves ZDD's rules out of the marked block in CLAUDE.md into ${paths.bundleDir === "." ? "instructions.md" : `${paths.bundleDir}/instructions.md`}, loaded by one line (\`@${paths.bundleDir === "." ? "" : paths.bundleDir + "/"}instructions.md\`) — this run replaces the block with the line once and never edits CLAUDE.md again; AGENTS.md keeps a block (Codex has no import). The rules gained: both install commands in order, the three cases a release line can mean, the merge-conflict steps, reuse-first in "choose patterns", and where a ZDD defect is filed (decision 0024)`,
      "2.3 reads your own CLAUDE.md / AGENTS.md text against ZDD's rules per paragraph or bullet, with what ZDD now says beside each (the plan lists them), and sweeps your files for names a release retired — each hit above names its replacement",
      "2.3: what git ignores is never source — derive skips every gitignored path and .claude/worktrees/ (decision 0026); a record that named one changes on the bump, and derive now stops when git cannot list the ignored set",
    ];
    const names = Array.isArray(config.extractors) ? config.extractors : [];
    if (names.includes("services") || names.includes("external-services")) {
      notes.push("2.3 renames the `services` extractor to `external-services` and its records from `service` to `external-service` (decision 0023): the config keys, claims.strictKinds, the allow-list ids and the map's links were rewritten above; the next derive moves zdd/metadata/service/ to zdd/metadata/external-service/ — commit both; a hand-written map/services/ folder is yours to rename or keep");
    }
    if (names.includes("jobs")) {
      notes.push("2.3 widens the jobs extractor into background work (decision 0025): Vercel crons, Railway and Cloudflare schedules, pg_cron, Compose workers and BullMQ / Inngest / Trigger.dev / SQS queues, each with its trigger and what it hits, in a Background work section of the agent index — and a package.json script counts only when a manifest runs it, so a hand-run script's job record leaves on the bump; GitHub Actions schedules are listed only with extractorOptions.jobs.includeGithubActions: true");
    }
    notes.push("2.3 adds agentIndex.budgetTokens (default 2000) and agentIndex.levels (1 or 2) — set levels to 2 when the index warns it is over budget: areas first, one file per area under zdd/agent-index/, each feature one hop away; and `lint` warns on a blessing that points at no code (a blessing is a pointer to reusable code to start from — authoring.md has the test)");
    notes.push("2.3 writes .gitattributes (zdd/ pinned to LF) and runs a preflight (Node 20+, npx, git, github.com, the npm registry, the pinned engine) before an install or an upgrade; the CI workflow is offered only on GitHub — elsewhere the merge gate is three commands for your own pipeline");
    return notes;
  },
  "2.4.0": ({ paths }) => [
    `2.4 adds the ZDD record (decisions 0027–0029): the instructions file (${paths.bundleDir === "." ? "instructions.md" : `${paths.bundleDir}/instructions.md`}, rewritten by this run) now asks the agent to say one \`ZDD: …\` line, at the moment and without stopping, whenever an artifact turned or confirmed a decision or showed code to reuse — and "update ZDD" writes those lines into the update commit's message as a \`ZDD record:\` with five sections (glossary, adrs, blessings, map, comments) in plain sentences. The \`Pattern record:\` it replaces is still read as the blessings section`,
    "2.4 adds `zdd-engine tally [--since <ref|date>] [--json]`: per section, how often an artifact turned, confirmed, was reused or stored, over the branch's history, then the ADRs, glossary terms and blessings in the stores that no record ever named — the evidence of what ZDD buys this repo. A squash merge loses the record unless the merger keeps the message; a merge commit keeps it",
    "2.4 makes `lint --merge` (the CI step) WARN, never fail, on a record the tally cannot fully read — a missing section, an unknown verb, a `turned` or `confirmed` that does not say what would otherwise have happened; a branch with no update commit is never warned. No config-schema or metadata-contract change; derive and render bytes do not move on the bump",
  ],
  // 2.4.1: the findings from both adopters' moves to 2.4.0.
  "2.4.1": ({ paths, config }) => {
    const notes = [
      `2.4.1 rewrites the instructions file (${instructionsRel(paths.bundleDir)}): every \`ZDD: …\` line, and every moment the agent finds or creates an artifact, names it as ZDD's ("ZDD blessing", "ZDD ADR", "the ZDD glossary"); a merge conflict in a generated file is regenerated mid-merge (derive, render, add, commit the merge, then render once more) — never a checked-out side, which the fence refuses; two ADRs with one number are renumbered by the later branch. The text pass below now asks only about rules changed since this repo's engine pin (decision 0030)`,
      "2.4.1: a declared background job whose start command names a file not in the repo (build output, e.g. `node dist/server.js`) now WARNS on every derive with the `jobs.entries` remedy, instead of being skipped silently. No config-schema or metadata-contract change; derive and render bytes do not move on the bump",
    ];
    if (extractorsOn(config).has("jobs")) {
      notes.push("2.4.1: a committed `railway.toml` / `railway.json` is read for the map, and Railway reads it too — its values override the dashboard, and Railway is retiring those files (old ones work until 2026-12-01). Commit one only if Railway should apply it; otherwise keep it matching what the dashboard runs, as a statement for the map");
    }
    return notes;
  },
  "2.5.0": ({ paths }) => [
    `2.5 moves blessings out of the semantic map into ${paths.blessingsDir}/, one file each with where: and kind: in its header (decisions 0031, 0032) — the list is below; run upgrade again with --move-blessings once the developer has read it and checked each kind, then render: the blessing index says where and why on every line, and render --check moves`,
    "2.5 makes these FAIL lint, each cleared by the move or named by it (decision 0035): a Blessings section left on a map page, a blessing with no where: or one naming no file, no kind: or one that is neither copy nor extend, an applies-to: naming no app or package page",
    "2.5 adds an opt-in harness ADR set (decisions 0033, 0034): how-the-team-builds decisions in a folder and index of their own, on one number line with the product's, so the application index can be handed to a stakeholder as it stands. Upgrading splits nothing; when the team wants it, `split-adrs --plan` proposes a set per ADR (a `Scope:` tag line decides) and the write moves them on the developer's word",
  ],
};
// border: end

export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(/[.-]/).map(Number);
  const pb = String(b).replace(/^v/, "").split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// ---------------------------------------------------------------------------
// Duplicates outside the managed block (2.2.0). A markdown section — its
// heading down to the next heading of the same or a higher level — is named
// when its own text (heading and the lines before its first child) speaks of
// ZDD, and every child section is named too: a section that also carries
// unrelated subsections is never named whole. Lines inside the managed block
// and inside fenced code are not read. Line numbers are 1-based, inclusive.
// ---------------------------------------------------------------------------
// A section speaks of ZDD when its heading does, when it uses a spoken verb,
// or when it mentions ZDD at least twice — one passing mention ("the ZDD
// check runs in CI", a title's "smoke-test the ZDD plugin") is not a rule the
// block duplicates (found by the 2.2.0 smoke). The document's title (its
// first heading, at level 1) is never named.
// The rules ZDD's instructions state (2.3.0, finding 4, C8): the finder
// reads the adopter's own text — outside the import line or the block — one
// paragraph or bullet at a time, and names every unit that speaks to one of
// these rules, with what ZDD now says beside it. The skill then reads the two
// side by side ("same, different, or contradicting") and the user decides;
// `--drop` removes that unit, never a whole section. A passing mention of
// ZDD ("a tiny app used to smoke-test the ZDD plugin") matches no rule. A
// test keeps every rule's `says` true to templates/instructions.md.
//
// `since` is the release that last changed what the rule says (2.4.1
// finding 3): an upgrade from X lists only the units speaking to a rule
// changed after X, so a team that has read its text against a rule is not
// asked again until ZDD changes that rule (the second adopter's 2.3 run listed 33
// paragraphs, none droppable). A test pins each `says` to its `since`.
export const INSTRUCTION_RULES = [
  { id: "load", since: "2.4.0", match: /\bload ZDD\b/i, says: '"load ZDD" before designing or building in an area: read the glossary whole, the ADR index whole and the ADRs the task cites, say what you loaded, then read the code fresh' },
  { id: "patterns", since: "2.3.0", match: /\bchoose patterns\b|\bblessing-index\b|\bpatterns-plan\b/i, says: '"choose patterns" once the design is settled, before any code: check for existing code to reuse first, then the blessings that match, and commit zdd/patterns-plan.md' },
  { id: "update", since: "2.4.0", match: /\bupdate ZDD\b/i, says: '"update ZDD" before finishing a unit of work: curate what the change touched, reconcile the pattern plan, regenerate, commit with the code; never handed to a subagent' },
  { id: "upgrade", since: "2.3.0", match: /\bupgrade ZDD\b|\bbootstrap\s+--upgrade\b/i, says: '"upgrade ZDD" moves the repo to a newer release and shows every change before writing it' },
  { id: "skew", since: "2.3.0", match: /\b(?:release|engine[- ]skew|skew|mismatch) line\b|release mismatch|first line of (?:your|the) reply/i, says: "a release or engine-skew line is the first line of the reply, verbatim, and is fixed before the task — the fix depends on the case (machine behind the lock: the commands printed; branch behind main: merge main; repo behind the newest release: upgrade ZDD, by choice)" },
  { id: "generated", since: "2.4.1", match: /hand-edit|\bzdd\/(?:metadata|graph\.json|agent-index\.md|adr-index\.md|blessing-index\.md|human-index\.html)\b|\bzdd\/agent-index\/|generated artifacts?\b/i, says: "the generated artifacts (zdd/metadata/, graph.json, the agent index and its area folder when it has two levels, the ADR and blessing indexes, the human index) and zdd/instructions.md are never hand-edited" },
  { id: "merge", since: "2.4.1", match: /(?:merge|rebase)[^.\n]*\b(?:deriv|render|regenerat|generated|conflict)|\b(?:conflict|generated)[^.\n]*\b(?:merge|rebase)/i, says: "a merge conflict in a generated file is never resolved by hand nor by checking out a side: with the merge open, derive then render (they overwrite it), git add, commit the merge, then render once more and commit (the changed-on-this-branch section reads the merge-base); on a rebase, at each stop derive, render, git add, git rebase --continue, then render once more at the end and commit" },
  { id: "renumber", since: "2.4.1", match: /\bduplicate ADR number\b|\brenumber\b|\btwo ADRs (?:with|sharing) (?:one|a|the same) number\b/i, says: "two ADRs with one number fail lint: the first to merge keeps it; the later branch takes the next free number, renames its file, and rewrites every citation (supersession stamps, glossary and map links, code comments; a ZDD record already committed gets an amended record line), then regenerates" },
  { id: "install", since: "2.3.0", match: /plugin (?:install|update) (?:zdd|mattpocock-skills)|skills are missing|zdd@zero-drift-docs|mattpocock-skills@/i, says: "if ZDD's skills are missing: from the repo's folder, claude plugin install mattpocock-skills@zero-drift-docs --scope project, then claude plugin install zdd@zero-drift-docs --scope project, then restart; this repo switches other copies of Matt Pocock's skills off on purpose" },
  { id: "grill", since: "2.3.0", match: /\bgrill\b/i, says: "grill is optional: a design interview that writes glossary terms and ADRs as they crystallize; without Matt Pocock's skills, plan mode plus \"update ZDD\"" },
  { id: "findings", since: "2.3.0", match: /zero-drift-docs\/issues|\bZDD defect\b/i, says: "a ZDD defect goes to ZDD's issues page, labelled finding, proposed to the developer first" },
  { id: "blessings", since: "2.5.0", match: /\bblessings?\b/i, says: "blessings live in zdd/blessings/, one file each with where: and kind: in its header, never on a semantic-map page; the map holds the groupings and edges; extending an extend blessing's code means retesting what uses it" },
  { id: "record", since: "2.4.1", match: /\bZDD record\b|\bPattern record\b|\bzdd-engine tally\b|`ZDD: |\bZDD: \S+ (?:turned|confirmed|reused)\b/i, says: "when a ZDD artifact turns or confirms a decision, or shows code to reuse, say one `ZDD: …` line at the moment with what would otherwise have happened, and carry on; name the artifact as ZDD's (\"ZDD blessing\", \"ZDD ADR\", \"the ZDD glossary\") there and whenever you find or create one; \"update ZDD\" writes those lines as the ZDD record (five sections, plain sentences) into the update commit's message, which `zdd-engine tally` counts over history" },
];
const talksZdd = (heading, own) => new RegExp(ZDD_MENTION.source, "i").test(heading) || ZDD_VERB.test(own) || (own.match(ZDD_MENTION) ?? []).length >= 2;
export function findDuplicates(text) {
  return findRuleUnits(text);
}
// Units of the adopter's own text — a paragraph, or a bullet with its
// indented continuation — outside the block and the import lines, that
// speak to a rule. Nothing is reported unless the file carries the import
// line or exactly one well-formed block: with broken markers the run cannot
// say where ZDD's text ends and the adopter's begins (CR-002).
export function findRuleUnits(text) {
  const lines = text.split(/\r?\n/);
  const hasImport = IMPORT_LINE_RE.test(text);
  const nb = count(text, SNIPPET_BEGIN);
  const ne = count(text, SNIPPET_END);
  const wellFormed = nb === 1 && ne === 1 && indexOfMarker(text, SNIPPET_BEGIN) < indexOfMarker(text, SNIPPET_END) && text.split(SNIPPET_BEGIN).length === 2 && text.split(SNIPPET_END).length === 2;
  if (!hasImport && !wellFormed) return [];
  if (nb || ne || text.includes(SNIPPET_BEGIN) || text.includes(SNIPPET_END)) if (!wellFormed) return [];
  const out = [];
  let inBlock = false;
  let inFence = false;
  let heading = "(top)";
  let unit = null; // { from, to, lines }
  const flush = () => {
    if (!unit) return;
    const body = unit.lines.join("\n");
    const rules = INSTRUCTION_RULES.filter((r) => r.match.test(body)).map((r) => r.id);
    if (rules.length) out.push({ heading, from: unit.from, to: unit.to, text: body, rules });
    unit = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t === SNIPPET_BEGIN) {
      flush();
      inBlock = true;
      continue;
    }
    if (t === SNIPPET_END) {
      inBlock = false;
      continue;
    }
    if (inBlock) continue;
    if (/^(`{3,}|~{3,})/.test(t)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (t === "" || t === IMPORT_COMMENT || /^@\S+\/instructions\.md$/.test(t)) {
      flush();
      continue;
    }
    if (/^#{1,6}\s/.test(t)) {
      flush();
      heading = t;
      continue;
    }
    const bullet = /^(?:[-*+]|\d+[.)])\s/.test(t);
    const continuation = /^\s/.test(line);
    if (unit && (bullet || (!continuation && unit.bullet))) flush();
    if (!unit) unit = { from: i + 1, to: i + 1, lines: [line], bullet };
    else {
      unit.to = i + 1;
      unit.lines.push(line);
    }
  }
  flush();
  return out;
}
// The pre-2.3 section finder, kept for its tests' sake and for nothing else.
const ZDD_VERB = /\b(?:load|update|upgrade) ZDD\b|choose patterns/i;
const ZDD_MENTION = /\bZDD\b|zero[- ]drift|\bzdd\/|zdd-engine|agent-index|blessing-index/gi;
export function findDuplicateSections(text) {
  const lines = text.split(/\r?\n/);
  // Only beside exactly one well-formed block (CR-002): with no block nothing
  // covers the section, and with a lone, doubled or reversed marker the
  // refresh is refused, so the block cannot be said to carry anything.
  if (text.split(SNIPPET_BEGIN).length !== 2 || text.split(SNIPPET_END).length !== 2) return [];
  const b = lines.findIndex((l) => l.trimEnd() === SNIPPET_BEGIN);
  const e = lines.findIndex((l) => l.trimEnd() === SNIPPET_END);
  if (b === -1 || e === -1 || b > e) return [];
  let fence = false;
  const heads = [];
  lines.forEach((l, i) => {
    if (b !== -1 && e !== -1 && i >= b && i <= e) return;
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+\S/.exec(l);
    if (m) heads.push({ i, level: m[1].length });
  });
  const blank = (i) => b !== -1 && e !== -1 && i >= b && i <= e;
  const sections = heads.map((h, k) => {
    const nextAny = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    const after = heads.slice(k + 1).find((x) => x.level <= h.level);
    let end = after ? after.i : lines.length;
    // A span never swallows the managed block: it stops where the block starts.
    if (b !== -1 && b > h.i && b < end) end = b;
    const own = lines.slice(h.i, nextAny).filter((_, j) => !blank(h.i + j)).join("\n");
    const children = heads.slice(k + 1).filter((x) => x.i < end && x.level > h.level && heads.slice(k + 1).find((y) => y.i < x.i && y.level < x.level && y.level > h.level) === undefined);
    const title = k === 0 && h.level === 1;
    return { ...h, end, talks: !title && talksZdd(lines[h.i], own), children: children.map((c) => c.i) };
  });
  const byLine = new Map(sections.map((s) => [s.i, s]));
  const named = (s) => s.talks && s.children.every((c) => named(byLine.get(c)));
  const out = [];
  const covered = (i) => out.some((d) => i >= d.from - 1 && i < d.to);
  for (const s of sections) {
    if (covered(s.i) || !named(s)) continue;
    out.push({ heading: lines[s.i].trim(), from: s.i + 1, to: s.end });
  }
  return out;
}
// A duplicate's id is a hash of its file, its first line and its exact text
// (CR-014): the user approves a section as and where the plan showed it, and
// a section edited or moved since no longer answers to the id.
// Only the rules changed since the repo's engine pin (`from`) are read again;
// no pin, or one that is not a version, reads them all. A prerelease or
// build pin (`2.4.0-rc.1`, `2.4.0+local` — the schema allows both) is read by
// its X.Y.Z core, a prerelease as BEFORE that release, so a rule changed in
// 2.4.0 is still read from 2.4.0-rc.1 (CR-008).
export function ruleChangedSince(rule, from) {
  const v = typeof from === "string" ? /^(\d+\.\d+\.\d+)(-[^+]*)?(\+.*)?$/.exec(from) : null;
  if (!v || !rule) return true;
  const cmp = compareVersions(rule.since, v[1]);
  return cmp > 0 || (cmp === 0 && v[2] !== undefined);
}
function findAllDuplicates(ledger, from = null) {
  const changed = (id) => ruleChangedSince(INSTRUCTION_RULES.find((x) => x.id === id), from);
  const all = [];
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    if (!ledger.exists(file)) continue;
    const text = ledger.read(file);
    const lines = text.split(/\r?\n/);
    // The id binds the section's text AND its place (CR-022, CR-023): identical
    // copies differ by line, and any edit above or inside the section between
    // the plan and the write changes the id, so the write refuses.
    for (const found of findDuplicates(text)) {
      const d = { ...found, rules: found.rules.filter(changed) };
      if (!d.rules.length) continue;
      const body = lines.slice(d.from - 1, d.to).join("\n");
      const id = createHash("sha256").update(`${file}\0${d.from}\0${body}`).digest("hex").slice(0, 8);
      all.push({ id, file, ...d });
    }
  }
  return all;
}
function dropSections(ledger, chosen) {
  const isHeading = (l) => /^#{1,6}\s/.test(l.trim());
  const isBoundary = (l) => {
    const t = l.trim();
    return isHeading(l) || t === SNIPPET_BEGIN || t === IMPORT_COMMENT || /^@\S+\/instructions\.md$/.test(t);
  };
  for (const file of new Set(chosen.map((d) => d.file))) {
    const text = ledger.read(file);
    const eol = /\r\n/.test(text) ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    const mine = chosen.filter((d) => d.file === file).sort((x, y) => y.from - x.from);
    const notes = [];
    for (const d of mine) {
      let start = d.from - 1;
      let end = d.to;
      while (end < lines.length && lines[end].trim() === "") end++;
      // The unit was all its section held: the heading, left empty, goes too.
      let h = start - 1;
      while (h >= 0 && lines[h].trim() === "") h--;
      const headingWent = h >= 0 && isHeading(lines[h]) && (end >= lines.length || isBoundary(lines[end]));
      if (headingWent) start = h;
      lines.splice(start, end - start);
      // Exactly one blank line between what remains.
      if (start > 0 && start < lines.length && lines[start - 1].trim() === "" && lines[start].trim() === "") lines.splice(start, 1);
      notes.unshift(`${file}: removed ${lineRange(d)} under "${d.heading}" (${brief(d.text)})${headingWent ? ", and the heading it was all of" : ""}, on the user's word — ZDD's instructions now carry it`);
    }
    ledger.overwrite(file, lines.join(eol));
    ledger.notes.push(...notes);
  }
}
const lineRange = (d) => (d.from === d.to ? `line ${d.from}` : `lines ${d.from}–${d.to}`);
const brief = (s) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 90 ? one.slice(0, 87) + "…" : one;
};
// Names a release retired (2.3.0, 7, C9). Every upgrade greps the adopter's
// instruction files and docs for each one and lists the hits with the
// replacement; the old engine pin, when it moved this run, is looked for too
// (the first adopter keeps its own lock test). Advisory, bounded, never a failure.
export const RETIRED_NAMES = [
  { since: "2.2.0", find: /\bzdd:bootstrap --upgrade\b|\bbootstrap --upgrade\b/g, now: '"upgrade ZDD" (the upgrade skill)' },
  { since: "2.3.0", find: /\bextractorOptions\.services\b|\bmetadata\/service\/|"services"(?=\s*[,\]])/g, now: "the `external-services` extractor and `metadata/external-service/` (the 2.3 rename)" },
  { since: "2.3.0", find: /\bstrictKinds\b[^\n\]]*"service"|(?<![-\w])service:[a-z0-9][a-z0-9-]*\b/g, now: "the strict kind `external-service` and `external-service:<id>` ids (the 2.3 rename)" },
  { since: "2.3.0", find: /<!-- zdd:begin -->/g, now: "one import line, `@zdd/instructions.md`, in CLAUDE.md (AGENTS.md keeps the block for Codex)", skip: ["AGENTS.md"] },
];
const RETIRED_SCAN_EXT = /\.(md|ya?ml|json|mjs|cjs|js|ts|sh|ps1|toml|txt)$/i;
const RETIRED_SKIP_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|CHANGELOG\.md)$/i;
const MAX_RETIRED_FILES = 3000;
const MAX_RETIRED_NOTES = 20;
// border: names a stack (build folders the retired-name sweep never reads)
const RETIRED_SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".venv", "venv", "__pycache__", ".expo"]);
// border: end
// The files swept: git's tracked list where git can answer (deterministic,
// honours the repo's ignores, never starved by build output — CR-417), else
// a bounded walk that says when it was cut short.
function sweepList(ledger, metadataRel) {
  const out = [];
  let truncated = false;
  if (hasGit(ledger.root)) {
    try {
      // Relative to the adopter's root, which may sit below the git root
      // (a package in a monorepo): git lists that folder only, by names the
      // ledger resolves from it (CR-519).
      const listed = execFileSync("git", ["ls-files", "-z"], { cwd: ledger.root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
      for (const rel of listed) {
        if (!RETIRED_SCAN_EXT.test(rel) || RETIRED_SKIP_FILES.test(rel) || rel === metadataRel || rel.startsWith(`${metadataRel}/`)) continue;
        if (rel.split("/").some((seg) => RETIRED_SKIP_DIRS.has(seg))) continue;
        out.push(rel);
        if (out.length > MAX_RETIRED_FILES) {
          truncated = true;
          break;
        }
      }
      return { files: out, truncated, source: "git" };
    } catch {
      /* fall through to the walk */
    }
  }
  let seen = 0;
  const rec = (dir, depth) => {
    if (depth > 6 || truncated) {
      if (depth > 6) truncated = true;
      return;
    }
    let names;
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (++seen > MAX_RETIRED_FILES) {
        truncated = true;
        return;
      }
      const p = join(dir, name);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      const rel = posixify(relative(ledger.root, p));
      if (st.isDirectory()) {
        const dotOk = [".claude", ".github", ".githooks"].includes(name);
        if (!(RETIRED_SKIP_DIRS.has(name) || (name.startsWith(".") && !dotOk) || rel === metadataRel)) rec(p, depth + 1);
        continue;
      }
      if (st.isFile() && RETIRED_SCAN_EXT.test(name) && !RETIRED_SKIP_FILES.test(rel)) out.push(rel);
    }
  };
  rec(ledger.root, 0);
  return { files: out, truncated, source: "walk" };
}
export function findRetiredNames(ledger, { oldEngine = null, oldLock = null, metadataRel = "zdd/metadata" } = {}) {
  const rules = [...RETIRED_NAMES];
  if (oldLock && /^v\d+\.\d+\.\d+$/.test(oldLock) && oldLock !== `v${oldEngine}`) {
    rules.push({ since: "this upgrade", find: new RegExp(`\\b${oldLock.replace(/\./g, "\\.")}\\b`, "g"), now: `the new release's tag (v${pluginVersion()}) — the lock moved; your repo may hold the old tag somewhere ZDD does not write (a lock test, a setup guide)`, skip: [".claude/settings.json", "zdd/config.json", ".github/workflows/zdd.yml", ".githooks/pre-push"] });
  }
  if (oldEngine && /^\d+\.\d+\.\d+$/.test(oldEngine)) {
    rules.push({ since: "this upgrade", find: new RegExp(`\\bv?${oldEngine.replace(/\./g, "\\.")}\\b`, "g"), now: `the new release (${pluginVersion()}) — your repo may hold the version somewhere ZDD does not write (a lock test, a setup guide)`, skip: [".claude/settings.json", "zdd/config.json", ".github/workflows/zdd.yml", ".githooks/pre-push"] });
  }
  const written = new Set(ledger.wrote);
  const hits = [];
  const list = sweepList(ledger, metadataRel);
  for (const rel of list.files) {
    if (hits.length > MAX_RETIRED_NOTES) break;
    if (written.has(rel) || rel.endsWith(`/${INSTRUCTIONS_NAME}`) || rel === INSTRUCTIONS_NAME) continue;
    let st;
    try {
      st = lstatSync(ledger.abs(rel));
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > MAX_SCAN_BYTES) continue;
    let text;
    try {
      text = ledger.read(rel);
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (const r of rules) {
      if (r.skip?.includes(rel)) continue;
      lines.forEach((line, i) => {
        r.find.lastIndex = 0;
        const m = r.find.exec(line);
        if (m) hits.push(`${rel}:${i + 1} still says \`${m[0]}\` — since ${r.since} that is ${r.now}`);
      });
    }
  }
  const out = hits.length > MAX_RETIRED_NOTES ? [...hits.slice(0, MAX_RETIRED_NOTES), `…and ${hits.length - MAX_RETIRED_NOTES} more retired names — grep for them`] : hits;
  if (list.truncated) out.push(`the sweep for retired names was cut short (more than ${MAX_RETIRED_FILES} files${list.source === "walk" ? ", or deeper than 6 folders" : ""}) — grep for the retired names yourself`);
  return out;
}
function parseDrop(drop) {
  if (drop === null || drop === undefined || drop === false) return [];
  const ids = String(drop).split(",").map((s) => s.trim().toLowerCase());
  if (!ids.every((s) => /^[0-9a-f]{8}$/.test(s))) throw new Error("--drop takes the ids upgrade --plan printed (8 hex characters each, comma-separated)");
  return [...new Set(ids)];
}

// ---------------------------------------------------------------------------
// A newer release than the running plugin (2.2.0). `release-status` finds
// the newest release tag on the marketplace's repository; `upgrade --to`
// moves only our lock to it. Claude Code loads a new plugin version only at
// start, so the rest of the upgrade is that release's own run, after the
// restart and the update the session-start line names.
// ---------------------------------------------------------------------------
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function newestTag(lsRemote) {
  let best = null;
  for (const line of String(lsRemote).split(/\r?\n/)) {
    const m = /\trefs\/tags\/(\S+)$/.exec(line);
    if (!m || !RELEASE_TAG.test(m[1])) continue;
    if (!best || compareVersions(m[1], best) > 0) best = m[1];
  }
  return best;
}
// Four facts (2.3.0, C3, C4): the newest release tag, the repo's lock, the
// release this session runs, and the catalogue this machine holds
// (known_marketplaces.json, the thing a restart moves). `ready` says the
// running release and the catalogue are both already at the newest, so a
// lock move can go straight on to the plan in the same session, no restart.
export function releaseStatus(root, remote = `https://github.com/${MARKETPLACE_REPO}.git`, home) {
  const running = pluginVersion();
  let lock = null;
  try {
    const s = JSON.parse(readFileSync(join(root, SETTINGS_FILE), "utf8"));
    const d = s?.extraKnownMarketplaces?.[MARKETPLACE];
    if (isOurDeclaration(d) && typeof d.source.ref === "string") lock = d.source.ref;
  } catch {
    /* no settings: no lock */
  }
  let catalogue = null;
  try {
    const ref = JSON.parse(readFileSync(join(pluginsDir(home), "known_marketplaces.json"), "utf8"))?.[MARKETPLACE]?.source?.ref;
    if (typeof ref === "string") catalogue = ref;
  } catch {
    /* no catalogue: Codex, or a machine that never fetched one */
  }
  const out = remoteTags(remote);
  const newest = newestTag(out);
  const newer = newest !== null && compareVersions(newest, running) > 0;
  const lockBehind = lock !== null && RELEASE_TAG.test(lock) && compareVersions(lock, running) < 0;
  const ready = newest !== null && !newer && newest === `v${running}` && catalogue === newest;
  return { lock, running, newest, catalogue, newer, lockBehind, ready };
}
function remoteTags(remote = `https://github.com/${MARKETPLACE_REPO}.git`) {
  return execFileSync("git", ["ls-remote", "--tags", "--refs", remote], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
}
// Every --to is lock-only (CR-004): the target must be a release tag the
// marketplace's repository has (CR-003), never below this plugin or the
// repo's current lock; an absent lock is written only with --lock (CR-008);
// --plan writes nothing.
function moveLockOnly(root, version, to, { plan = false, lock = false, remote, home } = {}) {
  if (!RELEASE_TAG.test(String(to))) throw new Error("--to must be a release tag, vX.Y.Z");
  if (compareVersions(to, version) < 0) throw new Error(`--to ${to} is older than this plugin (${version}) — upgrade never moves a lock backwards`);
  const ledger = new Ledger(root, { dryRun: plan });
  let obj = {};
  let existing = "";
  if (ledger.exists(SETTINGS_FILE)) {
    existing = ledger.read(SETTINGS_FILE);
    try {
      obj = JSON.parse(existing);
    } catch {
      throw new Error(`${SETTINGS_FILE} is not valid JSON — fix it by hand`);
    }
    if (!isPlainObject(obj)) throw new Error(`${SETTINGS_FILE} is not a JSON object — fix it by hand`);
  }
  const ekm = obj.extraKnownMarketplaces;
  if (ekm !== undefined && !isPlainObject(ekm)) throw new Error(`${SETTINGS_FILE}: "extraKnownMarketplaces" is not an object — fix it by hand`);
  const d = ekm?.[MARKETPLACE];
  if (d === undefined && !lock) throw new Error(`no lock in ${SETTINGS_FILE} — add --lock to lock this repo at ${to} (on the user's word; decision 0021)`);
  if (d !== undefined && !isOurDeclaration(d)) throw new Error(`${SETTINGS_FILE} declares ${MARKETPLACE} from ${describeSource(d)}, not this plugin's repository — move it by hand`);
  const was = d === undefined ? null : typeof d.source.ref === "string" ? d.source.ref : null;
  if (was && RELEASE_TAG.test(was) && compareVersions(to, was) < 0) throw new Error(`--to ${to} is older than this repo's lock (${was}) — upgrade never moves a lock backwards`);
  let tags;
  try {
    tags = remoteTags(remote);
  } catch {
    throw new Error(`could not read the release tags from ${remote ?? MARKETPLACE_REPO} — check the network and try again; the lock is unchanged`);
  }
  if (!String(tags).split(/\r?\n/).some((l) => l.endsWith(`refs/tags/${to}`))) throw new Error(`${to} is not a release tag on ${remote ?? MARKETPLACE_REPO} — use the tag release-status printed`);

  const next = d === undefined ? lockEntry(to.slice(1)) : { ...d, source: { ...d.source, ref: to }, autoUpdate: false };
  if (JSON.stringify(next) === JSON.stringify(d)) {
    ledger.kept.push(SETTINGS_FILE);
  } else {
    obj.extraKnownMarketplaces = { ...(ekm ?? {}), [MARKETPLACE]: next };
    let text = JSON.stringify(obj, null, 2) + "\n";
    if (/\r\n/.test(existing)) text = text.replace(/\n/g, "\r\n");
    ledger.overwrite(SETTINGS_FILE, text);
    ledger.notes.push(`${SETTINGS_FILE}: ${was ? `lock moved ${was.slice(0, 40)} → ${to}` : `locked this repo to ZDD ${to}`} (auto-update off) — nothing else changes in this run`);
  }
  // Where this machine already is (2.3.0, C3, CR-314): running the target
  // with the catalogue there too, the rest of the upgrade is this session's.
  let catalogue = null;
  try {
    const ref = JSON.parse(readFileSync(join(pluginsDir(home), "known_marketplaces.json"), "utf8"))?.[MARKETPLACE]?.source?.ref;
    if (typeof ref === "string") catalogue = ref;
  } catch {
    /* no catalogue */
  }
  const ready = to === `v${version}` && catalogue === to;
  ledger.notes.push(
    ready
      ? `next: this session already runs ${to} and the catalogue on this machine is at ${to} — no restart: say "upgrade ZDD" again now (or carry straight on to its plan), and that run shows the rest of the changes before writing them`
      : `next: restart Claude Code; the first line of the new session names the commands that move this machine to ${to} — run them and restart again; then say "upgrade ZDD" again: that run is ${to}'s own, and shows the rest of the changes before writing them`,
  );
  return { version, plan, to, ready, ...ledgerOut(ledger), duplicates: [] };
}

// ---------------------------------------------------------------------------
// The standard suite and the adapter contract (decision 0040).
// ---------------------------------------------------------------------------
// How many checks the engine's suite has: a mirror the upgrade uses without
// running the engine, held equal to the engine's SUITE_CHECK_COUNT by a test.
export const SUITE_CHECK_COUNT = 5;

// The adapters config selects that the repo wrote itself: a name with a
// module in localExtractorDir (`<name>.mjs` or `<name>/index.mjs`). The
// engine refuses a local name that shadows a catalogue one, so a module
// there is the repo's own.
export function ownAdapters(root, config) {
  const dir = typeof config.localExtractorDir === "string" ? config.localExtractorDir : null;
  if (!dir || !Array.isArray(config.extractors)) return [];
  let abs;
  try {
    abs = resolveInside(root, dir, `localExtractorDir ${dir}`);
  } catch {
    return [];
  }
  return config.extractors.filter((n) => typeof n === "string" && /^[a-z][a-z0-9-]*$/.test(n) && (existsSync(join(abs, `${n}.mjs`)) || existsSync(join(abs, n, "index.mjs"))));
}

// The interview's material: the engine's suite report, turned into what to
// ask and what to fix, per adapter. `raise` writes suiteChecks up to the
// engine's count, and only when every check of every adapter passes.
export function adapters(root, { raise = false } = {}) {
  const cfg = readConfig(root);
  if (cfg.state !== "valid") throw new Error(cfg.state === "invalid" ? `${cfg.error} — fix it first` : "no zdd/config.json here — bootstrap first");
  let r;
  try {
    r = JSON.parse(runEngine(["suite", "--json", `--root=${root}`]));
  } catch (e) {
    // The suite exits 1 with its report on stdout when a check blocks.
    try {
      r = JSON.parse(String(e.stdout ?? ""));
    } catch {
      throw new Error(`the standard suite could not run — the engine said: ${String(e.stderr || e.message).trim().split(/\r?\n/).slice(-3).join(" ")}`);
    }
  }
  const rows = new Map(r.table.map((row) => [row.step, row]));
  const out = r.adapters.map((a) => {
    const ask = [];
    if (a.declared === null && !a.loadError && rows.get("CONTRACT")?.ask) ask.push({ step: "CONTRACT", required: true, ask: rows.get("CONTRACT").ask });
    for (const step of a.behind ?? []) {
      const row = rows.get(step);
      if (row?.ask) ask.push({ step, required: row.required, since: row.since, ask: row.ask });
    }
    const fix = (a.checks ?? []).filter((c) => !c.ok).map((c) => ({ n: c.n, title: r.checks[c.n - 1].title, fix: r.checks[c.n - 1].fix, detail: c.detail, blocking: c.blocking }));
    return { name: a.name, declared: a.declared ?? null, loadError: a.loadError ?? null, contractFail: a.contractFail ?? null, ask, fix };
  });
  const clean = out.every((a) => !a.loadError && !a.contractFail && a.declared !== null && !a.fix.length);
  const ledger = new Ledger(root);
  let raised = false;
  if (raise) {
    if (!clean) {
      const left = out.filter((a) => a.loadError || a.contractFail || a.declared === null || a.fix.length).map((a) => a.name);
      throw new Error(`suiteChecks stays at ${r.suiteChecks}: ${left.join(", ")} ${left.length === 1 ? "does" : "do"} not pass the standard suite yet (or declare no CONTRACT) — fix them through the extractor skill, then --raise again`);
    }
    if (cfg.config.suiteChecks !== r.count) {
      ledger.overwrite("zdd/config.json", JSON.stringify({ ...cfg.config, suiteChecks: r.count }, null, 2) + "\n");
      ledger.notes.push(`zdd/config.json: suiteChecks ${cfg.config.suiteChecks ?? "(none)"} → ${r.count} — every check of the standard suite now blocks in CI`);
      raised = true;
    } else ledger.kept.push("zdd/config.json");
  }
  return { suiteChecks: r.suiteChecks, count: r.count, contract: r.contract, adapters: out, skipped: r.skipped, clean, raised, ...ledgerOut(ledger) };
}

export function narrateAdapters(r) {
  if (!r.adapters.length) return printable(`No adapter of this repo's own is configured: nothing to interview. (ZDD's own adapters are updated by the release and pass the standard suite in ZDD's CI.)${r.notes?.length ? `\n${r.notes.join("\n")}` : ""}`);
  const out = [`This engine speaks adapter contract ${r.contract}; the standard suite has ${r.count} checks, and ${r.suiteChecks ? `checks 1–${r.suiteChecks} block in CI` : "none blocks in CI yet"}.`];
  for (const a of r.adapters) {
    out.push("", `${a.name} — written for contract ${a.declared ?? "(not declared)"}`);
    if (a.loadError) out.push(`  It ${a.loadError}.`);
    if (a.contractFail) out.push(`  Derive stops on it: ${a.contractFail}`);
    for (const q of a.ask) out.push(`  Ask (${q.required ? "required" : "optional"}, ${q.step}): ${q.ask}`);
    for (const f of a.fix) out.push(`  Fails check ${f.n}${f.blocking ? " (blocks CI)" : " (warns only)"}: ${f.title}.`, `    ${String(f.detail).split("\n")[0]}`, `    Fix: ${f.fix}.`);
    if (!a.ask.length && !a.fix.length && !a.contractFail && !a.loadError) out.push("  Passes every check; nothing to ask.");
  }
  out.push("", r.clean ? (r.raised ? "Every adapter passes: suiteChecks raised." : r.suiteChecks === r.count ? "Every adapter passes, and every check already blocks." : "Every adapter passes: run `bootstrap.mjs adapters --raise` to make every check block in CI.") : "Ask the questions one at a time, update each adapter through the extractor skill (its tests red, then green), run this again, then `--raise`.");
  if (r.notes?.length) out.push(...r.notes);
  return out.map(printable).join("\n");
}

// Check it together (decision 0039 points 3 and 4). After the adapters are
// attached and derive has run, the engine's coverage report names, per record
// kind, what the records link to and which link to nothing; the developer
// says which gaps are fine and which are wrong, then opens the human index.
// Bootstrap records the check as owed (`mapCheck` in the config) and
// `check --done` clears it; on a greenfield repo it stays owed until the
// first derive finds records, and `check --status` says so at session start.
// ---------------------------------------------------------------------------
// Whether derive has written any record: the configured metadataDir, reached
// only inside the checkout and never through a link (CR-104), read entry by
// entry and stopped at the first record or a bounded count.
const RECORDS_PROBE_ENTRIES = 20_000;
function hasRecords(root, config) {
  const rel = artifactPaths(config, { lenient: true }).metadataDir;
  const dir = resolveInside(root, rel, `metadataDir ${rel}`); // throws on an escape or a link
  let seen = 0;
  const each = (abs, fn) => {
    let d;
    try {
      d = opendirSync(abs);
    } catch {
      return false;
    }
    try {
      for (let e; (e = d.readSync()) !== null; ) {
        if (++seen > RECORDS_PROBE_ENTRIES) return false;
        if (fn(e)) return true;
      }
      return false;
    } finally {
      d.closeSync();
    }
  };
  return each(dir, (k) => k.isDirectory() && each(join(dir, k.name), (f) => f.isFile() && f.name.endsWith(".json")));
}

export function mapCheck(root, { done = false, status = false } = {}) {
  const cfg = readConfig(root);
  // A repo that has not adopted ZDD owes no check: --status is silent (CR-099).
  if (status && cfg.state === "absent") return { owed: false, records: false, due: false };
  if (cfg.state !== "valid") throw new Error(cfg.state === "invalid" ? `${cfg.error} — fix it first` : "no zdd/config.json here — bootstrap first");
  const config = cfg.config;
  const owed = config.mapCheck === "owed";
  const records = hasRecords(root, config);
  if (status) return { owed, records, due: owed && records };
  if (done) {
    const ledger = new Ledger(root);
    if (owed) {
      const { mapCheck: _, ...rest } = config;
      ledger.overwrite("zdd/config.json", JSON.stringify(rest, null, 2) + "\n");
      ledger.notes.push("zdd/config.json: the first map check is done (mapCheck cleared)");
    } else ledger.kept.push("zdd/config.json");
    return { owed: false, records, ...ledgerOut(ledger) };
  }
  let coverage;
  try {
    coverage = JSON.parse(runEngine(["coverage", "--json", `--root=${root}`])).kinds;
  } catch (e) {
    throw new Error(`the coverage report could not run — the engine said: ${String(e.stderr || e.message).trim().split(/\r?\n/).slice(-3).join(" ")}`);
  }
  return { owed, records, coverage, humanIndex: artifactPaths(config, { lenient: true }).humanIndex };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : word.endsWith("s") ? "es" : "s"}`; // a kind ending in s: data-accesses
const namedList = (l) => (l.named.length ? `: ${l.named.map((n) => `\`${n}\``).join(", ")}${l.count > l.named.length ? `, and ${l.count - l.named.length} more` : ""}` : "");
export function narrateCheck(r) {
  if (r.coverage === undefined) {
    if (r.wrote || r.kept) return r.notes?.length ? r.notes.join("\n") : "The first map check was already done.";
    return r.due ? "The first map check is owed: derive now finds records. Run `bootstrap.mjs check` and go through it with the developer." : "";
  }
  if (!r.coverage.length) return "No records yet — derive found nothing to check. The check stays owed until code appears.";
  const out = ["What derive found, kind by kind — say which gaps are fine and which are wrong:"];
  for (const k of r.coverage) {
    const links = Object.entries(k.linksTo).map(([kind, n]) => `${n} link to a ${kind}`);
    out.push(`  - ${plural(k.count, k.kind)}${links.length ? `; ${links.join("; ")}` : ""}`);
    if (k.linkNothing.count) out.push(`      ${k.linkNothing.count} link to nothing${namedList(k.linkNothing)}`);
    if (k.reachedByNothing.count) out.push(`      ${k.reachedByNothing.count} nothing links to${namedList(k.reachedByNothing)}`);
  }
  out.push(`Then open ${r.humanIndex} and ask: does this all look right, and is any link missing?`);
  out.push("Every \"that's wrong\" becomes a fixture test in the adapter before it is fixed. When you are both done: `bootstrap.mjs check --done`.");
  return out.map(printable).join("\n");
}

// The greenfield preview (0039 point 4): the chosen adapters' own examples,
// derived and rendered in a temporary folder outside the repo.
export function preview(root, names) {
  if (!names.length) throw new Error("preview needs --extractors=<a,b,…>");
  for (const n of names) if (!/^[a-z][a-z0-9-]*$/.test(n)) throw new Error(`preview: '${n}' is not an adapter name`);
  try {
    return JSON.parse(runEngine(["preview", `--extractors=${names.join(",")}`, `--root=${root}`, "--json"]));
  } catch (e) {
    throw new Error(`the preview could not run — the engine said: ${String(e.stderr || e.message).trim().split(/\r?\n/).slice(-3).join(" ")}`);
  }
}
export function narratePreview(r) {
  const out = [];
  if (r.humanIndex) out.push(`A preview of ${r.used.join(", ")}, outside your repo: ${r.humanIndex}`);
  if (r.skipped.length) out.push(`No example ships for ${r.skipped.join(", ")} — the preview shows the rest.`);
  return out.map(printable).join("\n");
}

// ---------------------------------------------------------------------------
// Narration. Every line is one ledger entry; evidence and paths inside it come
// from the checkout (directory names, config values), which on POSIX may hold
// a newline or an ANSI escape. The skill reads this output, so a control
// character is replaced before it can forge a line or restyle the terminal
// (CR-092). `--json` output is JSON-quoted and needs no such step.
// ---------------------------------------------------------------------------
export const printable = (line) => line.replace(/[\x00-\x1f\x7f]/g, "?");

export function narrateDetect(d, pocock) {
  const out = [];
  if (d.mode === "greenfield") {
    out.push("Mode: GREENFIELD — no source to read. Ask for the intended stack and configure extractors ahead of the code.");
  } else {
    out.push(`Mode: EXISTING codebase (${d.sourceFiles} source files). Proposed extractors, with the evidence:`);
  }
  if (d.host) out.push(`Hosted on: ${d.host.kind === "none" ? "no remote yet (the GitHub default stands; ask where it will live)" : `${d.host.kind} (${d.host.remote})`}${d.host.kind !== "github" && d.host.kind !== "none" ? " — the CI workflow ZDD ships runs only on GitHub Actions; the merge gate is three commands for your own pipeline" : ""}`);
  if (d.mode !== "greenfield") {
    for (const p of d.proposals) {
      out.push(`  - ${p.name}`);
      for (const e of p.evidence) out.push(`      evidence: ${e}`);
      out.push(`      options:  ${JSON.stringify(p.options)}`);
    }
    for (const a of d.apps) out.push(`  - map only: ${a.name} — ${a.evidence}; extractor ${a.extractor}`);
    for (const q of d.questions ?? []) out.push(`  ask: ${q.ask} (recorded under ${q.records})`);
    // Part by part (decision 0039): what an adapter covers, and what nothing does.
    if (d.coverage) {
      out.push("Coverage, part by part:");
      for (const c of d.coverage) if (c.adapters.length) out.push(`  ${c.part}: ${c.adapters.join(", ")}`);
      const gaps = d.coverage.filter((c) => !c.adapters.length).map((c) => c.part);
      if (gaps.length) out.push(`  not covered: ${gaps.join(", ")} — no adapter recognises any here. Ask whether the app has them; one in a stack ZDD has no adapter for is built together with the \`extractor\` skill (it takes longer, and is tested with fixtures)`);
    }
    if (d.limits?.walkTruncated) out.push(`  (detection reads ${d.limits.depth} folders deep, within one walk budget: code deeper than that was not seen)`);
    if (d.limits?.readBudgetSpent) out.push("  (detection's read budget ran out: some source was not read — confirm the proposals by hand)");
    if (d.limits?.refused) out.push(`  (${d.limits.refused} file${d.limits.refused === 1 ? "" : "s"} could not be read — over 1 MiB, unreadable or a link: ${d.limits.refusedFirst.map((f) => `\`${f}\``).join(", ")}${d.limits.refused > d.limits.refusedFirst.length ? ", …" : ""} — evidence in ${d.limits.refused === 1 ? "it" : "them"} was not seen)`);
  } else if (d.catalogue) {
    // A greenfield repo with no stack chosen (0039 point 6): the stacks with
    // ready-made adapters, by part, and no recommendation.
    out.push("Ready-made adapters, by part (no recommendation — any stack works; an uncovered one gets an adapter built with the `extractor` skill):");
    for (const c of d.catalogue) if (c.adapters.length) out.push(`  ${c.part}: ${c.adapters.join(", ")}`);
  }
  out.push(narratePocock(pocock));
  return out.map(printable).join("\n");
}

function narratePocock(p) {
  const pin = pocockPin();
  const ours = `${pin.plugin}@${pin.marketplace}`;
  if (p.installed) {
    // ZDD's pinned copy first (the one bootstrap switches on); another copy
    // that happens to be on here is said as such, because bootstrap switches
    // it off and `grill` then needs the pinned one (Sadies dry run, 2.3).
    const h = p.hits.find((x) => x.id === ours && x.enabled !== false) ?? p.hits.find((x) => x.enabled !== false);
    const detail = h.id ? `${h.where}: ${h.path}; ${h.id} ${h.version ?? "?"}, switched on here` : `${h.where}: ${h.path}`;
    if (h.id && h.id !== ours && !p.pinned) {
      return `mattpocock-skills: a copy is on here (${detail}), but it is not ZDD's pinned one (${ours} ${pin.version}), and bootstrap switches other copies off in this repo so the pinned one loads — install it: \`claude plugin install ${ZDD_PLUGIN_ID} --scope project\` from this repo's folder, then restart; until then \`grill\` would run the other copy.`;
    }
    return `mattpocock-skills: installed (${detail}) — \`grill\` will run the real interview. ZDD pins ${pin.plugin} ${pin.version} (${ours}); this repo's .claude/settings.json keeps any other copy off here.`;
  }
  // A copy is cached but this repo switches it off (finding 9): grill will
  // not find it, and the fix is ZDD's own pinned copy, never switching the
  // other one back on.
  const off = p.hits.filter((x) => x.enabled === false);
  const install = `\`claude plugin install ${ZDD_PLUGIN_ID} --scope project\` from this repo's folder (Claude Code)`;
  if (p.unreadableSettings && p.hits.some((x) => x.where === "pluginCache" && x.enabled === null)) {
    return `mattpocock-skills: a copy is cached, but ${p.unreadableSettings} could not be read as JSON, so whether it is switched on here is unknown — fix that file, then run detect again.`;
  }
  if (off.length) {
    return (
      `mattpocock-skills: NOT installed as ZDD's pinned copy (${ours}); a copy is present but switched off here: ${off.map((x) => `${x.id} ${x.version ?? "?"}`).join(", ")}. ` +
      `This repo switches other copies off on purpose — ZDD brings the one release it is tested with: ${install} installs ${ours} ${pin.version} beside zdd; then restart. ` +
      "Until then `grill` cannot run, so work decisions out in plan mode and let \"update ZDD\" capture them."
    );
  }
  return (
    `mattpocock-skills: NOT installed. Installing zdd brings it: ${install} installs ${ours}, ` +
    `the ${pin.version} release this ZDD release is tested with, beside it — so a missing copy means zdd was loaded another way (a --plugin-dir, a copied folder); run that install. ` +
    "Your glossary and ADRs will only be as good as the design sessions that fill them, and `grill` (the design interview that writes them as it goes) needs Matt Pocock's skills. " +
    "Without it, work decisions out in plan mode and let \"update ZDD\" capture them."
  );
}

export function narrateApply(r) {
  const out = [`Bootstrap (${r.mode}) — plugin ${r.version}, ${r.date}`];
  // Each file with its plain-words card (pick 2): what it is, why it
  // exists, who writes it, whether it is ever hand-edited.
  const card = (f) => {
    const e = explain(f.replace(/ \(.*\)$/, ""));
    if (!e) return;
    out.push(`          what: ${e.what}`, `          why: ${e.why}`, `          who: ${e.who}`, `          hand-edited: ${e.handEdited}`);
  };
  for (const f of r.wrote) {
    out.push(`  wrote   ${f}`);
    card(f);
  }
  for (const f of r.kept) {
    out.push(`  kept    ${f}`);
    card(f);
  }
  for (const f of r.skipped) out.push(`  skipped ${f}`);
  for (const n of r.notes) out.push(`  note    ${n}`);
  out.push("");
  out.push("Next, run the engine (the skill does this): derive, render and lint, then the one mapping session, then render again.");
  out.push(`  npx -y ${ENGINE_PACKAGE}@${r.version} derive`);
  out.push(`  npx -y ${ENGINE_PACKAGE}@${r.version} render`);
  out.push(`  npx -y ${ENGINE_PACKAGE}@${r.version} lint`);
  out.push("");
  if (r.optIns.ci) {
    out.push("One step only you can do: in branch protection, require the `zdd` check to pass and require branches to be up to date before merging. Now stale generated artifacts cannot merge.");
  } else if (r.host && !["github", "none"].includes(r.host.kind)) {
    out.push(`This repo is hosted on ${r.host.kind}, where the workflow ZDD ships (GitHub Actions) cannot run. The merge gate for your own pipeline is three commands, run on every pull request:`);
    for (const c of r.ciCommands ?? ciCommands(r.version)) out.push(`  ${c}`);
    out.push("Fail the pipeline when any of them fails; the first two say when the generated artifacts are stale, the third refuses a merge while a pattern plan is left behind." + (r.optIns.prePush ? " Until then the pre-push hook makes a forgotten update loud on each developer's machine." : ""));
  } else {
    out.push(
      "CI declined: ZDD runs on the spoken verbs alone" +
        (r.optIns.prePush ? ", with the pre-push hook making a forgotten update loud" : "") +
        ". The guarantee is weaker without CI — drift is a habit you keep, not a check that blocks a merge.",
    );
  }
  out.push(narratePocock(r.pocock));
  return out.map(printable).join("\n");
}

// ---------------------------------------------------------------------------
// The plain-words card for every file ZDD puts in a repo (2.3.0, pick 2):
// what it is, why it exists, who writes it, whether it is ever hand-edited.
// The narration prints the card under each file, and a test binds every
// path bootstrap writes to a card here. Written for someone who has never
// heard of ZDD.
// ---------------------------------------------------------------------------
export const ARTIFACT_EXPLANATIONS = [
  { match: /(^|\/)config\.json$/, what: "ZDD's settings for this repo: which parts of the code it reads (the extractors), where the docs live, and which helpers are switched on", why: "so every developer and every CI run reads the code the same way", who: "ZDD writes it at install; \"upgrade ZDD\" moves its version line", handEdited: "rarely — a path or an option when you change your mind; ZDD says so when it rewrites it" },
  { match: /(^|\/)instructions\.md$/, what: "ZDD's instructions to the AI for every session: the spoken verbs (\"load ZDD\", \"choose patterns\", \"update ZDD\", \"upgrade ZDD\") and the rules that keep the docs honest", why: "the AI reads this before it touches anything, so it knows the vocabulary, the decisions and the shape of the system", who: "ZDD writes it and rewrites it on every upgrade", handEdited: "never — your own rules go in CLAUDE.md, which ZDD never edits after install" },
  { match: /(^|\/)glossary\.md$/, what: "the glossary: one short paragraph per word your project uses with a precise meaning", why: "the AI calls things what you call them, instead of grepping for a near-synonym and guessing", who: "you (and the AI, with your approval, as each piece of work touches a word)", handEdited: "yes — it is yours; it starts empty and grows with the work" },
  { match: /(^|\/)adr\/0001-adopt-zero-drift-docs\.md$/, what: "your first decision record: that this repo adopted ZDD, and why", why: "a worked example of the format, and the corpus's first entry — your decision, dated today", who: "ZDD seeds it once; it is yours from then on", handEdited: "yes — edit the reasons to match yours" },
  { match: /(^|\/)adr\/?(\d{4}-.*\.md)?$/, what: "the decision records (ADRs): one short file per decision that was hard to reverse, surprising without context, and a real trade-off", why: "so the AI does not reintroduce the approach you rejected in March", who: "you (and the AI, as decisions crystallise); never reconstructed from old code by default", handEdited: "yes — written when decided, never rewritten into a new truth (a new one supersedes it)" },
  { match: /(^|\/)map\/features\/example-feature\.md$/, what: "an example feature page in the semantic map, showing how a feature claims the code it owns by linking it", why: "so the folder is never an unexplained empty one; it shows the shape", who: "ZDD writes the example once", handEdited: "yes — rename it to a real feature or delete it" },
  { match: /(^|\/)map\/apps\/[^/]+\.md$/, what: "one page per app you named (web, mobile, API) in the semantic map", why: "a home for what the whole app is and what belongs to it; a house rule for the app is a blessing that names it (applies-to)", who: "ZDD writes the stub at install; you fill it", handEdited: "yes — yours" },
  { match: /(^|\/)map\/(features|apps|external-services)\/\.gitkeep$|(^|\/)map\/?$/, what: "the semantic map: short pages grouping the code into features, apps and the third-party systems it depends on, and the links the code cannot show", why: "grouping is a thing the code cannot say about itself", who: "you and the AI, one mapping session at install and then as each piece of work touches a feature", handEdited: "yes — yours; the links inside it are kept in step with the code by the drift check" },
  { match: /(^|\/)blessings\/(\.gitkeep|[^/]+\.md)?$/, what: "the blessings: one short file per kind of work done more than once (\"Adding an upload?\"), naming the existing code to copy or extend (where:), the trap to refuse, and why", why: "the most common pattern in a codebase is often the deprecated one; a blessing is how the AI copies the right code, and reuses a helper instead of writing a second one", who: "you and the AI: \"choose patterns\" proposes one, \"update ZDD\" mints it once the code exists", handEdited: "yes — yours; lint fails one whose where: names no file" },
  { match: /(^|\/)metadata\/?$/, what: "the inventory of the code (routes, tables, screens, background tasks, components, external services), one small JSON file each", why: "a mechanical, always-correct map of what exists, so the AI finds its way without grepping", who: "the engine (derive) — regenerated by \"update ZDD\"", handEdited: "never — the drift check fails if it is" },
  { match: /(^|\/)graph\.json$/, what: "the whole generated picture in one machine-readable file: every record and every link", why: "the human index is rendered from it, and other tools can read it", who: "the engine (render)", handEdited: "never" },
  { match: /(^|\/)agent-index\.md$/, what: "the short index the AI reads at the start of every session: each feature with pointers to its code", why: "orientation in one screen, so each session starts knowing where things are", who: "the engine (render)", handEdited: "never" },
  { match: /(^|\/)adr-index\.md$/, what: "one line per decision record, with what supersedes what", why: "the AI reads the whole list before work, then only the decisions its task cites", who: "the engine (render)", handEdited: "never" },
  { match: /(^|\/)blessing-index\.md$/, what: "one line per blessing: the question it answers (\"Adding an upload?\"), where the code is, and why", why: "read before any code is written, so the right existing code is copied or extended", who: "the engine (render)", handEdited: "never" },
  { match: /(^|\/)human-index\.html$/, what: "an interactive picture of the system for people: features, screens, endpoints, tables and how they connect", why: "for someone who must understand a system they did not build", who: "the engine (render)", handEdited: "never" },
  { match: /^CLAUDE\.md$/, what: "Claude Code's instruction file for this repo — yours", why: "ZDD adds exactly one line to it, which loads zdd/instructions.md into every session", who: "you; ZDD adds the one line at install and never edits the file again", handEdited: "yes — yours" },
  { match: /^AGENTS\.md$/, what: "Codex's instruction file for this repo — yours, with ZDD's instructions copied in between two marker lines (Codex cannot load a separate file)", why: "so Codex sessions get the same rules as Claude Code sessions", who: "you, outside the markers; ZDD rewrites what is between them on upgrade", handEdited: "yes outside the markers, never inside" },
  { match: /^\.github\/workflows\/zdd\.yml$/, what: "the CI check that refuses to merge a pull request whose generated docs are stale", why: "this is what turns ZDD from a habit into a guarantee", who: "ZDD writes it; \"upgrade ZDD\" moves the engine version inside it", handEdited: "rarely — its header says ZDD manages it; remove the header to take it over" },
  { match: /^\.githooks\/pre-push$/, what: "a local git hook that runs the same checks before a push and refuses the push if the docs are stale", why: "the fallback when there is no CI gate: it makes a forgotten update loud", who: "ZDD writes it; \"upgrade ZDD\" rewrites it", handEdited: "rarely — same ownership header as the workflow" },
  { match: /^\.gitattributes$/, what: "one line telling git to keep the files under zdd/ with Unix line endings", why: "the engine writes them that way; without this, Windows shows every generated file as changed", who: "ZDD adds the one line; the rest of the file is yours", handEdited: "yes outside ZDD's line" },
  { match: /^docs\/agents\/domain\.md$/, what: "a short note telling Matt Pocock's skills (the design interview ZDD builds on) where this repo keeps its glossary and decisions", why: "those skills look for files at the repo root by default and would create strays", who: "ZDD writes it once, only when absent", handEdited: "yes — yours from the first byte" },
  { match: /^\.claude\/settings\.json$/, what: "Claude Code's project settings: which plugins are on for this repo, and the lock that pins this repo to one ZDD release", why: "every developer runs the same ZDD release, and moving to a new one is a deliberate change", who: "ZDD merges its lines in, keeping yours; \"upgrade ZDD\" moves the lock", handEdited: "yes for your own settings; ZDD's lines are rewritten on upgrade" },
];
export function explain(rel) {
  const clean = String(rel).replace(/\\/g, "/").replace(/^\.\//, "");
  return ARTIFACT_EXPLANATIONS.find((e) => e.match.test(clean)) ?? null;
}

// ---------------------------------------------------------------------------
// Preflight (2.3.0, C7): every piece of tech ZDD needs, checked before a
// question is asked and again before an upgrade's engine run. Today the
// plugin carries no engine: every skill that does real work runs `npx -y
// @rich-rees/zdd-engine@<pin>`, so the engine is downloaded from the public
// npm registry on a machine's first run; the plugin and Matt Pocock's skills
// come from public GitHub repositories. No account is needed anywhere.
// ---------------------------------------------------------------------------
export const NODE_MIN = 20;
const REGISTRY_DEFAULT = "https://registry.npmjs.org";
const GITHUB_DEFAULT = `https://github.com/${MARKETPLACE_REPO}`;
const USES = {
  node: "ZDD's scripts and its engine run on it (20 or newer)",
  npx: "comes with Node.js; it downloads and runs the ZDD engine from the public npm registry on its first use, and on each new engine version",
  git: "ZDD reads the repo's history for freshness and locks a release by a git tag",
  repo: "ZDD reads the repo's history for freshness and locks a release by a git tag; run `git init` in the folder first",
  github: "ZDD and Matt Pocock's skills are installed from public GitHub repositories, and the release check reads the list of releases there",
  registry: "ZDD's engine, @rich-rees/zdd-engine, is downloaded from the public npm registry by npx; no npm account is needed, the package is public",
  engine: "the exact engine version this ZDD release pins must be there to download",
};
function head(url, timeoutMs = 5000) {
  return new Promise((ok) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return ok({ reachable: false, status: null, reason: "not a URL" });
    }
    const req = (u.protocol === "http:" ? httpRequest : httpsRequest)(u, { method: "GET", timeout: timeoutMs, headers: { "user-agent": "zdd-preflight" } }, (res) => {
      res.resume();
      ok({ reachable: true, status: res.statusCode ?? 0, reason: null });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timed out"));
    });
    req.on("error", (e) => ok({ reachable: false, status: null, reason: e.code ?? e.message }));
    req.end();
  });
}
export async function preflight(root, { registry = REGISTRY_DEFAULT, github = GITHUB_DEFAULT } = {}) {
  const version = pluginVersion();
  const checks = [];
  const add = (name, ok, found, says) => checks.push({ name, ok, found, uses: USES[name], says });
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0]);
  add("node", major >= NODE_MIN, `Node.js ${nodeVersion}`, major >= NODE_MIN ? `Node.js ${nodeVersion} — ${USES.node}` : `Node.js ${nodeVersion} is older than ${NODE_MIN} — ${USES.node}; install Node.js ${NODE_MIN} or newer from https://nodejs.org and open a new terminal`);
  let npx = null;
  try {
    npx = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000, shell: process.platform === "win32" }).trim();
  } catch {
    npx = null;
  }
  add("npx", npx !== null, npx ? `npx ${npx}` : null, npx ? `npx ${npx} — ${USES.npx}` : `npx — not found on this machine. ${USES.npx}. It is installed with Node.js from https://nodejs.org; a Claude Code installed on its own does not bring it`);
  let gitVersion = null;
  try {
    gitVersion = execFileSync("git", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
  } catch {
    gitVersion = null;
  }
  add("git", gitVersion !== null, gitVersion, gitVersion ? `git — ${USES.git}` : `git — not found on this machine. ${USES.git}; install it from https://git-scm.com`);
  let isRepo = false;
  if (gitVersion) {
    try {
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
      isRepo = true;
    } catch {
      isRepo = false;
    }
  }
  add("repo", isRepo, isRepo ? "a git repository" : null, isRepo ? `a git repository — ${USES.git}` : `a git repository — this folder is not one. ${USES.repo}`);
  const gh = await head(github);
  add("github", gh.reachable, gh.reachable ? `${github} answered ${gh.status}` : null, gh.reachable ? `github.com — ${USES.github}` : `github.com — could not be reached (${gh.reason}). ${USES.github}; check the network, a proxy or a firewall`);
  const reg = await head(`${registry.replace(/\/$/, "")}/`);
  add("registry", reg.reachable, reg.reachable ? `${registry} answered ${reg.status}` : null, reg.reachable ? `the npm registry — ${USES.registry}; ${USES.engine.replace("the exact engine version this ZDD release pins must be", `the engine, ${ENGINE_PACKAGE}@${version}, is`)}` : `the npm registry — could not be reached (${reg.reason}). ${USES.registry}; check the network, a proxy or a firewall`);
  if (reg.reachable) {
    const eng = await head(`${registry.replace(/\/$/, "")}/${ENGINE_PACKAGE.replace("/", "%2f")}/${version}`);
    const there = eng.reachable && eng.status >= 200 && eng.status < 300;
    add("engine", there, there ? `${ENGINE_PACKAGE}@${version} on the registry` : null, there ? `the engine, ${ENGINE_PACKAGE}@${version} — there to download` : `the engine, ${ENGINE_PACKAGE}@${version} — the npm registry answered but does not have this version (${eng.status ?? eng.reason}); a release of ZDD is published before its tag, so this is a ZDD defect — report it at https://github.com/${MARKETPLACE_REPO}/issues`);
  } else add("engine", false, null, `the engine, ${ENGINE_PACKAGE}@${version} — not checked: the registry could not be reached`);
  return { ok: checks.every((c) => c.ok), version, checks };
}
export function narratePreflight(p) {
  const out = ["Before anything is written, the things ZDD needs:"];
  for (const c of p.checks) out.push(`  ${c.ok ? "ok     " : "MISSING"} ${c.says}`);
  out.push("");
  out.push(p.ok ? "Everything ZDD needs is here. No account is needed anywhere." : "Nothing was written. Fix what is missing and run bootstrap again. No account is needed anywhere.");
  return out.map(printable).join("\n");
}

// ---------------------------------------------------------------------------
// Estimate (2.3.0, Rich's additions to pick 5): which of the three install
// scenarios this repo is, and an honest estimate of the review time the
// opt-in backfill would ask of the user. Heuristics, said as such.
// ---------------------------------------------------------------------------
export function estimate(root) {
  const d = detect(root);
  let commits = 0;
  let ageMonths = 0;
  let contributors = 0;
  if (hasGit(root)) {
    try {
      commits = Number(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim()) || 0;
      // The root commit's date: --max-count applies before --reverse, so the whole list is read and its last line taken.
      const dates = execFileSync("git", ["log", "--format=%cI"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000, maxBuffer: 64 * 1024 * 1024 }).trim().split(/\r?\n/).filter(Boolean);
      const first = dates.at(-1) ?? "";
      const last = execFileSync("git", ["log", "-1", "--format=%cI"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
      if (first && last) ageMonths = Math.max(0, Math.round((new Date(last) - new Date(first)) / (30.44 * 24 * 3600 * 1000)));
      contributors = execFileSync("git", ["shortlog", "-sn", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim().split(/\r?\n/).filter(Boolean).length;
    } catch {
      /* a repo with no commits yet */
    }
  }
  const sourceFiles = d.sourceFiles;
  const scenario = d.mode === "greenfield" ? "greenfield" : sourceFiles < 300 && ageMonths < 24 ? "young" : "mature";
  let backfill = null;
  if (scenario !== "greenfield") {
    const terms = Math.max(5, Math.round(sourceFiles / 12));
    const blessings = Math.max(3, Math.round(sourceFiles / 40));
    const adrs = Math.min(15, Math.max(5, Math.round(commits / 40)));
    const minutes = { glossary: Math.round(terms * 0.5), blessings: Math.round(blessings * 2), adrs: adrs * 3 };
    const total = minutes.glossary + minutes.blessings + minutes.adrs;
    const say = (m) => (m < 50 ? `about ${Math.max(5, Math.round(m / 5) * 5)} minutes` : m < 80 ? "about an hour" : `about ${Math.round(m / 60)} hours`);
    backfill = {
      glossary: `${say(minutes.glossary)} — roughly ${terms} terms proposed from the names in the code, as one reviewable file you tick, edit or strike`,
      blessings: `${say(minutes.blessings)} — roughly ${blessings} kinds of work done more than once, each with the existing code to start from, as one reviewable file`,
      adrs: `${say(minutes.adrs)} — about ${adrs} decisions, only the ones that would surprise a newcomer; the code shows what was decided, never why, so you supply the why for each (with clues from commit messages and comments) and each is marked as recorded after the fact`,
      total: say(total),
    };
  }
  return { scenario, sourceFiles, commits, ageMonths, contributors, proposals: d.proposals.map((p) => p.name), backfill };
}
export function narrateEstimate(e) {
  const out = [];
  if (e.scenario === "greenfield") out.push("Greenfield: no source to read yet. ZDD sets up an empty zdd/ folder; every task's \"update ZDD\" fills it, and nothing is asked up front beyond the intended stack.");
  else {
    const label = e.scenario === "young" ? "A young app" : "A mature codebase";
    const age = e.ageMonths === 0 ? "less than a month" : e.ageMonths === 1 ? "about a month" : e.ageMonths >= 24 ? `about ${Math.round(e.ageMonths / 12)} years` : `about ${e.ageMonths} months`;
    out.push(`${label}: ${e.sourceFiles} source files, ${e.commits} commit${e.commits === 1 ? "" : "s"} over ${age}${e.contributors > 1 ? `, ${e.contributors} people` : ""}.`);
    out.push("On day one the inventory (derive) is complete with no questions; one mapping session proposes the feature groupings and asks only where the evidence is thin; the unclaimed list is a to-do list, not a gate. Decisions are never reconstructed by default: glossary terms, decisions and blessings arrive as each task's \"update ZDD\" touches them, so the docs fill in where the team works.");
    out.push(`The backfill, if you want it, is ${e.backfill.total} of your review time:`);
    out.push(`  glossary — ${e.backfill.glossary}`);
    out.push(`  blessings — ${e.backfill.blessings}`);
    out.push(`  decisions — ${e.backfill.adrs}`);
    out.push("It is offered once, never default; skippable, resumable, and doable per artifact.");
  }
  return out.map(printable).join("\n");
}

export function narrateUpgrade(r) {
  const title = r.to ? `Lock move to ${r.to}` : `Upgrade to plugin ${r.version}`;
  const out = [r.plan ? `${r.to ? `Lock move plan to ${r.to}` : `Upgrade plan for plugin ${r.version}`} — nothing written yet` : title];
  const verb = r.plan ? "would change" : "changed";
  if (!r.wrote.length) out.push("  nothing to change — every plugin-owned file is already at this version");
  // The plain-words card under each file (pick 2), as the apply ledger has.
  for (const f of r.wrote) {
    out.push(`  ${verb} ${f}`);
    const e = explain(f.replace(/ \(.*\)$/, ""));
    if (e) out.push(`          what: ${e.what}`, `          why: ${e.why}`, `          who: ${e.who}`, `          hand-edited: ${e.handEdited}`);
  }
  for (const f of r.kept) out.push(`  kept    ${f}`);
  for (const n of r.notes) out.push(`  note    ${n}`);
  for (const d of r.duplicates ?? []) {
    const says = (d.rules ?? []).map((id) => INSTRUCTION_RULES.find((x) => x.id === id)?.says).filter(Boolean);
    out.push(`  your text, ${d.file} ${lineRange(d)} under "${d.heading}": ${brief(d.text)}`);
    for (const s of says) out.push(`      ZDD now says: ${s}`);
    out.push(`      → read the two together: same, different, or contradicting? Keep it, change it by hand, or remove this whole paragraph or bullet on the user's word (--drop=${d.id})`);
  }
  if (r.plan && r.blessingMoves?.proposals?.length) out.push(`  blessings to move — read the list, then run upgrade with --move-blessings=${r.blessingMoves.token}`);
  for (const b of r.blessingMoves?.proposals ?? []) {
    out.push(`  blessing ${b.from}: "${brief(b.question ?? "(no trigger question)")}"`);
    if (b.problem) {
      out.push(`      stays on the map — ${b.problem}`);
      continue;
    }
    out.push(`      → ${b.file}`, `        where: ${b.where}${b.symbol ? ` (${b.symbol})` : ""}`, `        kind: ${b.kind} (proposed — copy imitates the method, extend reuses the shared code; confirm or change it: --kinds=${b.id}:${b.kind === "copy" ? "extend" : "copy"})`);
    if (b.appliesTo) out.push(`        applies-to: ${b.appliesTo}`);
    out.push(`        first-built-in: ${b.firstBuiltIn}`);
    if (b.adrs.length) out.push(`        adr: ${b.adrs.map((n) => `ADR-${n}`).join(", ")}`);
  }
  return out.map(printable).join("\n");
}

export function narrateReleaseStatus(s) {
  if (!s.newest) return "No ZDD release tag found on the marketplace's repository.";
  const lock = s.lock ? `this repo locks ${s.lock}` : "this repo has no lock";
  const catalogue = `the catalogue on this machine is at ${s.catalogue ?? "no recorded ref"}`;
  if (s.newer) return `ZDD ${s.newest} is out; ${lock} and this session runs ${s.running}; ${catalogue}. Release notes: https://github.com/${MARKETPLACE_REPO}/releases/tag/${s.newest}`;
  let line = `ZDD ${s.running} is the newest release; ${lock}; this session runs ${s.running}; ${catalogue}.`;
  if (s.lockBehind || !s.lock) {
    line += s.ready
      ? ` this session already runs the newest release and the catalogue is there too: move the lock with \`upgrade --to=${s.newest}\` and go straight on to step 2 in this session — no restart`
      : ` moving the lock needs a restart afterwards: the catalogue follows the lock on restart, then the update commands the first line of the next session names, then a second restart`;
  }
  return line;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && posixify(process.argv[1]).endsWith("/scripts/bootstrap.mjs")) {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const root = adopterRoot(flags);
  // eslint-disable-next-line no-inner-declarations
  async function main() {
  try {
    if (cmd === "detect") {
      const d = detect(root);
      const pocock = findPocock(root, flags.home);
      process.stdout.write(flags.json ? JSON.stringify({ ...d, pocock }, null, 2) + "\n" : narrateDetect(d, pocock) + "\n");
    } else if (cmd === "apply") {
      if (!flags.answers) throw new Error("apply needs --answers=<file.json>");
      const answers = readJson(flags.answers);
      if (flags.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(flags.date))) throw new Error("--date must be YYYY-MM-DD");
      const r = apply(root, answers, { date: flags.date || today(), home: flags.home });
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narrateApply(r) + "\n");
    } else if (cmd === "upgrade") {
      const to = flags.to === undefined ? null : String(flags.to);
      const remote = typeof flags.remote === "string" ? flags.remote : undefined;
      const r = upgrade(root, { lock: flags.lock === true, plan: flags.plan === true, drop: flags.drop ?? null, to, moveBlessings: flags["move-blessings"] ?? false, kinds: flags.kinds ?? null, remote, home: flags.home });
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narrateUpgrade(r) + "\n");
    } else if (cmd === "split-adrs") {
      const r = splitAdrs(root, { plan: flags.plan === true, harness: flags.harness ?? null, application: flags.application ?? null, token: typeof flags.token === "string" ? flags.token : null, dir: typeof flags.dir === "string" ? flags.dir : null, index: typeof flags.index === "string" ? flags.index : null });
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narrateSplit(r) + "\n");
    } else if (cmd === "preflight") {
      const p = await preflight(root, { ...(typeof flags.registry === "string" ? { registry: flags.registry } : {}), ...(typeof flags.github === "string" ? { github: flags.github } : {}) });
      process.stdout.write(flags.json ? JSON.stringify(p, null, 2) + "\n" : narratePreflight(p) + "\n");
      if (!p.ok) process.exit(1);
    } else if (cmd === "check") {
      const r = mapCheck(root, { done: flags.done === true, status: flags.status === true });
      const text = narrateCheck(r);
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : text ? text + "\n" : "");
    } else if (cmd === "adapters") {
      const r = adapters(root, { raise: flags.raise === true });
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narrateAdapters(r) + "\n");
    } else if (cmd === "preview") {
      const r = preview(root, String(flags.extractors ?? "").split(",").map((s) => s.trim()).filter(Boolean));
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narratePreview(r) + "\n");
    } else if (cmd === "estimate") {
      const e = estimate(root);
      process.stdout.write(flags.json ? JSON.stringify(e, null, 2) + "\n" : narrateEstimate(e) + "\n");
    } else if (cmd === "release-status") {
      const s = releaseStatus(root, typeof flags.remote === "string" ? flags.remote : undefined, flags.home);
      process.stdout.write(flags.json ? JSON.stringify(s) + "\n" : printable(narrateReleaseStatus(s)) + "\n");
    } else {
      process.stderr.write("Usage: bootstrap.mjs <preflight [--registry=<url>] [--github=<url>]|detect|estimate|apply --answers=<file>|check [--status|--done]|adapters [--raise]|preview --extractors=<a,b>|upgrade [--plan] [--lock] [--drop=<ids>] [--move-blessings=<token> [--kinds=<name>:<copy|extend>,…]] [--to=vX.Y.Z]|split-adrs [--plan] [--token=<token> --harness=<nums> --application=<nums>] [--dir=<rel> --index=<rel>]|release-status [--remote=<url>]> [--root=<dir>] [--date=YYYY-MM-DD] [--home=<dir>] [--json]\n");
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`bootstrap: ${e.message}\n`);
    process.exit(1);
  }
  }
  main();
}
