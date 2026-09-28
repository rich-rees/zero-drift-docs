#!/usr/bin/env node
// Deterministic lints over the curated stores (blocking CI tier).
//
//   zdd-engine lint               # ADR-number, supersession-symmetry and
//                                 # blessing-citation lints
//   zdd-engine lint --tempstate   # + TEMPSTATE.md must not exist
//
// 1. Supersession symmetry: an ADR that claims to supersede another fails
//    unless the target carries the matching forward stamp ("Superseded [in
//    part] by ... ADR-NNNN"), so a reader can never land on a dead decision
//    unsignposted.
// 2. Blessing citations (DIO-313): a blessing in a semantic-map concept — the
//    one-liner naming the exemplar to copy, always citing the ADR that
//    blessed it — fails when the ADR it cites carries a full "Superseded by"
//    stamp, or does not exist. A stale blessing is worse than none: it sends
//    the agent to copy the pattern a later decision refused. The map's first
//    hard check. A citation of an ADR superseded IN PART, or a blessing with
//    no citation at all, is a WARNING line on stderr, never a failure.
// 3. TEMPSTATE lint (--tempstate, PRs only — tautological on the base
//    branch): the branch working file must be deleted before merge.
//    Enforced by construction, not ritual.
// 4. Unclaimed records (CAS-63): every route, table, function and surface
//    that no feature slice links is listed as a WARNING, never a failure — a
//    repo adopting ZDD starts with everything unclaimed, and the list is the
//    checklist `update` works from (decision 0009). The same count sits in
//    the human index header. A record two feature slices claim is a warning
//    too (CAS-65). With `claims.strict` (decision 0012) all three FAIL: an
//    unclaimed record not in `claims.allowUnclaimed`, an allow-list id that
//    names no claimable record, and a record claimed by more than one slice.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { loadConfig, absentStoreNotes } from "./lib/config.mjs";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { extractBlessings, forwardStamps } from "./lib/map-links.mjs";
import { walkMarkdown, readBounded, MAX_STORE_FILE_BYTES } from "./lib/walk-markdown.mjs";
import { unclaimedRecords } from "./lib/claims.mjs";

export function run(args) {
  const { repoRoot: REPO, config, paths, bundleDir } = loadConfig(args);
  // `claims` (CAS-65, decision 0012): opt-in strict mode. Checked before
  // any lint runs, so a malformed block is the one thing reported.
  // Only an ABSENT block defaults: `null` or a misspelt key is an error,
  // never strict silently off (CAS-65 CR-027/028); the allow-list is bounded
  // (CR-031).
  const claimsCfg = config.claims === undefined ? {} : config.claims;
  const CLAIMS_KEYS = ["strict", "allowUnclaimed"];
  const isObject = claimsCfg !== null && typeof claimsCfg === "object" && !Array.isArray(claimsCfg);
  const unknownKey = isObject ? Object.keys(claimsCfg).find((k) => !CLAIMS_KEYS.includes(k)) : undefined;
  const allow = isObject ? claimsCfg.allowUnclaimed : undefined;
  const claimsError =
    !isObject ? "'claims' must be an object"
    : unknownKey !== undefined ? `'claims' has an unknown key '${unknownKey.replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 40)}' (known: ${CLAIMS_KEYS.join(", ")})`
    : claimsCfg.strict !== undefined && typeof claimsCfg.strict !== "boolean" ? "'claims.strict' must be true or false"
    : allow !== undefined && (!Array.isArray(allow) || !allow.every((x) => typeof x === "string"))
      ? "'claims.allowUnclaimed' must be an array of record ids (\"route:/health\")"
    : allow !== undefined && allow.length > 10_000 ? "'claims.allowUnclaimed' lists more than 10000 ids"
    : allow !== undefined && allow.some((x) => x.length > 512) ? "'claims.allowUnclaimed' ids must be at most 512 characters"
      : null;
  if (claimsError) {
    console.error(`zdd/config.json: ${claimsError}`);
    process.exit(1);
  }
  const STRICT = claimsCfg.strict === true;
  const ALLOWED = new Set(claimsCfg.allowUnclaimed ?? []);
  const ADR_DIR = resolve(REPO, paths.adrDir);
  const MAP_DIR = resolve(REPO, paths.mapDir);
  const METADATA_DIR = resolve(REPO, paths.metadataDir);
  // A missing adrDir or mapDir is greenfield-tolerated (empty corpus passes);
  // say so when the rest of the bundle exists, so a typo is not a silent pass
  // (CR-068).
  for (const note of absentStoreNotes(REPO, paths, ["adrDir", "mapDir"])) console.error(note);

  const problems = [];

const adrFiles = (existsSync(ADR_DIR) ? readdirSync(ADR_DIR) : []).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();
const numOf = (f) => f.slice(0, 4);

// ---- 0. Duplicate ADR numbers ----
// Two concurrent branches each minting "the next ADR" merge WITHOUT a git
// conflict (different filenames), silently yielding two ADRs with one number —
// and number is what citations and the supersession lint key on. First PR to
// merge keeps the number; the later branch renumbers when it syncs master.
const seenNum = new Map();
for (const file of adrFiles) {
  const n = numOf(file);
  if (seenNum.has(n)) {
    problems.push(
      `${file}: duplicate ADR number ${n} (also ${seenNum.get(n)}) — a parallel ` +
        `branch merged first; renumber this file (and its citations) to the next free number`,
    );
  } else {
    seenNum.set(n, file);
  }
}

// ---- 1. Supersession symmetry ----
const byNum = new Map(adrFiles.map((f) => [numOf(f), f]));

for (const file of adrFiles) {
  const text = readFileSync(join(ADR_DIR, file), "utf8");
  // Active claims only ("supersedes ADR-NNNN"); the passive stamp
  // ("Superseded by ...") is the other side of the contract.
  for (const m of text.matchAll(/\bsupersedes\b[\s\S]{0,120}?ADR[-\s]?0*(\d+)/gi)) {
    const targetNum = m[1].padStart(4, "0");
    const targetFile = byNum.get(targetNum);
    if (!targetFile) {
      problems.push(`${file}: claims to supersede ADR-${targetNum}, which does not exist`);
      continue;
    }
    const targetText = readFileSync(join(ADR_DIR, targetFile), "utf8");
    const claimerNum = numOf(file);
    const stamp = new RegExp(`\\bsuperseded(\\s+in\\s+part)?\\s+by\\b[\\s\\S]{0,120}?ADR[-\\s]?0*${Number(claimerNum)}\\b`, "i");
    if (!stamp.test(targetText)) {
      problems.push(
        `${file}: supersedes ADR-${targetNum}, but ${targetFile} carries no ` +
          `"Superseded [in part] by ADR-${claimerNum}" stamp — add the forward stamp`,
      );
    }
  }
}

// ---- 2. Blessing citations ----
// Every blessing in every map concept, against the ADR corpus as it stands.
// Stamps are read from the cited ADR's own text (the forward half of the
// supersession contract, which lint 1 keeps honest). The map is walked the
// hardened way — symlinks skipped, reads bounded (CR-018/CR-019) — and a
// concept over the cap is a lint failure, not a silent pass. Excerpts of
// map text in diagnostics have control characters neutralised (CR-025).
const printable = (t) => t.replace(/[\x00-\x1f\x7f]/g, "?");
const stampsByNum = new Map();
const stampsOf = (num) => {
  if (!stampsByNum.has(num)) stampsByNum.set(num, forwardStamps(readFileSync(join(ADR_DIR, byNum.get(num)), "utf8")));
  return stampsByNum.get(num);
};
for (const path of walkMarkdown(MAP_DIR)) {
  const rel = relative(REPO, path).split(/[\\/]/).join("/");
  const text = readBounded(path, MAX_STORE_FILE_BYTES);
  if (text === null) {
    problems.push(`${rel}: over ${MAX_STORE_FILE_BYTES / 1024} KiB — a semantic-map concept is a short document; split it or move the bulk out of the map`);
    continue;
  }
  const parsed = parseFrontmatter(text);
  const body = parsed ? parsed.body : text;
  // Blessing line numbers are body-relative; report them file-relative.
  const normalised = text.replace(/\r\n?/g, "\n");
  const offset = parsed ? (normalised.slice(0, normalised.length - parsed.body.length).match(/\n/g) ?? []).length : 0;
  for (const b of extractBlessings(body)) {
    const excerpt = printable(b.text.length > 60 ? b.text.slice(0, 59) + "…" : b.text);
    const where = `${rel}:${b.line + offset} (blessing: "${excerpt}")`;
    if (!b.adrs.length) {
      console.error(`WARNING: ${where} cites no ADR — a blessing always names the decision that blessed it`);
      continue;
    }
    for (const num of b.adrs) {
      if (!byNum.has(num)) {
        problems.push(`${where}: cites ADR-${num}, which does not exist`);
        continue;
      }
      const full = stampsOf(num).filter((s) => !s.partial);
      const partial = stampsOf(num).filter((s) => s.partial);
      if (full.length) {
        problems.push(
          `${where}: cites ADR-${num}, which is superseded by ADR-${full.map((s) => s.by).join(", ADR-")} — ` +
            `re-bless under the current decision, or drop the blessing`,
        );
      } else if (partial.length) {
        console.error(`WARNING: ${where} cites ADR-${num}, superseded in part by ADR-${partial.map((s) => s.by).join(", ADR-")} — check the blessed pattern still stands`);
      }
    }
  }
}

// ---- 3. TEMPSTATE lint ----
if (args.includes("--tempstate")) {
  const tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter((f) => /(^|\/)tempstate\.md$/i.test(f));
  for (const f of tracked) {
    problems.push(
      `${f}: branch working file must be deleted before merge — read it back ` +
        `(everything lands in a store or dies with it), then git rm it.`,
    );
  }
}

// ---- 4. Claims: unclaimed and double-claimed records ----
// Read after the blocking lints so a failure above is not buried under the
// list. Absent metadata (greenfield, or derive not yet run) is an empty
// inventory: nothing to claim, no line printed.
const { total, records, unclaimed, doubleClaimed, skipped } = unclaimedRecords({ metadataDir: METADATA_DIR, mapDir: MAP_DIR, bundleDir });
// Every adopter-controlled path is printable before it reaches the log — a
// control character in a filename cannot forge a line (CAS-65 CR-032).
const files = (list) => list.map(printable).join(", ");
if (STRICT) {
  // A strict pass means every file was read (CAS-65 CR-029, decision 0012).
  for (const s of skipped) {
    problems.push(`claims.strict: ${printable(s.file)} could not be read (${s.reason}) — ${s.record ? "its record is unknown" : "its claims are unknown"}`);
  }
  const ids = new Set(records.map((r) => r.id));
  for (const r of unclaimed) {
    if (!ALLOWED.has(r.id)) problems.push(`${printable(r.id)} is unclaimed — claims.strict: link it from one feature slice, or add it to claims.allowUnclaimed (${printable(r.file)})`);
  }
  for (const id of [...ALLOWED].sort()) {
    if (!ids.has(id)) problems.push(`claims.allowUnclaimed lists '${printable(id)}', which is no claimable record — remove it`);
  }
  for (const r of doubleClaimed) {
    problems.push(`${printable(r.id)} is claimed by ${r.features.length} feature slices (${files(r.features)}) — claims.strict: exactly one owns a record`);
  }
} else {
  if (unclaimed.length) {
    console.error(
      `WARNING: ${unclaimed.length} of ${total} records unclaimed — no feature slice in ${paths.mapDir} links them ` +
        `(a feature claims a record by linking it; a unit of work that adds or changes user-facing behaviour adds or extends a slice):`,
    );
    for (const r of unclaimed) console.error(`  ${r.kind.padEnd(8)} ${printable(r.title)}  (${printable(r.file)})`);
  }
  if (doubleClaimed.length) {
    console.error(`WARNING: ${doubleClaimed.length} record${doubleClaimed.length === 1 ? "" : "s"} claimed by more than one feature slice (turn on claims.strict to make exactly one owner a rule):`);
    for (const r of doubleClaimed) console.error(`  ${r.kind.padEnd(8)} ${printable(r.title)}  (${printable(r.file)}) — ${files(r.features)}`);
  }
  if (skipped.length) {
    console.error(`WARNING: ${skipped.length} claim file${skipped.length === 1 ? "" : "s"} could not be read — the claim picture is incomplete (claims.strict fails on these):`);
    for (const s of skipped) console.error(`  ${printable(s.file)} (${s.reason})`);
  }
}

if (problems.length) {
  // Bounded: a hostile allow-list or map cannot flood the log (CR-031).
  const shown = problems.slice(0, 200);
  console.error(`Store lints failed (${problems.length}):\n` + shown.map((p) => `  ${p}`).join("\n") + (problems.length > shown.length ? `\n  … and ${problems.length - shown.length} more` : ""));
  process.exit(1);
}
console.log(`store lints passed${!total ? "" : STRICT ? ` (strict claims: ${total - unclaimed.length}/${total} records claimed by a feature, ${unclaimed.length} allowed unclaimed)` : ` (${total - unclaimed.length}/${total} records claimed by a feature)`}`);
}
