#!/usr/bin/env node
// ZDD deriver — generates the codebase metadata: the mechanical inventory of
// routes, tables, surfaces, etc.
//
//   zdd-engine derive             # write metadata records + prune stale
//   zdd-engine derive --check     # exit 1 if metadata/ is stale
//   zdd-engine derive --verbose   # extractor diagnostics to stderr
//
// Deterministic: same source bytes in, byte-identical metadata/*.json out (the
// blocking CI check relies on this). No dependencies beyond Node stdlib, no
// LLM anywhere. Nothing in this file may be stack- or project-specific — stack
// facts belong in an extractor, project facts in zdd/config.json.
//
// Extractors are composed: config lists them by name, each one inventories one
// convention, and this file merges their records and resolves cross-extractor
// refs afterwards (src/lib/resolve-refs.mjs). Selection is by NAME only —
// from the static registry below, or from the one repo-local directory config
// may declare (`localExtractorDir`), the single sanctioned place config can
// point at code. A path in the extractors list is refused.

import { readFileSync, writeFileSync, readdirSync, statSync, lstatSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, resolveExtractors } from "./lib/config.mjs";
import { resolveRefs } from "./lib/resolve-refs.mjs";
import { insideRepo } from "./lib/paths.mjs";

const EXTRACTORS = {
  supabase: "./extractors/supabase/index.mjs",
  nextjs: "./extractors/nextjs/index.mjs",
  fastapi: "./extractors/fastapi/index.mjs",
  generic: "./extractors/generic/index.mjs",
};
const NAME_RE = /^[a-z][a-z0-9-]*$/;

const RECORD_KEYS = ["kind", "id", "title", "description", "resource", "refs", "facts"];
const FILENAME_RE = /^[A-Za-z0-9._~()\[\]-]+\.json$/;
// `kind` is a directory name under metadataDir — a record with kind `..`
// would write outside it (CR-003).
const KIND_RE = /^[a-z][a-z0-9_-]*$/;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// Canonical serializer: fixed top-level key order, per-kind facts key order
// (unknown facts keys sort last, alphabetically), 2-space indent, LF, trailing
// newline. Hand-rolled so byte-stability is a property of this file, not of
// JSON.stringify implementation details.
function stableStringify(record, factsKeyOrder) {
  const orderKeys = (obj, order) => {
    const known = order.filter((k) => k in obj);
    const unknown = Object.keys(obj).filter((k) => !order.includes(k)).sort();
    return [...known, ...unknown];
  };
  const write = (value, indent) => {
    if (Array.isArray(value)) {
      if (!value.length) return "[]";
      const inner = value.map((v) => `${indent}  ${write(v, indent + "  ")}`).join(",\n");
      return `[\n${inner}\n${indent}]`;
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value);
      if (!keys.length) return "{}";
      const inner = keys.map((k) => `${indent}  ${JSON.stringify(k)}: ${write(value[k], indent + "  ")}`).join(",\n");
      return `{\n${inner}\n${indent}}`;
    }
    return JSON.stringify(value);
  };
  const ordered = {};
  for (const key of RECORD_KEYS) {
    if (key === "facts") {
      const facts = {};
      for (const k of orderKeys(record.facts, factsKeyOrder)) facts[k] = record.facts[k];
      ordered.facts = facts;
    } else {
      ordered[key] = record[key];
    }
  }
  return write(ordered, "") + "\n";
}

function validateRecords(records) {
  const ids = new Set();
  const filenamesLower = new Set();
  for (const r of records) {
    for (const key of RECORD_KEYS) {
      if (!(key in r)) fail(`Record ${r.id ?? "?"} missing required key '${key}'`);
    }
    if (typeof r.description !== "string") fail(`Record ${r.id}: description must be a string`);
    if (!Array.isArray(r.resource)) fail(`Record ${r.id}: resource must be an array`);
    if (!Array.isArray(r.refs)) fail(`Record ${r.id}: refs must be an array`);
    if (!KIND_RE.test(r.kind)) fail(`Record ${r.id}: bad kind '${r.kind}' (lowercase name, it becomes a directory)`);
    if (!FILENAME_RE.test(r.filename)) fail(`Record ${r.id}: bad filename '${r.filename}'`);
    if (ids.has(r.id)) fail(`Duplicate record id '${r.id}' (two extractors minted it?)`);
    ids.add(r.id);
    const fileKey = `${r.kind}/${r.filename.toLowerCase()}`;
    // Case-insensitive: Windows/macOS checkouts collapse case-variant names.
    if (filenamesLower.has(fileKey)) fail(`Filename collision (case-insensitive): ${fileKey}`);
    filenamesLower.add(fileKey);
    for (const res of r.resource) {
      if (res.includes("\\") || res.startsWith("/") || /^[A-Za-z]:/.test(res) || res.split("/").includes("..")) {
        fail(`Record ${r.id}: resource '${res}' must be repo-relative POSIX (no '..')`);
      }
    }
  }
  // Every ref must resolve to an emitted record — dangling refs are extractor
  // bugs, caught here rather than shipped.
  for (const r of records) {
    for (const ref of r.refs) {
      if (!ids.has(ref)) fail(`Record ${r.id}: dangling ref '${ref}'`);
    }
  }
}

// Which names are loadable: the registry plus whatever the local dir holds
// (`<dir>/<name>.mjs` or `<dir>/<name>/index.mjs`). Local names may not
// shadow built-ins — a fork that wants a different `nextjs` is a fork.
function localExtractors(repoRoot, dir) {
  const found = new Map();
  if (!dir) return found;
  // loadConfig already refused absolute / `..` values; this is the belt
  // behind those braces (CR-004).
  const abs = insideRepo(repoRoot, resolve(repoRoot, dir), "localExtractorDir");
  if (!existsSync(abs)) return found;
  for (const name of readdirSync(abs).sort()) {
    const p = join(abs, name);
    if (statSync(p).isDirectory() && existsSync(join(p, "index.mjs"))) found.set(name, join(p, "index.mjs"));
    else if (name.endsWith(".mjs")) found.set(name.slice(0, -4), p);
  }
  return found;
}

async function loadExtractor(name, repoRoot, config) {
  const localDir = config.localExtractorDir;
  if (!NAME_RE.test(name)) {
    fail(
      `Extractor '${name}' is not a name: extractors are selected by name, never by path (config cannot import code). ` +
        `Put the module in localExtractorDir${localDir ? ` (${localDir})` : ""} as <name>.mjs and list its name.`,
    );
  }
  const local = localExtractors(repoRoot, localDir);
  // hasOwn: a local extractor called `constructor` must not hit Object.prototype (CR-022).
  if (Object.hasOwn(EXTRACTORS, name)) {
    if (local.has(name)) fail(`Local extractor '${name}' shadows the built-in of the same name — rename it`);
    return import(EXTRACTORS[name]);
  }
  if (local.has(name)) return import(pathToFileURL(local.get(name)).href);
  const known = Object.keys(EXTRACTORS).sort().join(", ");
  const localList = localDir ? `; local ${localDir}: ${[...local.keys()].join(", ") || "(none)"}` : "";
  fail(`Unknown extractor '${name}' (known: ${known}${localList})`);
}

// What is on disk under metadataDir. The folder holds exactly
// `<kind>/<record>.json` and derive manages nothing else: any other JSON file
// — or any directory that is not a kind — is FOREIGN, and the caller refuses
// to run rather than prune it as an orphaned record (CR-059: a non-dedicated
// metadataDir once deleted config.json). Non-JSON bystanders (a README, a
// .gitkeep) are neither read nor pruned. Symlinks are skipped, never followed
// (CR-060) — reported so `--verbose` shows why a linked file is ignored.
function scanMetadata(metadataDir) {
  const existing = new Map(); // "<kind>/<file>.json" -> content
  const foreign = [];
  const links = [];
  if (!existsSync(metadataDir)) return { existing, foreign, links };
  for (const name of readdirSync(metadataDir).sort()) {
    const p = join(metadataDir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      links.push(name);
    } else if (st.isDirectory()) {
      if (!KIND_RE.test(name)) {
        foreign.push(`${name}/`);
        continue;
      }
      for (const file of readdirSync(p).sort()) {
        const rel = `${name}/${file}`;
        const fp = join(p, file);
        const fst = lstatSync(fp);
        if (fst.isSymbolicLink()) links.push(rel);
        else if (fst.isDirectory()) foreign.push(`${rel}/`);
        else if (file.endsWith(".json")) existing.set(rel, readFileSync(fp, "utf8"));
      }
    } else if (name.endsWith(".json")) {
      foreign.push(name);
    }
  }
  return { existing, foreign, links };
}

// Run every configured extractor, merge, resolve refs. Exported so tests can
// observe records without the filesystem write.
export async function deriveRecords({ repoRoot, config }) {
  const selection = resolveExtractors(config);
  if (selection.error) fail(selection.error);
  const diagnostics = [];
  const configDiagnostics = selection.diagnostics;
  let records = [];
  const factsOrder = {};
  for (const { name, options } of selection.extractors) {
    const extractor = await loadExtractor(name, repoRoot, config);
    if (typeof extractor.derive !== "function") fail(`Extractor '${name}' exports no derive()`);
    let out;
    try {
      out = extractor.derive({ repoRoot, options });
    } catch (e) {
      fail(`Extractor '${name}' failed: ${e.message}`);
    }
    if (!out || !Array.isArray(out.records) || !Array.isArray(out.diagnostics)) fail(`Extractor '${name}' must return { records: [], diagnostics: [] }`);
    records.push(...out.records);
    diagnostics.push(...out.diagnostics.map((d) => `[${name}] ${d}`));
    // Facts key orders merge per kind in config order: first extractor's keys
    // first, later extractors' unseen keys appended.
    for (const [kind, order] of Object.entries(extractor.FACTS_KEY_ORDER ?? {})) {
      factsOrder[kind] = [...new Set([...(factsOrder[kind] ?? []), ...order])];
    }
  }
  const resolved = resolveRefs(records);
  records = resolved.records;
  diagnostics.push(...resolved.diagnostics);
  validateRecords(records);
  records.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : 1));
  return { records, factsOrder, diagnostics, configDiagnostics };
}

export async function run(args) {
  const CHECK = args.includes("--check");
  const VERBOSE = args.includes("--verbose");
  const { repoRoot: REPO, config, paths } = loadConfig(args);

  const metadataRel = paths.metadataDir;
  const metadataDir = resolve(REPO, metadataRel);
  // Refuse to prune outside the repo — a config typo must not delete
  // arbitrary trees.
  if (!metadataDir.startsWith(REPO + sep)) fail(`metadataDir '${metadataRel}' resolves outside the repo`);

  const { records, factsOrder, diagnostics, configDiagnostics } = await deriveRecords({ repoRoot: REPO, config });
  // Config-level notes (deprecations) always print; extractor diagnostics are
  // opt-in noise.
  for (const d of configDiagnostics) console.error(d);
  if (VERBOSE) for (const d of diagnostics) console.error(d);

  const expected = new Map(); // rel path under metadataDir -> content
  for (const r of records) {
    expected.set(`${r.kind}/${r.filename}`, stableStringify(r, factsOrder[r.kind] ?? []));
  }

  const { existing, foreign, links } = scanMetadata(metadataDir);
  if (foreign.length) {
    fail(
      `${metadataRel} is not a dedicated metadata folder — it holds ${foreign.length} file(s) derive did not write:\n` +
        foreign.map((f) => `  ${f}`).join("\n") +
        `\nderive manages only <kind>/<record>.json under paths.metadataDir and prunes the rest; ` +
        `move these out or point paths.metadataDir at an empty folder.`,
    );
  }
  if (VERBOSE) for (const l of links) console.error(`[derive] ${metadataRel}/${l} is a symlink — skipped (never read, written or pruned)`);

  // Normalize CRLF so a core.autocrlf checkout doesn't fail the compare
  // (.gitattributes pins these files to LF, this is belt-and-braces).
  const norm = (s) => s.replace(/\r\n/g, "\n");

  if (CHECK) {
    const problems = [];
    for (const [rel, content] of expected) {
      const disk = existing.get(rel);
      if (disk === undefined) problems.push(`missing: ${rel}`);
      else if (norm(disk) !== content) problems.push(`stale: ${rel}`);
    }
    for (const rel of existing.keys()) {
      if (!expected.has(rel)) problems.push(`orphaned (source concept gone): ${rel}`);
    }
    if (problems.length) {
      fail(
        `${metadataRel} is out of sync with the source (${problems.length} file(s)):\n` +
          problems.map((p) => `  ${p}`).join("\n") +
          "\nRun `zdd-engine derive` and commit the result.",
      );
    }
    console.log(`codebase metadata in sync (${records.length} records)`);
  } else {
    for (const [rel, content] of expected) {
      const p = insideRepo(metadataDir, join(metadataDir, rel), `metadata path ${rel}`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    for (const rel of existing.keys()) {
      if (!expected.has(rel)) rmSync(insideRepo(metadataDir, join(metadataDir, rel), `metadata path ${rel}`));
    }
    const byKind = {};
    for (const r of records) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    const summary = Object.entries(byKind).map(([k, n]) => `${n} ${k}s`).join(", ") || "nothing to inventory";
    console.log(`Wrote ${records.length} records (${summary}) -> ${metadataRel}`);
  }
}
