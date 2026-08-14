#!/usr/bin/env node
// ZDD deriver — generates the codebase metadata: the mechanical inventory of
// routes, tables, surfaces, etc.
//
//   zdd-engine derive             # write metadata records + prune stale
//   zdd-engine derive --check     # exit 1 if metadata/ is stale
//   zdd-engine derive --verbose   # adapter diagnostics to stderr
//
// Deterministic: same source bytes in, byte-identical metadata/*.json out (the
// blocking CI check relies on this). No dependencies beyond Node stdlib, no
// LLM anywhere. Nothing in this file may be stack- or project-specific — stack
// facts belong in the adapter, project facts in zdd/config.json.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { loadConfig } from "./lib/config.mjs";

// Static registry — adapters are selected by name from config, never by path,
// so config can't import arbitrary code.
const ADAPTERS = {
  "nextjs-supabase": "./adapters/nextjs-supabase/index.mjs",
};

const RECORD_KEYS = ["kind", "id", "title", "description", "resource", "refs", "facts"];
const FILENAME_RE = /^[A-Za-z0-9._~()\[\]-]+\.json$/;

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
    if (!FILENAME_RE.test(r.filename)) fail(`Record ${r.id}: bad filename '${r.filename}'`);
    if (ids.has(r.id)) fail(`Duplicate record id '${r.id}'`);
    ids.add(r.id);
    const fileKey = `${r.kind}/${r.filename.toLowerCase()}`;
    // Case-insensitive: Windows/macOS checkouts collapse case-variant names.
    if (filenamesLower.has(fileKey)) fail(`Filename collision (case-insensitive): ${fileKey}`);
    filenamesLower.add(fileKey);
    for (const res of r.resource) {
      if (res.includes("\\") || res.startsWith("/") || /^[A-Za-z]:/.test(res)) {
        fail(`Record ${r.id}: resource '${res}' must be repo-relative POSIX`);
      }
    }
  }
  // Every ref must resolve to an emitted record — dangling refs are adapter
  // bugs, caught here rather than shipped.
  for (const r of records) {
    for (const ref of r.refs) {
      if (!ids.has(ref)) fail(`Record ${r.id}: dangling ref '${ref}'`);
    }
  }
}

export async function run(args) {
  const CHECK = args.includes("--check");
  const VERBOSE = args.includes("--verbose");
  const { repoRoot: REPO, config, paths } = loadConfig(args);

  const adapterPath = ADAPTERS[config.adapter];
  if (!adapterPath) fail(`Unknown adapter '${config.adapter}' (known: ${Object.keys(ADAPTERS).join(", ")})`);
  const adapter = await import(adapterPath);

  const metadataRel = paths.metadataDir;
  const metadataDir = resolve(REPO, metadataRel);
  // Refuse to prune outside the repo — a config typo must not delete
  // arbitrary trees.
  if (!metadataDir.startsWith(REPO + sep)) fail(`metadataDir '${metadataRel}' resolves outside the repo`);

  const { records, diagnostics } = adapter.derive({ repoRoot: REPO, options: config.adapterOptions });
  if (VERBOSE) for (const d of diagnostics) console.error(d);
  validateRecords(records);
  records.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : 1));

  const factsOrder = adapter.FACTS_KEY_ORDER ?? {};
  const expected = new Map(); // rel path under metadataDir -> content
  for (const r of records) {
    expected.set(`${r.kind}/${r.filename}`, stableStringify(r, factsOrder[r.kind] ?? []));
  }

  const existing = new Map();
  if (existsSync(metadataDir)) {
    const walk = (dir) => {
      for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".json")) {
          const rel = relative(metadataDir, p).split(/[\\/]/).join("/");
          existing.set(rel, readFileSync(p, "utf8"));
        }
      }
    };
    walk(metadataDir);
  }

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
      const p = join(metadataDir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    for (const rel of existing.keys()) {
      if (!expected.has(rel)) rmSync(join(metadataDir, rel));
    }
    const byKind = {};
    for (const r of records) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    const summary = Object.entries(byKind).map(([k, n]) => `${n} ${k}s`).join(", ");
    console.log(`Wrote ${records.length} records (${summary}) -> ${metadataRel}`);
  }
}
