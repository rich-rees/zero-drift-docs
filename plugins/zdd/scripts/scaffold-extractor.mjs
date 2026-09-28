#!/usr/bin/env node
// The extractor skill's deterministic half (CAS-65, decision 0010). The
// `extractor` skill is the conversation — it reads a sample of the adopter's
// source and asks the six design questions — and this script writes what the
// answers imply: the skeleton of a LOCAL extractor and the config wiring that
// selects it. The parsing logic is the agent's to write afterwards; this
// script never writes logic and never overwrites a file.
//
//   scaffold-extractor.mjs apply --answers=<file.json> [--root=<dir>] [--json]
//
// Writes, under localExtractorDir (default zdd/extractors):
//   <name>/index.mjs          the module: contract, io guard, walk, merge, mask
//   <name>/<name>.test.mjs    node --test file: expected ids, determinism +
//                             --check, missing source, oversized, symlink
//   <name>/fixture/<root>/    one empty folder per root (.gitkeep)
// and edits zdd/config.json: sets localExtractorDir if unset, appends the
// name to `extractors`, adds extractorOptions.<name> if absent. Writes go
// through bootstrap's Ledger — one writer discipline, one wrote/kept/skipped
// report (decision 0003).
//
// Answer set:
//   {
//     "name": "aspnet-routes",                     // ^[a-z][a-z0-9-]*$, not a built-in
//     "evidence": "[Route]/[HttpGet] attributes on controller classes",
//     "shapedLike": "fastapi",                     // supabase | nextjs | fastapi | react-router | generic
//     "kinds": ["route"],                          // record kinds it emits
//     "idExample": "route:/api/orders/{id}",       // optional, shown in comments
//     "refs": ["?table:"],                         // unresolved refs it may emit (optional)
//     "roots": ["src/Api"],                        // folders to walk
//     "extensions": [".cs"],                       // source suffixes
//     "syntax": "c-like",                          // c-like | sql | python; else inferred from extensions
//     "localExtractorDir": "zdd/extractors"        // optional; must agree with config if set there
//   }
//
// Trust: the answer set and the checkout are untrusted. Answers are
// validated whole before the first write; a config that cannot be read stops
// the run; every path goes through the Ledger's resolveInside (no escape, no
// symlink); text that lands in a generated comment is flattened to one line.

import { readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT, parseArgs, adopterRoot, readConfig, artifactPaths, repoRelative, resolveInside, pathsOverlap, CONFIG_REL, posixify } from "./lib/repo.mjs";
import { Ledger, printable } from "./bootstrap.mjs";

const TEMPLATES = join(PLUGIN_ROOT, "templates", "extractor");
// The engine version that first hands extractors `io` (decision 0010).
export const IO_SINCE = "1.3.0";
// Mirror of the engine's registry (packages/zdd-engine/src/derive.mjs
// EXTRACTORS) — a local name may not shadow one. A test holds the two together.
export const BUILT_INS = ["supabase", "nextjs", "fastapi", "react-router", "generic"];
const NAME_RE = /^[a-z][a-z0-9-]*$/; // the engine's NAME_RE
const KIND_RE = /^[a-z][a-z0-9_-]*$/; // the engine's KIND_RE
const EXT_RE = /^\.[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REF_PREFIXES = ["?from:", "?table:", "?bucket:", "?function:", "?route:"];
// `sql` is standard SQL (Postgres): `#` is an operator there. `mysql` adds
// `#` comments and backslash escapes (CAS-65 CR-014, decision in the skill).
const SYNTAXES = ["c-like", "sql", "mysql", "python"];
const SYNTAX_BY_EXT = {
  ".cs": "c-like", ".java": "c-like", ".kt": "c-like", ".scala": "c-like", ".go": "c-like", ".rs": "c-like",
  ".swift": "c-like", ".dart": "c-like", ".php": "c-like", ".js": "c-like", ".mjs": "c-like", ".cjs": "c-like",
  ".ts": "c-like", ".tsx": "c-like", ".jsx": "c-like", ".c": "c-like", ".h": "c-like", ".cpp": "c-like",
  ".sql": "sql",
  ".py": "python",
};
const MAX_TEXT = 200;
const MAX_LIST = 32; // roots, extensions, kinds — a scaffold answer, not a data set
const MAX_ANSWERS_BYTES = 64 * 1024;

// One line, printable, bounded: it lands in a `//` comment.
const flat = (s) => String(s).replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

export function validateAnswers(raw) {
  const fail = (msg) => {
    throw new Error(`answers: ${msg}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("must be a JSON object");
  const a = {};
  if (typeof raw.name !== "string" || !NAME_RE.test(raw.name)) fail("name must match ^[a-z][a-z0-9-]*$ (lowercase, digits, hyphens)");
  if (BUILT_INS.includes(raw.name)) fail(`name '${raw.name}' is a built-in extractor — a local one may not shadow it; pick another name`);
  a.name = raw.name;
  if (typeof raw.evidence !== "string" || !flat(raw.evidence)) fail("evidence must say what file layout or code shape declares the thing");
  a.evidence = flat(raw.evidence);
  if (!BUILT_INS.includes(raw.shapedLike)) fail(`shapedLike must be one of ${BUILT_INS.join(", ")}`);
  a.shapedLike = raw.shapedLike;
  if (!Array.isArray(raw.kinds) || !raw.kinds.length || !raw.kinds.every((k) => typeof k === "string" && KIND_RE.test(k))) fail("kinds must be a non-empty array of lowercase kind names (route, table, surface, …)");
  a.kinds = [...new Set(raw.kinds)];
  a.idExample = raw.idExample === undefined ? `${a.kinds[0]}:…` : flat(raw.idExample);
  if (raw.refs !== undefined && (!Array.isArray(raw.refs) || !raw.refs.every((r) => REF_PREFIXES.includes(r)))) fail(`refs must be an array of ${REF_PREFIXES.join(" ")}`);
  a.refs = [...new Set(raw.refs ?? [])];
  for (const key of ["kinds", "roots", "extensions", "refs"]) {
    if (Array.isArray(raw[key]) && raw[key].length > MAX_LIST) fail(`${key} lists more than ${MAX_LIST} entries`);
  }
  if (!Array.isArray(raw.roots) || !raw.roots.length) fail("roots must be a non-empty array of repo-relative folders");
  if (!raw.roots.every((r) => typeof r === "string" && r.length <= MAX_TEXT)) fail(`roots must be strings of at most ${MAX_TEXT} characters`);
  a.roots = [...new Set(raw.roots.map((r, i) => repoRelative(r, `answers: roots[${i}]`)))];
  if (!Array.isArray(raw.extensions) || !raw.extensions.length || !raw.extensions.every((e) => typeof e === "string" && e.length <= 32 && EXT_RE.test(e))) fail("extensions must be a non-empty array of suffixes like \".cs\"");
  a.extensions = [...new Set(raw.extensions)];
  if (raw.syntax !== undefined) {
    if (!SYNTAXES.includes(raw.syntax)) fail(`syntax must be one of ${SYNTAXES.join(", ")}`);
    a.syntax = raw.syntax;
  } else {
    const inferred = new Set(a.extensions.map((e) => SYNTAX_BY_EXT[e.toLowerCase()]));
    if (inferred.size !== 1 || inferred.has(undefined)) fail(`syntax cannot be inferred from ${a.extensions.join(", ")} — answer one of ${SYNTAXES.join(", ")}`);
    a.syntax = [...inferred][0];
  }
  if (raw.localExtractorDir !== undefined) a.localExtractorDir = repoRelative(raw.localExtractorDir, "answers: localExtractorDir");
  return a;
}

// A SemVer pin as [major, minor, patch, prerelease|null], or null when it is
// not one. A prerelease sorts before its release: 1.3.0-beta.1 is older than
// 1.3.0 (CAS-65 CR-010).
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const semver = (v) => {
  const m = SEMVER.exec(String(v));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? null] : null;
};
// true / false, or null when the pin cannot be read.
export function olderThan(v, than) {
  const [a, b] = [semver(v), semver(than)];
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return a[3] !== null && b[3] === null;
}

function fill(template, values) {
  return template.replace(/__([A-Z_]+)__/g, (whole, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`template token ${whole} has no value`);
    return values[key];
  });
}

const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lstatOrNull = (abs) => {
  try {
    return lstatSync(abs);
  } catch {
    return null;
  }
};

// The answers file: a regular file under a small cap, read before anything
// is validated (CAS-65 CR-006).
export function readAnswers(path) {
  const st = lstatOrNull(path);
  if (!st || !st.isFile()) throw new Error(`--answers '${path}' is not a regular file`);
  if (st.size > MAX_ANSWERS_BYTES) throw new Error(`--answers '${path}' is ${st.size} bytes — an answer set is under ${MAX_ANSWERS_BYTES}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`--answers '${path}' does not parse: ${e.message}`);
  }
}

// Two phases. PREFLIGHT reads and judges everything — answers, config shape,
// every path this run would write — and throws before a single byte lands.
// WRITE then creates the files and rewrites the config. A refusal therefore
// always leaves the repo exactly as it was (CAS-65 CR-003).
export function scaffold(root, rawAnswers) {
  // ---- preflight ------------------------------------------------------------
  const a = validateAnswers(rawAnswers);
  const cfg = readConfig(root);
  if (cfg.state === "absent") throw new Error("no zdd/config.json — adopt ZDD first (the zdd:bootstrap runbook), then scaffold an extractor");
  if (cfg.state === "invalid") throw new Error(`${cfg.error} — fix it first; the scaffold never replaces a config it cannot read`);
  const config = cfg.config;
  const paths = artifactPaths(config); // throws on a bad configured path

  // The fields this run edits must already have the engine's shape, or be
  // absent — never "normalised" into something else (CAS-65 CR-002).
  if (config.adapter !== undefined) throw new Error("zdd/config.json still uses the pre-1.0 'adapter' — run zdd:bootstrap --upgrade first");
  if (config.extractors !== undefined && (!Array.isArray(config.extractors) || !config.extractors.every((x) => typeof x === "string"))) {
    throw new Error("zdd/config.json 'extractors' is not a list of names — fix it first; the scaffold never replaces what it cannot read");
  }
  if (config.extractorOptions !== undefined && !plainObject(config.extractorOptions)) {
    throw new Error("zdd/config.json 'extractorOptions' is not an object — fix it first; the scaffold never replaces what it cannot read");
  }
  const options = { roots: a.roots, extensions: a.extensions };
  const existingOptions = config.extractorOptions?.[a.name];
  if (existingOptions !== undefined && (!plainObject(existingOptions) || !sameJson({ roots: existingOptions.roots, extensions: existingOptions.extensions }, options))) {
    // The fixture and tests are laid out for the answers; the real derive
    // would read the config. They must agree (CAS-65 CR-005).
    throw new Error(`zdd/config.json already has extractorOptions.${a.name} = ${JSON.stringify(existingOptions).slice(0, 200)} — answer those roots and extensions, or remove it first`);
  }

  const configured = config.localExtractorDir === undefined ? undefined : repoRelative(config.localExtractorDir, "zdd/config.json localExtractorDir", { exact: true });
  if (configured && a.localExtractorDir && configured !== a.localExtractorDir) {
    throw new Error(`zdd/config.json already sets localExtractorDir to '${configured}' — answer that, or leave it out`);
  }
  const dir = configured ?? a.localExtractorDir ?? "zdd/extractors";
  if (dir === ".") throw new Error("localExtractorDir must not be the repo root");
  // Every artifact the engine reads or writes, file or folder, and the config
  // itself — compared the way the filesystem compares (CAS-65 CR-004).
  for (const [key, value] of [...Object.entries(paths), ["config", CONFIG_REL]]) {
    if (key === "bundleDir") continue; // zdd/ holds the extractors folder by default
    if (pathsOverlap(dir, value)) throw new Error(`localExtractorDir '${dir}' overlaps ${key === "config" ? "zdd/config.json" : `paths.${key} '${value}'`}`);
  }
  const base = `${dir}/${a.name}`;
  // A source root at or below the extractor's own folder would inventory the
  // extractor, its test and its fixture (CAS-65 CR-007).
  for (const r of a.roots) {
    if (pathsOverlap(r, base) && r !== ".") throw new Error(`roots entry '${r}' overlaps the extractor's own folder '${base}' — the extractor would read itself`);
  }

  // The engine loads `<dir>/<name>.mjs` or `<dir>/<name>/index.mjs`. The
  // scaffold never selects code it did not write: any flat module, and any
  // existing folder module the config does not already select, is refused
  // (CAS-65 CR-001). A rerun — the config already selects the name — keeps
  // the module it finds, which is the adopter's by then.
  const rerun = Array.isArray(config.extractors) && config.extractors.includes(a.name);
  if (lstatOrNull(join(root, ...`${dir}/${a.name}.mjs`.split("/")))) {
    throw new Error(`${dir}/${a.name}.mjs already exists — the engine would see two modules named '${a.name}'; remove it or pick another name`);
  }
  const baseStat = lstatOrNull(join(root, ...base.split("/")));
  if (baseStat && (baseStat.isSymbolicLink() || !baseStat.isDirectory())) throw new Error(`${base} exists and is not a real folder — remove it or pick another name`);
  if (lstatOrNull(join(root, ...`${base}/index.mjs`.split("/"))) && !rerun) {
    throw new Error(`${base}/index.mjs already exists but zdd/config.json does not select '${a.name}' — the scaffold never switches on code it did not write; remove it or pick another name`);
  }

  // Every path this run may write, resolved now: no link on any segment, no
  // existing ancestor that is a file, no target that is not a regular file.
  const testPath = `${base}/${a.name}.test.mjs`;
  const fixtureKeeps = a.roots.map((r) => (r === "." ? `${base}/fixture/.gitkeep` : `${base}/fixture/${r}/.gitkeep`));
  for (const rel of [`${base}/index.mjs`, testPath, ...fixtureKeeps, CONFIG_REL]) {
    const abs = resolveInside(root, rel, rel); // throws on a symlink segment or an escape
    const segs = rel.split("/");
    for (let i = 1; i < segs.length; i++) {
      const st = lstatOrNull(join(root, ...segs.slice(0, i)));
      if (st && !st.isDirectory()) throw new Error(`${segs.slice(0, i).join("/")} is not a folder — ${rel} cannot be written`);
    }
    const st = lstatOrNull(abs);
    if (st && !st.isFile()) throw new Error(`${rel} exists and is not a regular file`);
  }

  const kindsOrder = `{ ${a.kinds.map((k) => `${JSON.stringify(k)}: []`).join(", ")} }`;
  const values = {
    NAME: a.name,
    NAME_KEY: a.name,
    EVIDENCE: a.evidence,
    SHAPED_LIKE: a.shapedLike,
    KINDS_LIST: a.kinds.join(", "),
    FIRST_KIND: a.kinds[0],
    ID_EXAMPLE: a.idExample,
    REFS_LIST: a.refs.length ? a.refs.map((r) => `${r}<…>`).join(", ") : "none",
    ROOTS: JSON.stringify(a.roots),
    EXTENSIONS: JSON.stringify(a.extensions),
    FACTS_KEY_ORDER: kindsOrder,
    IO_SINCE,
    MASK: readFileSync(join(TEMPLATES, `mask-${a.syntax}.tmpl`), "utf8").trimEnd(),
    TEST_PATH: testPath,
    FIXTURE_OPTIONS: JSON.stringify(options),
    EXPECTED_EXAMPLE: `[${JSON.stringify(a.idExample)}]`,
  };
  const moduleText = fill(readFileSync(join(TEMPLATES, "index.mjs.tmpl"), "utf8"), values);
  const testText = fill(readFileSync(join(TEMPLATES, "extractor.test.mjs.tmpl"), "utf8"), values);

  const next = structuredClone(config);
  const changes = [];
  if (configured === undefined) {
    next.localExtractorDir = dir;
    changes.push(`localExtractorDir set to ${dir}`);
  }
  if (next.extractors === undefined) next.extractors = [];
  if (!next.extractors.includes(a.name)) {
    next.extractors.push(a.name);
    changes.push(`'${a.name}' added to extractors`);
  }
  if (next.extractorOptions === undefined) next.extractorOptions = {};
  if (!Object.hasOwn(next.extractorOptions, a.name)) {
    next.extractorOptions[a.name] = options;
    changes.push(`extractorOptions.${a.name} set to ${JSON.stringify(options)}`);
  }

  // ---- write ------------------------------------------------------------------
  const ledger = new Ledger(root);
  ledger.create(`${base}/index.mjs`, moduleText);
  ledger.create(testPath, testText);
  for (const keep of fixtureKeeps) ledger.create(keep, "");
  if (changes.length) {
    ledger.overwrite(CONFIG_REL, JSON.stringify(next, null, 2) + "\n");
    ledger.notes.push(`zdd/config.json: ${changes.join("; ")}`);
  } else ledger.kept.push(CONFIG_REL);

  // ---- notes --------------------------------------------------------------------
  if (next.extractors.includes("generic") && next.extractors.length > 1) {
    ledger.notes.push("'generic' is still listed in extractors — it emits nothing; remove it now that a real extractor runs");
  }
  const older = olderThan(next.engine, IO_SINCE);
  if (older === true) ledger.notes.push(`zdd/config.json pins engine ${next.engine}; this extractor needs ${IO_SINCE} or later and will stop derive until then — run zdd:bootstrap --upgrade`);
  else if (older === null) ledger.notes.push(`zdd/config.json's engine pin (${printable(String(next.engine))}) is not a version this can compare — this extractor needs ${IO_SINCE} or later`);
  // Every root, judged without following links (CAS-65 CR-042).
  for (const r of a.roots) {
    const st = lstatOrNull(join(root, ...r.split("/")));
    if (!st) ledger.notes.push(`${r} does not exist in this repo yet — derive will report it as nothing to inventory`);
    else if (st.isSymbolicLink()) ledger.notes.push(`${r} is a symlink — io.walk never follows one, so nothing under it is read`);
    else if (!st.isDirectory()) ledger.notes.push(`${r} is not a folder — io.walk reads folders`);
  }

  return { name: a.name, dir, base, testPath, syntax: a.syntax, options, wrote: ledger.wrote, kept: ledger.kept, skipped: ledger.skipped, notes: ledger.notes };
}

export function narrate(r) {
  const out = [`Extractor '${r.name}' scaffolded under ${r.base} (${r.syntax} mask)`];
  for (const f of r.wrote) out.push(`  wrote   ${f}`);
  for (const f of r.kept) out.push(`  kept    ${f}`);
  for (const f of r.skipped) out.push(`  skipped ${f}`);
  for (const n of r.notes) out.push(`  note    ${n}`);
  out.push("");
  out.push("Next (the skill walks these):");
  out.push(`  1. Put a miniature of the convention under ${r.base}/fixture/ — the same layout as the roots.`);
  out.push(`  2. Fill EXPECTED_IDS in ${r.testPath} with the ids that fixture should produce (red first).`);
  out.push(`  3. Write fromSource() in ${r.base}/index.mjs until the test is green:`);
  out.push(`       node --test ${r.testPath}`);
  out.push("  4. On the real repo: derive, render, lint — and commit the metadata with the extractor.");
  out.push(`  To guard it in CI, add a step running: node --test ${r.testPath}`);
  return out.map(printable).join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && posixify(process.argv[1]).endsWith("/scripts/scaffold-extractor.mjs")) {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  try {
    if (positional[0] !== "apply" || !flags.answers) {
      process.stderr.write("Usage: scaffold-extractor.mjs apply --answers=<file.json> [--root=<dir>] [--json]\n");
      process.exit(2);
    }
    const r = scaffold(adopterRoot(flags), readAnswers(flags.answers));
    process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narrate(r) + "\n");
  } catch (e) {
    process.stderr.write(`scaffold-extractor: ${e.message}\n`);
    process.exit(1);
  }
}
