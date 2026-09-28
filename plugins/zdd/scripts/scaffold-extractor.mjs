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

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT, parseArgs, adopterRoot, readJson, readConfig, artifactPaths, repoRelative, posixify } from "./lib/repo.mjs";
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
const SYNTAXES = ["c-like", "sql", "python"];
const SYNTAX_BY_EXT = {
  ".cs": "c-like", ".java": "c-like", ".kt": "c-like", ".scala": "c-like", ".go": "c-like", ".rs": "c-like",
  ".swift": "c-like", ".dart": "c-like", ".php": "c-like", ".js": "c-like", ".mjs": "c-like", ".cjs": "c-like",
  ".ts": "c-like", ".tsx": "c-like", ".jsx": "c-like", ".c": "c-like", ".h": "c-like", ".cpp": "c-like",
  ".sql": "sql",
  ".py": "python",
};
const MAX_TEXT = 200;

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
  if (!Array.isArray(raw.roots) || !raw.roots.length) fail("roots must be a non-empty array of repo-relative folders");
  a.roots = [...new Set(raw.roots.map((r, i) => repoRelative(r, `answers: roots[${i}]`)))];
  if (!Array.isArray(raw.extensions) || !raw.extensions.length || !raw.extensions.every((e) => typeof e === "string" && EXT_RE.test(e))) fail("extensions must be a non-empty array of suffixes like \".cs\"");
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

const semver = (v) => (/^(\d+)\.(\d+)\.(\d+)$/.exec(String(v)) ?? []).slice(1).map(Number);
const older = (v, than) => {
  const [a, b] = [semver(v), semver(than)];
  if (a.length !== 3) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};
const inside = (dir, p) => p === dir || p.startsWith(`${dir}/`) || dir === ".";

function fill(template, values) {
  return template.replace(/__([A-Z_]+)__/g, (whole, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`template token ${whole} has no value`);
    return values[key];
  });
}

export function scaffold(root, rawAnswers) {
  const a = validateAnswers(rawAnswers);
  const cfg = readConfig(root);
  if (cfg.state === "absent") throw new Error("no zdd/config.json — adopt ZDD first (the zdd:bootstrap runbook), then scaffold an extractor");
  if (cfg.state === "invalid") throw new Error(`${cfg.error} — fix it first; the scaffold never replaces a config it cannot read`);
  const config = cfg.config;
  const paths = artifactPaths(config); // throws on a bad configured path — before any write

  const configured = config.localExtractorDir === undefined ? undefined : repoRelative(config.localExtractorDir, "zdd/config.json localExtractorDir", { exact: true });
  if (configured && a.localExtractorDir && configured !== a.localExtractorDir) {
    throw new Error(`zdd/config.json already sets localExtractorDir to '${configured}' — answer that, or leave it out`);
  }
  const dir = configured ?? a.localExtractorDir ?? "zdd/extractors";
  if (dir === ".") throw new Error("localExtractorDir must not be the repo root");
  for (const key of ["metadataDir", "mapDir", "adrDir"]) {
    if (inside(paths[key], dir) || inside(dir, paths[key])) throw new Error(`localExtractorDir '${dir}' overlaps paths.${key} '${paths[key]}'`);
  }
  if (Array.isArray(config.extractors) === false && config.adapter !== undefined) {
    throw new Error("zdd/config.json still uses the pre-1.0 'adapter' — run zdd:bootstrap --upgrade first");
  }

  const ledger = new Ledger(root);
  const base = `${dir}/${a.name}`;
  if (ledger.exists(`${dir}/${a.name}.mjs`)) throw new Error(`${dir}/${a.name}.mjs already exists — the engine would see two modules named '${a.name}'`);

  const options = { roots: a.roots, extensions: a.extensions };
  const kindsOrder = `{ ${a.kinds.map((k) => `${JSON.stringify(k)}: []`).join(", ")} }`;
  const testPath = `${base}/${a.name}.test.mjs`;
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

  // --- files (never overwritten) -------------------------------------------
  ledger.create(`${base}/index.mjs`, fill(readFileSync(join(TEMPLATES, "index.mjs.tmpl"), "utf8"), values));
  ledger.create(testPath, fill(readFileSync(join(TEMPLATES, "extractor.test.mjs.tmpl"), "utf8"), values));
  for (const r of a.roots) ledger.create(r === "." ? `${base}/fixture/.gitkeep` : `${base}/fixture/${r}/.gitkeep`, "");

  // --- config wiring ---------------------------------------------------------
  const changes = [];
  if (configured === undefined) {
    config.localExtractorDir = dir;
    changes.push(`localExtractorDir set to ${dir}`);
  }
  if (!Array.isArray(config.extractors)) config.extractors = [];
  if (!config.extractors.includes(a.name)) {
    config.extractors.push(a.name);
    changes.push(`'${a.name}' added to extractors`);
  }
  if (!config.extractorOptions || typeof config.extractorOptions !== "object" || Array.isArray(config.extractorOptions)) config.extractorOptions = {};
  if (!Object.hasOwn(config.extractorOptions, a.name)) {
    config.extractorOptions[a.name] = options;
    changes.push(`extractorOptions.${a.name} set to ${JSON.stringify(options)}`);
  }
  if (changes.length) {
    ledger.overwrite("zdd/config.json", JSON.stringify(config, null, 2) + "\n");
    ledger.notes.push(`zdd/config.json: ${changes.join("; ")}`);
  } else ledger.kept.push("zdd/config.json");

  if (config.extractors.includes("generic") && config.extractors.length > 1) {
    ledger.notes.push("'generic' is still listed in extractors — it emits nothing; remove it now that a real extractor runs");
  }
  if (older(config.engine, IO_SINCE)) {
    ledger.notes.push(`zdd/config.json pins engine ${config.engine}; this extractor needs ${IO_SINCE} or later and will stop derive until then — run zdd:bootstrap --upgrade`);
  }
  if (!existsSync(join(root, ...a.roots[0].split("/")))) ledger.notes.push(`${a.roots[0]} does not exist in this repo yet — derive will report it as nothing to inventory`);

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
    const r = scaffold(adopterRoot(flags), readJson(flags.answers));
    process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narrate(r) + "\n");
  } catch (e) {
    process.stderr.write(`scaffold-extractor: ${e.message}\n`);
    process.exit(1);
  }
}
