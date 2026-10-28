#!/usr/bin/env node
// Deterministic lints over the curated stores (blocking CI tier).
//
//   zdd-engine lint               # ADR-number, supersession-symmetry and
//                                 # blessing lints
//   zdd-engine lint --tempstate   # + TEMPSTATE.md must not exist
//   zdd-engine lint --merge       # + the pattern plan must not exist (CI)
//
// 1. Supersession symmetry: an ADR that claims to supersede another fails
//    unless the target carries the matching forward stamp ("Superseded [in
//    part] by ... ADR-NNNN"), so a reader can never land on a dead decision
//    unsignposted.
// 2. Blessings (1.1.0; the store since ZDD-1, decision 0031): a blessing —
//    one file in the blessing store naming the exemplar to copy or extend —
//    fails when the ADR it cites carries a full "Superseded by" stamp, or
//    does not exist, and when its `where` names no file in the repo, its
//    `kind` is missing or neither copy nor extend, or its `applies-to` names
//    no app or package page. A Blessings section left on a map page fails:
//    "upgrade ZDD" moves it. A stale blessing is worse than none: it sends
//    the agent to copy the pattern a later decision refused. The map's first
//    hard check. A citation of an ADR superseded IN PART is a WARNING line on
//    stderr, never a failure.
//    Blessing shape (2.0.0, decision 0015): a blessing that does not open
//    with its trigger question ("Adding an endpoint? …") FAILS — the blessing
//    index lists blessings by that question, so one without it is invisible
//    to a session choosing patterns. A blessing with no reason (neither an
//    ADR citation nor an inline "because …") is a WARNING, and so is one over
//    the length budget: the detail belongs in the ADR.
//    Importance (0.11.0, decision 0045): `importance:` is `high` or absent;
//    any other value FAILS (case-exact, as `kind:` is). More high blessings
//    than a fifth of the store (always at least one allowed) is a WARNING:
//    high means often needed and costly to reinvent, and a pin on half the
//    store pins nothing.
//    Store headers (0.13.0, decision 0047): a blessing or a semantic-map
//    page whose header writes a key twice, or opens a value with a quote
//    and does not close it with the same one (or not at all), FAILS, naming
//    the line — the parser would keep the last key, or strip the odd pair,
//    and read something the author did not write.
// 3. TEMPSTATE lint (--tempstate, PRs only — tautological on the base
//    branch): the branch working file must be deleted before merge.
//    Enforced by construction, not ritual.
// 3b. Pattern plan (2.0.0, decision 0015): paths.patternsPlan is the
//    branch's working file from "choose patterns" until "update ZDD"
//    reconciles it and deletes it in the update commit. With --merge (the CI
//    workflow, which gates the merge) its presence FAILS; without it (local
//    runs, the pre-push hook — the branch must stay pushable while the build
//    runs) it is a WARNING.
// 4. Unclaimed records (1.2.0): every route, table, function and surface
//    that no feature slice links is listed as a WARNING, never a failure — a
//    repo adopting ZDD starts with everything unclaimed, and the list is the
//    checklist `update` works from (decision 0009). The same count sits in
//    the human index header. A record two feature slices claim is a warning
//    too (1.3.0). With `claims.strict` (decision 0012) all three FAIL: an
//    unclaimed record not in `claims.allowUnclaimed`, an allow-list id that
//    names no claimable record, and a record claimed by more than one slice.
// 5. Stray root glossary (1.3.1): a root GLOSSARY.md or CONTEXT.md beside
//    paths.glossary — the file Matt Pocock's skills read and create when
//    docs/agents/domain.md does not redirect them — is a WARNING, never a
//    failure.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { loadConfig, absentStoreNotes } from "./lib/config.mjs";
import { parseFrontmatter, headerProblems } from "./lib/frontmatter.mjs";
import { extractBlessings, blessingHeadings, forwardStamps, BLESSING_LENGTH_BUDGET } from "./lib/map-links.mjs";
import { loadBlessings, BLESSING_KINDS, HEADER_KEYS, IMPORTANCE_VALUES, isHigh, highBudget } from "./lib/blessings.mjs";
import { adrSets, listAdrFiles } from "./lib/adr-sets.mjs";
import { walkMarkdown, readBounded, MAX_STORE_FILE_BYTES } from "./lib/walk-markdown.mjs";
import { unclaimedRecords, CLAIMABLE_KINDS, OPT_IN_CLAIMABLE_KINDS } from "./lib/claims.mjs";
import { recordsInLog, LOG_FORMAT, printable as printableAll } from "./lib/zdd-record.mjs";

// The commits this branch adds over the base (origin/<baseBranch>, then
// <baseBranch>), each with its ZDD record parsed: { commits } or { note }.
// The base resolution mirrors check-freshness.mjs.
export function recordCheck(repoRoot, baseBranch) {
  const git = (a) => execFileSync("git", a, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  try {
    git(["rev-parse", "--show-toplevel"]);
  } catch {
    return { note: "no git checkout here" };
  }
  let base = null;
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    try {
      git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      base = ref;
      break;
    } catch {
      /* next */
    }
  }
  if (!base) return { note: `no base to read commits against (tried origin/${baseBranch}, ${baseBranch})` };
  try {
    return { base, commits: recordsInLog(git(["log", LOG_FORMAT, `${base}..HEAD`])) };
  } catch {
    return { note: `git log ${base}..HEAD failed (an unborn branch, or unrelated histories?)` };
  }
}

export function run(args) {
  const { repoRoot: REPO, config, paths, bundleDir, baseBranch } = loadConfig(args);
  // `claims` (1.3.0, decision 0012): opt-in strict mode. Checked before
  // any lint runs, so a malformed block is the one thing reported.
  // Only an ABSENT block defaults: `null` or a misspelt key is an error,
  // never strict silently off (1.3.0 CR-027/028); the allow-list is bounded
  // (CR-031).
  const claimsCfg = config.claims === undefined ? {} : config.claims;
  const CLAIMS_KEYS = ["strict", "allowUnclaimed", "strictKinds"];
  const isObject = claimsCfg !== null && typeof claimsCfg === "object" && !Array.isArray(claimsCfg);
  const unknownKey = isObject ? Object.keys(claimsCfg).find((k) => !CLAIMS_KEYS.includes(k)) : undefined;
  const allow = isObject ? claimsCfg.allowUnclaimed : undefined;
  // `service` and `external-service` are both real kinds for one release (2.3
  // rename, 2.3.0, pick 3): which one a repo emits follows its config key,
  // and "upgrade ZDD" moves both the key and this list together.
  const strictKinds = isObject ? claimsCfg.strictKinds : undefined;
  const badKind = Array.isArray(strictKinds) ? strictKinds.find((k) => typeof k !== "string" || !OPT_IN_CLAIMABLE_KINDS.includes(k)) : undefined;
  const claimsError =
    !isObject ? "'claims' must be an object"
    : unknownKey !== undefined ? `'claims' has an unknown key '${unknownKey.replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 40)}' (known: ${CLAIMS_KEYS.join(", ")})`
    : claimsCfg.strict !== undefined && typeof claimsCfg.strict !== "boolean" ? "'claims.strict' must be true or false"
    : allow !== undefined && (!Array.isArray(allow) || !allow.every((x) => typeof x === "string"))
      ? "'claims.allowUnclaimed' must be an array of record ids (\"route:/health\")"
    : allow !== undefined && allow.length > 10_000 ? "'claims.allowUnclaimed' lists more than 10000 ids"
    : allow !== undefined && allow.some((x) => x.length > 512) ? "'claims.allowUnclaimed' ids must be at most 512 characters"
    : strictKinds !== undefined && !Array.isArray(strictKinds) ? `'claims.strictKinds' must be an array of kinds (${OPT_IN_CLAIMABLE_KINDS.join(", ")})`
    : badKind !== undefined
      ? CLAIMABLE_KINDS.includes(badKind)
        ? `'claims.strictKinds' lists '${badKind}', which 'claims.strict' already governs — remove it`
        : `'claims.strictKinds' lists '${String(badKind).replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 40)}', which is no opt-in claimable kind (${OPT_IN_CLAIMABLE_KINDS.join(", ")})`
      : null;
  if (claimsError) {
    console.error(`zdd/config.json: ${claimsError}`);
    process.exit(1);
  }
  const STRICT = claimsCfg.strict === true;
  const ALLOWED = new Set(claimsCfg.allowUnclaimed ?? []);
  // Which kinds strict governs (decision 0017): the original five always;
  // an opt-in kind only when strictKinds names it.
  const STRICT_KINDS = new Set([...CLAIMABLE_KINDS, ...(strictKinds ?? [])]);
  // A half-migrated config (CR-419): strictKinds names `service` while the
  // records are `external-service`, or the reverse — strict would govern
  // nothing of either. Said, so a green lint is not a silent loosening.
  for (const [named, emitted] of [["service", "external-service"], ["external-service", "service"]]) {
    if ((strictKinds ?? []).includes(named) && !existsSync(resolve(REPO, paths.metadataDir, named)) && existsSync(resolve(REPO, paths.metadataDir, emitted))) {
      console.error(`WARNING: claims.strictKinds names '${named}' but the records are '${emitted}' (${paths.metadataDir}/${emitted}/) — strict governs neither; say "upgrade ZDD", which moves the config key and this list together`);
    }
  }
  const MAP_DIR = resolve(REPO, paths.mapDir);
  const METADATA_DIR = resolve(REPO, paths.metadataDir);
  // A missing adrDir or mapDir is greenfield-tolerated (empty corpus passes);
  // say so when the rest of the bundle exists, so a typo is not a silent pass
  // (CR-068).
  for (const note of absentStoreNotes(REPO, paths, ["adrDir", "mapDir", "blessingsDir", ...(paths.harnessAdrDir !== undefined ? ["harnessAdrDir"] : [])])) console.error(note);

  const problems = [];

// Both ADR sets when the harness set is configured (decision 0033): one
// number line, so every check below keys on the number across both folders.
// With one set an ADR is named by its file, as before; with two, by its
// folder too.
const { files: adrEntries, unreadable: adrUnreadable } = listAdrFiles(REPO, paths);
// A set that exists but cannot be listed is a lint failure, never an empty
// corpus that passes (CR-032).
for (const u of adrUnreadable) problems.push(`${u.dir}: could not be listed (${u.code}) — its ADRs are not checked; an ADR folder must be a readable folder`);
const twoSets = adrSets(paths).length > 1;
const nameOf = (e) => (twoSets ? `${e.dir}/${e.file}` : e.file);

// ---- 0. Duplicate ADR numbers ----
// Two concurrent branches each minting "the next ADR" merge WITHOUT a git
// conflict (different filenames), silently yielding two ADRs with one number —
// and number is what citations and the supersession lint key on. First PR to
// merge keeps the number; the later branch renumbers when it syncs master.
// Which file that branch added is the branch's to know, never the sort
// order's (2.4.1 CR-001): both are named and neither is picked.
const seenNum = new Map();
for (const e of adrEntries) {
  const n = e.num;
  if (seenNum.has(n)) {
    problems.push(
      `duplicate ADR number ${n}: ${nameOf(seenNum.get(n))} and ${nameOf(e)} — ${twoSets ? "the two ADR sets share one number line (decision 0033); " : ""}two branches each minted it; ` +
        `the ADR the later-merged branch added takes the next free number (rename it, retitle it, rewrite its citations), the other keeps ${n}`,
    );
  } else {
    seenNum.set(n, e);
  }
}

// ---- 1. Supersession symmetry ----
const byNum = new Map();
for (const e of adrEntries) if (!byNum.has(e.num)) byNum.set(e.num, e);

for (const entry of adrEntries) {
  const file = nameOf(entry);
  const text = readFileSync(entry.abs, "utf8");
  // Active claims only ("supersedes ADR-NNNN"); the passive stamp
  // ("Superseded by ...") is the other side of the contract.
  for (const m of text.matchAll(/\bsupersedes\b[\s\S]{0,120}?ADR[-\s]?0*(\d+)/gi)) {
    const targetNum = m[1].padStart(4, "0");
    const target = byNum.get(targetNum);
    if (!target) {
      problems.push(`${file}: claims to supersede ADR-${targetNum}, which does not exist`);
      continue;
    }
    const targetFile = nameOf(target);
    const targetText = readFileSync(target.abs, "utf8");
    const claimerNum = entry.num;
    const stamp = new RegExp(`\\bsuperseded(\\s+in\\s+part)?\\s+by\\b[\\s\\S]{0,120}?ADR[-\\s]?0*${Number(claimerNum)}\\b`, "i");
    if (!stamp.test(targetText)) {
      problems.push(
        `${file}: supersedes ADR-${targetNum}, but ${targetFile} carries no ` +
          `"Superseded [in part] by ADR-${claimerNum}" stamp — add the forward stamp`,
      );
    }
  }
}

// ---- 2. Blessings (decision 0031) ----
// Blessings live in the blessing store, one file each. A `# Blessings`
// section left on a semantic-map page FAILS: "upgrade ZDD" moves them
// (decision 0032), and two homes would mean two parsers. Every blessing in
// the store is checked against the ADR corpus as it stands — stamps are read
// from the cited ADR's own text (the forward half of the supersession
// contract, which lint 1 keeps honest) — and against the repo: its `where`
// must name a file that exists. Both stores are walked the hardened way —
// symlinks skipped, reads bounded (CR-018/CR-019) — and a file over the cap
// is a lint failure, not a silent pass. Excerpts in diagnostics have control
// characters neutralised (CR-025).
const printable = (t) => t.replace(/[\x00-\x1f\x7f]/g, "?");
const stampsByNum = new Map();
const stampsOf = (num) => {
  if (!stampsByNum.has(num)) stampsByNum.set(num, forwardStamps(readFileSync(byNum.get(num).abs, "utf8")));
  return stampsByNum.get(num);
};
// A header that says one thing twice, or opens a value with a quote and
// does not close it with the same one (decision 0047): the parser reads it
// silently, so lint fails it. A key or value is cut short in the message,
// so a hostile header cannot flood the log.
const brief = (t, n = 60) => {
  const p = printable(String(t));
  return p.length > n ? `${p.slice(0, n - 1)}…` : p;
};
const headerLint = (rel, found) => {
  for (const h of found) {
    if (h.problem === "repeated") problems.push(`${printable(rel)}:${h.line}: '${brief(h.key)}' is written twice (first on line ${h.first}) — ZDD reads only the last one; keep one line`);
    else problems.push(`${printable(rel)}:${h.line}: '${brief(h.key)}' opens with one quote and does not close with the same one — ZDD would read it as '${brief(h.read)}'; close it with the same quote, or drop both`);
  }
};
const BLESSINGS_DIR = resolve(REPO, paths.blessingsDir);
const blessingsRel = paths.blessingsDir.split("\\").join("/").replace(/\/+$/, "");
const mapPages = new Map(); // path under the map folder, no .md -> its type
for (const path of walkMarkdown(MAP_DIR)) {
  const rel = relative(REPO, path).split(/[\\/]/).join("/");
  const text = readBounded(path, MAX_STORE_FILE_BYTES);
  if (text === null) {
    problems.push(`${rel}: over ${MAX_STORE_FILE_BYTES / 1024} KiB — a semantic-map concept is a short document; split it or move the bulk out of the map`);
    continue;
  }
  headerLint(rel, headerProblems(text));
  const parsed = parseFrontmatter(text);
  mapPages.set(relative(MAP_DIR, path).split(/[\\/]/).join("/").replace(/\.md$/, ""), parsed ? String(parsed.frontmatter.type ?? "") : "");
  const left = extractBlessings(parsed ? parsed.body : text);
  if (left.length) {
    problems.push(
      `${rel}: holds ${left.length} blessing${left.length === 1 ? "" : "s"} under a Blessings heading — since 2.5 a blessing is a file of its own in ${blessingsRel}/ ` +
        `(decision 0031); say "upgrade ZDD", which moves them and names any it cannot`,
    );
  } else if (blessingHeadings(parsed ? parsed.body : text)) {
    problems.push(`${rel}: has a Blessings heading with no blessing under it — since 2.5 blessings live in ${blessingsRel}/ (decision 0031); move what the section says there, or into the page's prose, and remove the heading`);
  }
}
const store = loadBlessings(BLESSINGS_DIR, REPO);
for (const f of store.unreadable) problems.push(`${printable(f)}: over ${MAX_STORE_FILE_BYTES / 1024} KiB or unreadable — a blessing is a few lines; the detail belongs in its ADR`);
// What the walk did not read is a blessing lint did not check (CR-006): a
// symlink, an unlistable folder, a cut-off — each a failure, never a pass.
for (const s of store.skipped) problems.push(`${printable(relative(REPO, s.path).split(/[\\/]/).join("/") || ".")}: ${s.reason} — a blessing there is not checked; the blessing store holds regular files only`);
const REPO_REAL = (() => {
  try {
    return realpathSync(REPO);
  } catch {
    return REPO;
  }
})();
for (const b of store.blessings) {
  headerLint(b.file, b.headerProblems ?? []);
  const excerpt = printable(b.text.length > 60 ? b.text.slice(0, 59) + "…" : b.text);
  const where = `${printable(b.file)} (blessing: "${excerpt}")`;
  const shape = b.shape;
  if (!shape.question) {
    problems.push(
      `${where}: opens with no trigger question — start it with the question it answers ("Adding an endpoint? Copy …"); ` +
        `the blessing index lists blessings by that question, so this one is invisible to a session choosing patterns`,
    );
  }
  if (!b.where) {
    problems.push(`${where}: has no 'where:' — name the code to start from, a repo path and optionally its symbol ("where: src/lib/upload.ts (uploadMedia)")`);
  } else {
    const target = resolve(REPO, b.where.path);
    const inside = !/^([a-z][a-z0-9+.-]*:|\/|\\)/i.test(b.where.path) && !relative(REPO, target).split(/[\\/]/).includes("..");
    let isFile = false;
    if (inside) {
      try {
        isFile = lstatSync(target).isFile() && !relative(REPO_REAL, realpathSync(target)).split(/[\\/]/).includes("..");
      } catch {
        isFile = false;
      }
    }
    if (!inside) problems.push(`${where}: 'where: ${printable(b.where.path)}' is not a path inside the repo — name a file relative to the repo root`);
    else if (!isFile) problems.push(`${where}: 'where: ${printable(b.where.path)}' names no file in the repo — the exemplar moved or was deleted; point the blessing at the code as it is now, or drop it`);
  }
  if (b.kind === null) problems.push(`${where}: has no 'kind:' — 'copy' (imitate this method) or 'extend' (reuse this shared code; extending it means retesting what uses it)`);
  else if (!BLESSING_KINDS.includes(b.kind)) problems.push(`${where}: 'kind: ${printable(b.kind)}' is neither 'copy' nor 'extend'`);
  if (b.importance !== null && !IMPORTANCE_VALUES.includes(b.importance)) {
    problems.push(`${where}: 'importance: ${printable(b.importance)}' is not 'high' — write 'importance: high' for a blessing that is often needed and costly to reinvent, or remove the line for a normal one`);
  }
  if (b.appliesTo !== null) {
    const type = mapPages.get(b.appliesTo);
    if (type === undefined) problems.push(`${where}: 'applies-to: ${printable(b.appliesTo)}' names no semantic-map page — give an app or package page's path under ${paths.mapDir}/, without .md ("apps/web")`);
    else if (!["Application", "Package"].includes(type)) problems.push(`${where}: 'applies-to: ${printable(b.appliesTo)}' is a ${printable(type || "untyped")} page — a house rule applies to an app or a package; name one, or remove the line`);
  }
  if (b.firstBuiltIn !== null && !mapPages.has(b.firstBuiltIn)) {
    console.error(`WARNING: ${where} 'first-built-in: ${printable(b.firstBuiltIn)}' names no semantic-map page — give its path under ${paths.mapDir}/, without .md ("features/jobs")`);
  }
  // At most ten keys, each cut short: a hostile header cannot flood the log.
  if (b.unknownKeys.length) {
    const named = b.unknownKeys.slice(0, 10).map((k) => brief(k, 40)).join(", ") + (b.unknownKeys.length > 10 ? `, +${b.unknownKeys.length - 10} more` : "");
    console.error(`WARNING: ${where} has header line${b.unknownKeys.length === 1 ? "" : "s"} ZDD does not read (${named}) — the header is ${HEADER_KEYS.join(", ")}`);
  }
  if (shape.length > BLESSING_LENGTH_BUDGET) {
    console.error(`WARNING: ${where} is ${shape.length} characters (budget ${BLESSING_LENGTH_BUDGET}) — keep the question, the exemplar, the refusal and the reason; the detail belongs in the ADR`);
  }
  if (!b.adrs.length) {
    if (!shape.because) console.error(`WARNING: ${where} gives no reason — cite the ADR that blessed it ('adr:'), or say why inline ("because …")`);
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
{
  const high = store.blessings.filter(isHigh);
  const budget = highBudget(store.blessings.length);
  if (high.length > budget) {
    console.error(
      `WARNING: ${high.length} of ${store.blessings.length} blessings are 'importance: high' (at most ${budget}: a fifth of the store, at least one) — ` +
        `keep high for a blessing that is often needed and costly to reinvent; a pin on many pins none (${high.map((b) => printable(b.file)).join(", ")})`,
    );
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

// ---- 3b. Pattern plan ----
// lstat, not existsSync: a plan that is a dangling symlink is still a file
// someone committed.
let planPresent = false;
try {
  lstatSync(resolve(REPO, paths.patternsPlan));
  planPresent = true;
} catch {
  planPresent = false;
}
if (planPresent && args.includes("--merge")) {
  problems.push(
    `${paths.patternsPlan}: the pattern plan must be reconciled before merge — say "update ZDD": it mints the blessings that ` +
      `survived, records the rest in the update commit's message, and deletes this file in that commit`,
  );
} else if (planPresent) {
  console.error(`WARNING: ${paths.patternsPlan} is on this branch — "update ZDD" reconciles and deletes it; CI (lint --merge) fails while it exists`);
}

// ---- 3c. The ZDD record (decision 0029) ----
// With --merge only: every commit on this branch since the base that carries
// a `ZDD record:` (or legacy `Pattern record:`) is checked for SHAPE — the
// five sections in order, known verbs, `reused` under map only, a `turned`
// or `confirmed` that says what would otherwise have happened. WARNINGS,
// never failures: a commit message cannot be fixed without a rewrite, and
// the tier for "wrong but not broken" is a warning (decision 0009). Absence
// of a record is never a warning — a branch with no update commit yet is
// normal. Where git cannot answer, one line says so and the check skips.
if (args.includes("--merge")) {
  const found = recordCheck(REPO, baseBranch);
  if (found.note) console.error(`NOTE: ZDD record check skipped — ${found.note}`);
  for (const c of found.commits ?? []) {
    if (!c.record || !c.record.problems.length) continue;
    console.error(`WARNING: ${c.hash.slice(0, 7)} "${printableAll(c.subject).slice(0, 60)}" carries a ZDD record the tally cannot fully read (shape only; the sentence's truth is the reviewer's; a refused line is left out of the tally):`);
    for (const p of c.record.problems) console.error(`  ${printableAll(p)}`);
  }
}

// ---- 4. Claims: unclaimed and double-claimed records ----
// Read after the blocking lints so a failure above is not buried under the
// list. Absent metadata (greenfield, or derive not yet run) is an empty
// inventory: nothing to claim, no line printed.
const { total, records, unclaimed, doubleClaimed, skipped, unplaced, unknownTasks } = unclaimedRecords({ metadataDir: METADATA_DIR, mapDir: MAP_DIR, bundleDir });
// Every adopter-controlled path is printable before it reaches the log — a
// control character in a filename cannot forge a line (1.3.0 CR-032).
const files = (list) => list.map(printable).join(", ");
if (STRICT) {
  // A strict pass means every file was read (1.3.0 CR-029, decision 0012).
  for (const s of skipped) {
    problems.push(`claims.strict: ${printable(s.file)} could not be read (${s.reason}) — ${s.record ? "its record is unknown" : "its claims are unknown"}`);
  }
  const ids = new Set(records.map((r) => r.id));
  const softUnclaimed = [];
  for (const r of unclaimed) {
    if (ALLOWED.has(r.id)) continue;
    if (STRICT_KINDS.has(r.kind)) problems.push(`${printable(r.id)} is unclaimed — claims.strict: link it from one feature slice, or add it to claims.allowUnclaimed (${printable(r.file)})`);
    else softUnclaimed.push(r);
  }
  if (softUnclaimed.length) {
    console.error(`WARNING: ${softUnclaimed.length} record${softUnclaimed.length === 1 ? "" : "s"} of an opt-in kind unclaimed — not a failure until claims.strictKinds names the kind (${[...new Set(softUnclaimed.map((r) => r.kind))].sort().join(", ")}):`);
    for (const r of softUnclaimed) console.error(`  ${r.kind.padEnd(9)} ${printable(r.title)}  (${printable(r.file)})`);
  }
  for (const id of [...ALLOWED].sort()) {
    if (!ids.has(id)) problems.push(`claims.allowUnclaimed lists '${printable(id)}', which is no claimable record — remove it`);
  }
  for (const r of doubleClaimed) {
    if (STRICT_KINDS.has(r.kind)) problems.push(`${printable(r.id)} is claimed by ${r.features.length} feature slices (${files(r.features)}) — claims.strict: exactly one owns a record`);
    else console.error(`WARNING: ${printable(r.id)} is claimed by ${r.features.length} feature slices (${files(r.features)}) — a failure once claims.strictKinds names '${r.kind}'`);
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

// ---- 4b. API calls the resolver could not place (decision 0019) ----
// A `${variable}` segment matches only a route parameter; a call whose
// variable the scan could not read as a union of literals, and that fits no
// route that way, has no edge — and that is said here, not only under
// `derive --verbose`. A warning, never a failure: the fix is in the code
// (type the variable) or in the routes, not in the stores.
if (unplaced.length) {
  const n = unplaced.reduce((sum, r) => sum + r.calls.length, 0);
  console.error(`WARNING: ${n} API call${n === 1 ? "" : "s"} could not be placed on a route — a variable segment (\`*\`) matches only a route parameter, never a fixed word; type the variable as a union of string literals so the call expands, or the edge stays missing:`);
  for (const r of unplaced) for (const c of r.calls) console.error(`  ${printable(r.id)}  ${printable(c)}  (${printable(r.file)})`);
}

// ---- 4c. Background tasks whose mode is unknown (decision 0020) ----
// Each names the option on the reader that read it (CR-010).
if (unknownTasks.length) {
  console.error(`WARNING: ${unknownTasks.length} background task${unknownTasks.length === 1 ? "" : "s"} with no stated mode — a worker or a scheduled task? The manifests do not say: commit the platform's manifest that states how it runs (and its schedule, for a scheduled one), or set the reader's modes option to "worker" or "scheduled":`);
  for (const j of unknownTasks) {
    const where = j.reader ? `extractorOptions[${JSON.stringify(j.reader)}].modes[${JSON.stringify(j.title)}]` : "the reading adapter's modes option";
    console.error(`  ${printable(j.id)}  (from ${printable(j.manifest)}; ${printable(j.file)}) — set ${printable(where)}`);
  }
}

// ---- 5. Stray root glossary (1.3.1) ----
// Matt Pocock's skills (1.3+) read and lazily create a root GLOSSARY.md
// (CONTEXT.md before 1.3). Here the glossary is paths.glossary, so a root
// file of either name beside it holds terms nothing reads. A WARNING, never a
// failure: the same tier as an unclaimed record — a nudge to fold the terms
// in, not a contract an adopter mid-migration should go red on. Matched by
// exact name (the names the skills use); the configured glossary itself is
// never a stray, whatever it is called.
const configuredGlossary = String(paths.glossary).split("\\").join("/").replace(/^\.\//, "");
for (const name of ["GLOSSARY.md", "CONTEXT.md"]) {
  if (name === configuredGlossary) continue;
  let present = false;
  try {
    present = readdirSync(REPO).includes(name);
  } catch {
    present = false;
  }
  if (!present) continue;
  console.error(
    `WARNING: ${name} at the repo root beside ${paths.glossary} — Matt Pocock's skills read and create a root ${name === "CONTEXT.md" ? "CONTEXT.md (GLOSSARY.md since 1.3)" : "GLOSSARY.md"} unless docs/agents/domain.md points them at ZDD's glossary; ` +
      `fold its terms into ${paths.glossary} and delete it ("upgrade ZDD" writes docs/agents/domain.md when it is missing)`,
  );
}

if (problems.length) {
  // Bounded: a hostile allow-list or map cannot flood the log (CR-031).
  const shown = problems.slice(0, 200);
  console.error(`Store lints failed (${problems.length}):\n` + shown.map((p) => `  ${p}`).join("\n") + (problems.length > shown.length ? `\n  … and ${problems.length - shown.length} more` : ""));
  process.exit(1);
}
console.log(`store lints passed${!total ? "" : STRICT ? ` (strict claims: ${total - unclaimed.length}/${total} records claimed by a feature, ${unclaimed.length} allowed unclaimed)` : ` (${total - unclaimed.length}/${total} records claimed by a feature)`}`);
}
