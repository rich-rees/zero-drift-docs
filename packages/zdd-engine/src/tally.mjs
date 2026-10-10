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
//   zdd-engine tally --since <date>      an ISO date (2026-09-01, or with a
//                                        time), read as UTC: commits at or
//                                        after it, the same on every machine
//   zdd-engine tally --json              the same, as one JSON object
//
// Deterministic: same history and stores in, same bytes out; no dates of
// its own, no judgment — parsing and counting. Exit 0 whatever the checkout
// or the stores look like; what could not be read is said, in text and in
// JSON. A line the shape refused is a read, not a use: it is named and left
// out of the counts (decision 0027; CAS-105 review CR-001).

import { execFileSync } from "node:child_process";
import { readdirSync, existsSync, lstatSync } from "node:fs";
import { resolve, relative } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { extractBlessings, blessingShape } from "./lib/map-links.mjs";
import { walkMarkdown, readBounded, MAX_STORE_FILE_BYTES } from "./lib/walk-markdown.mjs";
import { SECTIONS, USE_VERBS, STORE_VERB, BLESSING_VERBS, LOG_FORMAT, recordsInLog, namesIn, glossaryTerms, itemMatcher, printable } from "./lib/zdd-record.mjs";

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });

// A `--since` that is not a commit must be an ISO date, with or without a
// time, with or without an offset (CR-005/006/007): git's looser date
// grammar accepts "garbage" as an approximate date and returns no commits,
// and a bare date means midnight in the machine's timezone. A bare date or
// a time with no offset is read as UTC, so the range is the same everywhere.
// The year is 1970–2099: git reads a later one as no date at all and
// returns the whole history without a word (observed on git 2.50).
const ISO_DATE = /^((?:19[7-9]\d|20\d\d)-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?(Z|[+-]\d{2}:?\d{2})?$/;
export function isoSince(value) {
  const m = ISO_DATE.exec(String(value).trim());
  if (!m) return null;
  return `${m[1]}T${m[2] ?? "00:00:00"}${m[3] ?? "Z"}`;
}

// The commits to read: { range, log } or { note }.
export function logFor(repoRoot, since) {
  try {
    git(repoRoot, ["rev-parse", "--show-toplevel"]);
  } catch {
    return { note: "No git checkout here — nothing to tally." };
  }
  const args = ["log", LOG_FORMAT];
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
      const iso = isoSince(since);
      if (!iso) return { note: `'${printable(since)}' is neither a commit here nor an ISO date (2026-09-01, 2026-09-01T09:00Z) — nothing tallied.` };
      args.push(`--since=${iso}`);
      range = `since ${iso}`;
    }
  }
  try {
    return { range, log: git(repoRoot, args) };
  } catch {
    return { note: "git log failed (an unborn branch?) — nothing tallied." };
  }
}

// Counts per section over the VALID lines, the never-named lists, and every
// shape problem by commit. `reused` is a bucket of the map section only.
export function tally(commits, stores) {
  const counts = Object.fromEntries(SECTIONS.map((s) => [s, Object.fromEntries([...USE_VERBS.filter((v) => v !== "reused" || s === "map"), STORE_VERB, ...(s === "blessings" ? BLESSING_VERBS : [])].map((v) => [v, 0]))]));
  const named = { adrs: new Set(), terms: new Set(), blessings: new Set() };
  const termMatchers = stores.terms.map((t) => [t, itemMatcher(t)]);
  const blessingMatchers = stores.blessings.map((q) => [q, itemMatcher(q)]);
  const adrSet = new Set(stores.adrs);
  const skipped = [];
  let records = 0;
  for (const c of commits) {
    if (!c.record) continue;
    records++;
    for (const p of c.record.problems) skipped.push({ hash: c.hash.slice(0, 7), subject: c.subject, problem: p });
    for (const s of SECTIONS) for (const e of c.record.sections[s]) if (e.valid && e.verb in counts[s]) counts[s][e.verb]++;
    const names = namesIn(c.record);
    for (const n of names.adrs) if (adrSet.has(n)) named.adrs.add(n);
    for (const [t, m] of termMatchers) if (!named.terms.has(t) && names.mentions(m)) named.terms.add(t);
    for (const [q, m] of blessingMatchers) if (!named.blessings.has(q) && names.mentions(m)) named.blessings.add(q);
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
    storeNotes: stores.notes ?? [],
  };
}

// The denominator: what the stores hold now (decision 0029 point 2). What
// could not be read is a note, never a silent gap and never a throw
// (CR-008): a store the tally did not see is said beside the totals.
export function readStores(repoRoot, paths) {
  const notes = [];
  const rel = (p) => relative(repoRoot, p).split(/[\\/]/).join("/");
  const adrDir = resolve(repoRoot, paths.adrDir);
  let adrs = [];
  try {
    if (existsSync(adrDir)) adrs = readdirSync(adrDir).filter((f) => /^\d{4}-.*\.md$/.test(f)).map((f) => f.slice(0, 4)).sort();
  } catch (e) {
    notes.push(`${rel(adrDir)}: could not be listed (${e.code ?? "error"}) — no ADR counted as never named`);
  }
  const glossary = resolve(repoRoot, paths.glossary);
  let terms = [];
  try {
    if (lstatSync(glossary).isSymbolicLink()) notes.push(`${rel(glossary)}: a symlink — not read; no term counted as never named`);
    else {
      const text = readBounded(glossary, MAX_STORE_FILE_BYTES);
      if (text === null) notes.push(`${rel(glossary)}: over ${MAX_STORE_FILE_BYTES / 1024} KiB or unreadable — no term counted as never named`);
      else terms = glossaryTerms(text);
    }
  } catch (e) {
    if (e.code !== "ENOENT") notes.push(`${rel(glossary)}: could not be read (${e.code ?? "error"}) — no term counted as never named`);
  }
  const blessings = [];
  const seenQ = new Set();
  const mapDir = resolve(repoRoot, paths.mapDir);
  const state = { depth: 0, entries: 0, skipped: [] };
  for (const path of existsSync(mapDir) ? walkMarkdown(mapDir, [], state) : []) {
    const text = readBounded(path, MAX_STORE_FILE_BYTES);
    if (text === null) {
      notes.push(`${rel(path)}: over ${MAX_STORE_FILE_BYTES / 1024} KiB or unreadable — its blessings are not in the never-named list`);
      continue;
    }
    const parsed = parseFrontmatter(text);
    for (const b of extractBlessings(parsed ? parsed.body : text)) {
      const q = blessingShape(b.text).question;
      if (q && !seenQ.has(q)) {
        seenQ.add(q);
        blessings.push(q);
      }
    }
  }
  for (const s of state.skipped) notes.push(`${rel(s.path)}: ${s.reason} — blessings there are not in the never-named list`);
  return { adrs, terms, blessings, notes };
}

export function run(args) {
  const { repoRoot: REPO, paths } = loadConfig(args);
  const json = args.includes("--json");
  const say = (note) => console.log(json ? JSON.stringify({ note }) : note);
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx > -1 ? args[sinceIdx + 1] : undefined;
  if (sinceIdx > -1 && (typeof since !== "string" || !since || since.startsWith("-"))) {
    say("`--since` needs a commit or an ISO date (e.g. `--since v2.3.0`, `--since 2026-09-01`) — nothing tallied.");
    return;
  }
  const log = logFor(REPO, since);
  if (log.note) {
    say(log.note);
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
    const row = cols.map((v) => (v in result.counts[s] ? String(result.counts[s][v]) : "-").padStart(10));
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
  if (result.storeNotes.length) {
    out.push("Stores the tally could not read in full (the totals above leave them out):");
    for (const n of result.storeNotes) out.push(`  ${printable(n)}`);
  }
  if (result.skipped.length) {
    out.push("");
    out.push("Shape problems (a refused line is left out of the counts; the rest of its record still counts — fix the shape in the next update commit):");
    for (const s of result.skipped) out.push(`  ${s.hash} ${printable(s.subject).slice(0, 50)}: ${printable(s.problem)}`);
  }
  console.log(out.join("\n"));
}
