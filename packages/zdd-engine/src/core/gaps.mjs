#!/usr/bin/env node
// ZDD gaps (decision 0049) — the records that should link and do not, over
// the whole repo, and how each is answered. Derives in memory (writes
// nothing), so it says what the source says now, before any commit.
//
//   zdd-engine gaps [--root=<dir>] [--config=<file>] [--json]
//
// `bootstrap.mjs gaps` reads the JSON: it answers gaps (fine or known) and
// raises `gaps.strict`. `lint` is the gate; this only reports. The update
// skill reads it too: "update ZDD" does not finish while a gap is open.

import { loadConfig } from "./lib/config.mjs";
import { deriveRecords } from "./derive.mjs";
import { gapsOf, gapsConfig, gapReport, GAP_ROUTE } from "./lib/gaps.mjs";

export function narrateGaps(r) {
  const out = [];
  if (!r.open.length && !r.fine.length && !r.known.length && !r.stale.length) out.push(`No gaps: every ${r.kinds.reachNothing.join(", ")} reaches something, and something reaches every ${r.kinds.reachedByNothing.join(", ")}.`);
  const line = (i) => `  ${i.id}  ${i.what}${i.file ? ` (${i.file})` : ""}`;
  if (r.open.length) {
    out.push(`${r.open.length} gap${r.open.length === 1 ? "" : "s"} with no answer yet — ${GAP_ROUTE}:`);
    for (const i of r.open) out.push(line(i));
  }
  if (r.known.length) {
    out.push(`${r.known.length} known gap${r.known.length === 1 ? "" : "s"} — parts of the map not to trust:`);
    for (const i of r.known) out.push(`${line(i)} — ${i.why}`);
  }
  if (r.fine.length) {
    out.push(`${r.fine.length} marked fine:`);
    for (const i of r.fine) out.push(`${line(i)} — ${i.why}`);
  }
  if (r.stale.length) {
    out.push(`${r.stale.length} mark${r.stale.length === 1 ? "" : "s"} no gap answers any more — remove with \`bootstrap.mjs gaps --forget=<id>\`:`);
    for (const id of r.stale) out.push(`  ${id}`);
  }
  out.push(r.strict ? "gaps.strict is on: lint fails on a gap with no answer." : "gaps.strict is off: lint only warns.");
  return out.join("\n");
}

export async function run(args) {
  const { repoRoot, config } = loadConfig(args);
  const cfg = gapsConfig(config);
  if (cfg.error) {
    console.error(cfg.error);
    process.exit(1);
  }
  const { records, gapKinds: kinds } = await deriveRecords({ repoRoot, config });
  const report = { kinds, ...gapReport(gapsOf(records, kinds), cfg) };
  process.stdout.write(args.includes("--json") ? JSON.stringify(report, null, 2) + "\n" : narrateGaps(report) + "\n");
}
