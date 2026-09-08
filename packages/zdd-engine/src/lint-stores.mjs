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

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { loadConfig, absentStoreNotes } from "./lib/config.mjs";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { extractBlessings, forwardStamps } from "./lib/map-links.mjs";

export function run(args) {
  const { repoRoot: REPO, paths } = loadConfig(args);
  const ADR_DIR = resolve(REPO, paths.adrDir);
  const MAP_DIR = resolve(REPO, paths.mapDir);
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
// supersession contract, which lint 1 keeps honest).
const stampsByNum = new Map();
const stampsOf = (num) => {
  if (!stampsByNum.has(num)) stampsByNum.set(num, forwardStamps(readFileSync(join(ADR_DIR, byNum.get(num)), "utf8")));
  return stampsByNum.get(num);
};
const walkMarkdown = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkMarkdown(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
};
for (const path of walkMarkdown(MAP_DIR)) {
  const text = readFileSync(path, "utf8");
  const parsed = parseFrontmatter(text);
  const body = parsed ? parsed.body : text;
  const rel = relative(REPO, path).split(/[\\/]/).join("/");
  for (const b of extractBlessings(body)) {
    const where = `${rel} (blessing: "${b.text.length > 60 ? b.text.slice(0, 59) + "…" : b.text}")`;
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

if (problems.length) {
  console.error(`Store lints failed (${problems.length}):\n` + problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log("store lints passed");
}
