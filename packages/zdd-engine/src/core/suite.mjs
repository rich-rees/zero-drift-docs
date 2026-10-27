#!/usr/bin/env node
// ZDD standard suite (decision 0040) — runs the suite's checks on the
// adapters this repo wrote itself (the ones config selects from
// `localExtractorDir`), each on its own `fixture/`, copied into temporary
// folders outside the repo. Catalogue adapters pass the same suite in ZDD's
// own CI, so they are never run here.
//
//   zdd-engine suite [--extractors=<a,b>] [--json] [--root=<dir>] [--config=<file>]
//
// `suiteChecks` in zdd/config.json is how many checks block: a check
// numbered at or below it fails the run, a newer one warns (0040 point 7),
// until "upgrade ZDD" has the adapter pass it and raises the number. Absent,
// every check warns. The contract each adapter declares is judged as derive
// judges it (lib/contract.mjs), and the JSON form carries the contract table
// so "upgrade ZDD" can interview the developer about the steps an adapter is
// behind on.

import { basename, dirname, join, resolve } from "node:path";
import { lstatSync } from "node:fs";
import { loadConfig, resolveExtractors } from "./lib/config.mjs";
import { catalogue } from "./lib/catalogue.mjs";
import { importLocal, localExtractors } from "./derive.mjs";
import { CONTRACT, CONTRACT_TABLE, judgeContract } from "./lib/contract.mjs";
import { SUITE_CHECKS, SUITE_CHECK_COUNT, runSuite } from "./lib/suite.mjs";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// How many checks block, from the config: a whole number from 0 to the
// suite's count; absent is 0 (every check warns — no CI turns red on the
// release that brings the suite in).
export function suiteLevel(config) {
  const v = config.suiteChecks;
  if (v === undefined) return { level: 0 };
  if (!Number.isInteger(v) || v < 0 || v > SUITE_CHECK_COUNT) return { error: `zdd/config.json: suiteChecks must be a whole number from 0 to ${SUITE_CHECK_COUNT} (the checks this engine's suite has), got ${JSON.stringify(v)} — "upgrade ZDD" writes it` };
  return { level: v };
}

// The SUITE export: { options?, companions? } — the options its fixture is
// read with, and the catalogue adapters that run beside it.
function suiteSpec(name, mod) {
  const spec = mod.SUITE;
  if (spec === undefined) return { missing: true };
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return { error: `SUITE must be an object { options, companions }` };
  const options = spec.options ?? {};
  if (!options || typeof options !== "object" || Array.isArray(options)) return { error: `SUITE.options must be an object` };
  const companions = spec.companions ?? {};
  if (!companions || typeof companions !== "object" || Array.isArray(companions)) return { error: `SUITE.companions must be an object { "<catalogue adapter>": { options } }` };
  const { names } = catalogue();
  for (const [c, o] of Object.entries(companions)) {
    if (!names.has(c)) return { error: `SUITE.companions names '${c}', which is not a catalogue adapter (a companion is one of ZDD's own)` };
    if (!o || typeof o !== "object" || Array.isArray(o)) return { error: `SUITE.companions['${c}'] must be an options object` };
  }
  return { options, companions };
}

export async function suiteReport({ repoRoot, config, only = null }) {
  const lvl = suiteLevel(config);
  if (lvl.error) return { error: lvl.error };
  const selection = resolveExtractors(config);
  if (selection.error) return { error: selection.error };
  const { names, aliases, retired } = catalogue();
  const localDir = config.localExtractorDir;
  const local = localExtractors(repoRoot, localDir);
  const configured = selection.extractors.map((e) => e.name);
  const wanted = only ?? configured;
  const skipped = [];
  const unknown = [];
  const adapters = [];
  for (const name of wanted) {
    if (names.has(name) || Object.hasOwn(aliases, name) || Object.hasOwn(retired, name)) {
      skipped.push(name);
      continue;
    }
    if (!local.has(name)) {
      unknown.push(name);
      continue;
    }
    const entry = local.get(name);
    // `<dir>/<name>/index.mjs` is a folder adapter (its fixture beside it);
    // `<dir>/<name>.mjs` a single module, which has nowhere to keep one.
    const folder = basename(entry) === "index.mjs" && basename(dirname(entry)) === name ? dirname(entry) : null;
    let mod;
    try {
      mod = await importLocal(entry);
    } catch (e) {
      adapters.push({ name, loadError: `could not be loaded: ${e.message}`, checks: [] });
      continue;
    }
    const judged = judgeContract(name, mod);
    const spec = suiteSpec(name, mod);
    const fixtureDir = folder && !spec.missing && !spec.error ? join(folder, "fixture") : null;
    let r;
    if (spec.error) {
      r = { records: 0, checks: SUITE_CHECKS.map((c) => ({ n: c.n, id: c.id, ok: false, detail: spec.error })) };
    } else {
      r = runSuite({
        name,
        fixtureDir,
        options: spec.options,
        companions: spec.companions,
        comment: mod.COMMENT,
        trapDir: folder ? join(folder, "fixture-trap") : null,
        local: { path: folder ?? entry },
        entry,
        within: resolve(repoRoot, localDir),
      });
      if (spec.missing && folder) for (const c of r.checks) if (!c.ok && /^no fixture/.test(c.detail ?? "")) c.detail = "no SUITE export: add `export const SUITE = { options }`, the options its fixture/ is read with — the suite runs on the fixture, never on your repo";
    }
    adapters.push({
      name,
      declared: judged.declared,
      contractFail: judged.fail,
      contractWarning: judged.warning,
      behind: judged.behind.map((row) => row.step),
      records: r.records,
      checks: r.checks.map((c) => ({ ...c, blocking: !c.ok && c.n <= lvl.level })),
    });
  }
  const blocking = adapters.some((a) => a.loadError || a.contractFail || a.checks.some((c) => c.blocking));
  return { suiteChecks: lvl.level, count: SUITE_CHECK_COUNT, checks: SUITE_CHECKS, contract: CONTRACT, table: CONTRACT_TABLE, adapters, skipped, unknown, blocking };
}

export function narrateSuite(r) {
  const lines = [];
  const held = r.suiteChecks ? `held to checks 1–${r.suiteChecks} (suiteChecks: ${r.suiteChecks})` : "no check blocks yet (suiteChecks is not set: every check warns)";
  if (!r.adapters.length) {
    lines.push("No adapters of this repo's own are configured — nothing to check. (Catalogue adapters pass the standard suite in ZDD's own CI.)");
  } else {
    lines.push(`The standard suite (decision 0040) on this repo's own adapters, ${held}:`);
    for (const a of r.adapters) {
      lines.push("");
      if (a.loadError) {
        lines.push(`${a.name}: ${a.loadError}`);
        continue;
      }
      lines.push(`${a.name} (contract ${a.declared ?? "not declared"}; ${a.records} record file(s) from its fixture)`);
      if (a.contractFail) lines.push(`  FAIL contract: ${a.contractFail}`);
      if (a.contractWarning) lines.push(`  warn contract: ${a.contractWarning}`);
      for (const c of a.checks) {
        const title = r.checks[c.n - 1].title;
        if (c.ok) lines.push(`  pass ${c.n} ${title}${c.detail ? ` (${c.detail})` : ""}`);
        else {
          lines.push(`  ${c.blocking ? "FAIL" : "warn"} ${c.n} ${title}`);
          for (const d of String(c.detail).split("\n")) lines.push(`         ${d}`);
          lines.push(`         fix: ${r.checks[c.n - 1].fix}`);
          if (!c.blocking) lines.push(`         (check ${c.n} is newer than this repo's suiteChecks: it warns until "upgrade ZDD" raises the number)`);
        }
      }
    }
  }
  if (r.skipped.length) lines.push("", `Catalogue adapters, checked in ZDD's own CI: ${r.skipped.join(", ")}`);
  if (r.unknown.length) lines.push("", `Not found in localExtractorDir: ${r.unknown.join(", ")}`);
  lines.push("", r.blocking ? "The suite FAILS: fix what is marked FAIL (the extractor skill walks it red to green)." : "The suite passes.");
  return lines.join("\n");
}

export async function run(args) {
  const JSON_OUT = args.includes("--json");
  const pick = args.find((a) => a.startsWith("--extractors="));
  const only = pick ? pick.slice("--extractors=".length).split(",").filter(Boolean) : null;
  const { repoRoot, config } = loadConfig(args);
  const localDir = config.localExtractorDir;
  if (localDir) {
    try {
      if (!lstatSync(resolve(repoRoot, localDir)).isDirectory()) fail(`localExtractorDir '${localDir}' is not a folder`);
    } catch {
      /* no folder yet: nothing of the repo's own */
    }
  }
  const r = await suiteReport({ repoRoot, config, only });
  if (r.error) fail(r.error);
  if (JSON_OUT) console.log(JSON.stringify(r, null, 2));
  else console.log(narrateSuite(r));
  process.exit(r.blocking ? 1 : 0);
}
