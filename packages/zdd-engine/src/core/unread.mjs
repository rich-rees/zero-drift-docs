#!/usr/bin/env node
// ZDD unread (decision 0048 point 5) — what this repo's adapters saw and could
// not read, and how each item is answered. Derives in memory (writes nothing),
// so it says what the source says now, before any commit.
//
//   zdd-engine unread [--root=<dir>] [--config=<file>] [--json]
//
// `bootstrap.mjs unread` reads the JSON: it marks items fine and raises
// `unread.strict`. `lint` is the gate; this only reports.

import { loadConfig } from "./lib/config.mjs";
import { deriveRecords } from "./derive.mjs";
import { itemOf, unreadConfig, unreadReport, MARK_ROUTE } from "./lib/unread.mjs";

export function narrateUnread(r) {
  if (!r.open.length && !r.fine.length && !r.stale.length) return "No adapter reported anything it could not read.";
  const out = [];
  if (r.open.length) {
    out.push(`${r.open.length} with no answer yet — fix the adapter, or mark each one fine once (${MARK_ROUTE}):`);
    for (const i of r.open) out.push(`  ${i.id}  ${i.file}: ${i.what}`);
  }
  if (r.fine.length) {
    out.push(`${r.fine.length} marked fine:`);
    for (const i of r.fine) out.push(`  ${i.id}  ${i.file}: ${i.what} — ${i.why}`);
  }
  if (r.stale.length) {
    out.push(`${r.stale.length} mark${r.stale.length === 1 ? "" : "s"} no item answers any more — remove with \`bootstrap.mjs unread --forget=<id>\`:`);
    for (const id of r.stale) out.push(`  ${id}`);
  }
  out.push(r.strict ? "unread.strict is on: lint fails on an item with no answer." : "unread.strict is off: lint only warns.");
  return out.join("\n");
}

export async function run(args) {
  const { repoRoot, config } = loadConfig(args);
  const cfg = unreadConfig(config);
  if (cfg.error) {
    console.error(cfg.error);
    process.exit(1);
  }
  const { unread } = await deriveRecords({ repoRoot, config });
  const report = unreadReport(unread.map(itemOf), cfg);
  process.stdout.write(args.includes("--json") ? JSON.stringify(report, null, 2) + "\n" : narrateUnread(report) + "\n");
}
