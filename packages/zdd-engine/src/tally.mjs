#!/usr/bin/env node
// The tally (decision 0029): the evidence over time of which ZDD artifacts
// earn their place. Reads every ZDD record (and legacy pattern record) out
// of the current branch's git history and reports, per section, how often
// an artifact turned a decision, confirmed one, supplied code to reuse, or
// was stored — then the ADRs, glossary terms and blessings in the stores AS
// THEY ARE NOW that no record in the range ever named.
//
//   zdd-engine tally                     whole history of the current branch
//   zdd-engine tally --since <ref>       commits after <ref> (<ref>..HEAD)
//   zdd-engine tally --since <date>      git's --since (e.g. 2026-09-01)
//   zdd-engine tally --json              the same, as one JSON object
//
// Deterministic: same history and stores in, same bytes out; no dates of
// its own, no judgment — parsing and counting. Exit 0 whatever the checkout
// looks like; what could not be read is said in one line. Every commit the
// parser skipped is named with why, so drift in the record's shape is never
// silent (decision 0029 point 1).

import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { extractBlessings, blessingShape } from "./lib/map-links.mjs";
import { walkMarkdown, readBounded, MAX_STORE_FILE_BYTES } from "./lib/walk-markdown.mjs";
import { SECTIONS, USE_VERBS, STORE_VERB, BLESSING_VERBS, recordsInLog, namesIn, glossaryTerms } from "./lib/zdd-record.mjs";

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });
const printable = (t) => String(t).replace(/[\x00-\x1f\x7f]/g, "?");

// The commits to read: { range, log } or { note }. A `--since` that resolves
// as a commit is a range; otherwise it is handed to git as a date.
export function logFor(repoRoot, since) {
  try {
    git(repoRoot, ["rev-parse", "--show-toplevel"]);
  } catch {
    return { note: "No git checkout here — nothing to tally." };
  }
  const args = ["log", "--format=%H%x1f%B%x1e"];
  let range = "the whole history of the current branch";
  if (since) {
    let isRef = false;
    try {
      git(repoRoot, ["rev-parse", "--verify", "--quiet", `${since}^{commit}`]);
      isRef = true;
    } catch {
      isRef = false;
    }
    if (isRef) {
      args.push(`${since}..HEAD`);
      range = `${since}..HEAD`;
    } else {
      args.push(`--since=${since}`);
      range = `since ${since}`;
    }
  }
  try {
    return { range, log: git(repoRoot, args) };
  } catch {
    return { note: since ? `git log could not read '${printable(since)}' as a commit or a date — nothing tallied.` : "git log failed (an unborn branch?) — nothing tallied." };
  }
}

// Counts per section, the never-named lists, and the skipped commits.
export function tally(commits, stores) {
  const counts = Object.fromEntries(SECTIONS.map((s) => [s, Object.fromEntries([...USE_VERBS, STORE_VERB, ...(s === "blessings" ? BLESSING_VERBS : [])].map((v) => [v, 0]))]));
  const named = { adrs: new Set(), terms: new Set(), blessings: new Set() };
  const skipped = [];
  let records = 0;
  for (const c of commits) {
    if (!c.record) continue;
    records++;
    for (const p of c.record.problems) skipped.push({ hash: c.hash.slice(0, 7), subject: c.subject, problem: p });
    for (const s of SECTIONS) for (const e of c.record.sections[s]) if (e.verb in counts[s]) counts[s][e.verb]++;
    const names = namesIn(c.record);
    for (const n of names.adrs) if (stores.adrs.includes(n)) named.adrs.add(n);
    for (const t of stores.terms) if (!named.terms.has(t) && names.mentions(t)) named.terms.add(t);
    for (const q of stores.blessings) if (!named.blessings.has(q) && names.mentions(q)) named.blessings.add(q);
  }
  return {
    records,
    counts,
    neverNamed: {
      adrs: stores.adrs.filter((n) => !named.adrs.has(n)),
      terms: stores.terms.filter((t) => !named.terms.has(t)),
      blessings: stores.blessings.filter((q) => !named.blessings.has(q)),
    },
    totals: { adrs: stores.adrs.length, terms: stores.terms.length, blessings: stores.blessings.length },
    skipped,
  };
}

// The denominator: what the stores hold now (decision 0029 point 2).
export function readStores(repoRoot, paths) {
  const adrDir = resolve(repoRoot, paths.adrDir);
  const adrs = (existsSync(adrDir) ? readdirSync(adrDir) : []).filter((f) => /^\d{4}-.*\.md$/.test(f)).map((f) => f.slice(0, 4)).sort();
  const glossary = resolve(repoRoot, paths.glossary);
  const terms = existsSync(glossary) ? glossaryTerms(readBounded(glossary, MAX_STORE_FILE_BYTES) ?? "") : [];
  const blessings = [];
  const mapDir = resolve(repoRoot, paths.mapDir);
  for (const path of existsSync(mapDir) ? walkMarkdown(mapDir) : []) {
    const text = readBounded(path, MAX_STORE_FILE_BYTES);
    if (text === null) continue;
    const parsed = parseFrontmatter(text);
    for (const b of extractBlessings(parsed ? parsed.body : text)) {
      const q = blessingShape(b.text).question;
      if (q && !blessings.includes(q)) blessings.push(q);
    }
  }
  return { adrs, terms, blessings };
}

export function run(args) {
  const { repoRoot: REPO, paths } = loadConfig(args);
  const json = args.includes("--json");
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx > -1 ? args[sinceIdx + 1] : undefined;
  if (sinceIdx > -1 && (typeof since !== "string" || !since || since.startsWith("-"))) {
    console.log("`--since` needs a ref or a date (e.g. `--since v2.3.0`, `--since 2026-09-01`) — nothing tallied.");
    return;
  }
  const log = logFor(REPO, since);
  if (log.note) {
    console.log(json ? JSON.stringify({ note: log.note }) : log.note);
    return;
  }
  const commits = recordsInLog(log.log);
  const result = tally(commits, readStores(REPO, paths));
  if (json) {
    console.log(JSON.stringify({ range: log.range, commits: commits.length, ...result }, null, 2));
    return;
  }
  const out = [];
  out.push(`ZDD tally — ${result.records} record${result.records === 1 ? "" : "s"} in ${commits.length} commit${commits.length === 1 ? "" : "s"} (${log.range})${result.skipped.length ? `, ${result.skipped.length} shape problem${result.skipped.length === 1 ? "" : "s"}` : ""}`);
  out.push("");
  const cols = [...USE_VERBS, STORE_VERB];
  out.push(["section".padEnd(10), ...cols.map((c) => c.padStart(10))].join(""));
  for (const s of SECTIONS) {
    const row = cols.map((v) => (v === "reused" && s !== "map" ? "-" : String(result.counts[s][v])).padStart(10));
    out.push([s.padEnd(10), ...row].join(""));
    if (s === "blessings") out.push("  " + BLESSING_VERBS.map((v) => `${v} ${result.counts[s][v]}`).join(", "));
  }
  out.push("");
  const never = result.neverNamed;
  const line = (label, items, total, quote) => `  ${label}: ${items.length ? items.map((x) => (quote ? `"${printable(x)}"` : x)).join(", ") : "none"} (${items.length} of ${total})`;
  out.push("Never named in any record — the stores as they are now:");
  out.push(line("ADRs", never.adrs, result.totals.adrs, false));
  out.push(line("glossary terms", never.terms, result.totals.terms, true));
  out.push(line("blessings", never.blessings, result.totals.blessings, true));
  if (result.skipped.length) {
    out.push("");
    out.push("Shape problems (the line still counts where it parsed; fix the shape in the next update commit):");
    for (const s of result.skipped) out.push(`  ${s.hash} ${printable(s.subject).slice(0, 50)}: ${s.problem}`);
  }
  console.log(out.join("\n"));
}
