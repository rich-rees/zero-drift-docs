#!/usr/bin/env node
// ZDD coverage (decision 0039 point 3) — the automated half of "check it
// together". Derives in memory (writes nothing) and reports, per record kind,
// how many records there are, what kinds they link to, and by name the ones
// that link to nothing and the ones nothing links to. Missing edges are what
// eyes miss on a map; this names them so the developer can say which gaps are
// fine and which are wrong.
//
//   zdd-engine coverage [--root=<dir>] [--config=<file>] [--json]
//
// Stack-free: it reads kinds, refs and typed edges, the shapes every adapter
// shares.

import { loadConfig } from "./lib/config.mjs";
import { deriveRecords } from "./derive.mjs";

export const NAMED_MAX = 20; // the unlinked items named per kind; the rest are counted

export function coverageOf(records) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const outOf = (r) => {
    const ids = new Set(r.refs ?? []);
    for (const list of Object.values(r.facts?.edges ?? {})) if (Array.isArray(list)) for (const id of list) ids.add(id);
    return [...ids].filter((id) => byId.has(id) && id !== r.id);
  };
  const reached = new Set();
  const outs = new Map();
  for (const r of records) {
    const out = outOf(r);
    outs.set(r.id, out);
    for (const id of out) reached.add(id);
  }
  const kinds = [...new Set(records.map((r) => r.kind))].sort();
  return kinds.map((kind) => {
    const of = records.filter((r) => r.kind === kind);
    const linksTo = {};
    for (const r of of) {
      for (const k of new Set(outs.get(r.id).map((id) => byId.get(id).kind))) linksTo[k] = (linksTo[k] ?? 0) + 1;
    }
    const linkNothing = of.filter((r) => !outs.get(r.id).length).map((r) => r.title || r.id);
    const reachedByNothing = of.filter((r) => !reached.has(r.id)).map((r) => r.title || r.id);
    return {
      kind,
      count: of.length,
      linksTo: Object.fromEntries(Object.entries(linksTo).sort(([a], [b]) => (a < b ? -1 : 1))),
      linkNothing: { count: linkNothing.length, named: linkNothing.slice(0, NAMED_MAX) },
      reachedByNothing: { count: reachedByNothing.length, named: reachedByNothing.slice(0, NAMED_MAX) },
    };
  });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : word.endsWith("s") ? "es" : "s"}`; // a kind ending in s: data-accesses
const names = (list) => (list.named.length ? `: ${list.named.map((n) => `\`${n}\``).join(", ")}${list.count > list.named.length ? `, and ${list.count - list.named.length} more` : ""}` : "");

export function narrateCoverage(rows) {
  if (!rows.length) return "No records yet — derive found nothing to check. The check runs once code appears.";
  const out = [];
  for (const r of rows) {
    const links = Object.entries(r.linksTo).map(([k, n]) => `${n} link to a ${k}`);
    out.push(`${plural(r.count, r.kind)}${links.length ? `; ${links.join("; ")}` : ""}; ${r.linkNothing.count} link to nothing${names(r.linkNothing)}; ${r.reachedByNothing.count} nothing links to${names(r.reachedByNothing)}`);
  }
  return out.join("\n");
}

export async function run(args) {
  const { repoRoot, config } = loadConfig(args);
  const { records } = await deriveRecords({ repoRoot, config });
  const rows = coverageOf(records);
  process.stdout.write(args.includes("--json") ? JSON.stringify({ kinds: rows }, null, 2) + "\n" : narrateCoverage(rows) + "\n");
}
