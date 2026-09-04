#!/usr/bin/env node
// Deterministic lints over the curated stores (blocking CI tier).
//
//   zdd-engine lint               # ADR-number + supersession-symmetry lints
//   zdd-engine lint --tempstate   # + TEMPSTATE.md must not exist
//
// 1. Supersession symmetry: an ADR that claims to supersede another fails
//    unless the target carries the matching forward stamp ("Superseded [in
//    part] by ... ADR-NNNN"), so a reader can never land on a dead decision
//    unsignposted.
// 2. TEMPSTATE lint (--tempstate, PRs only — tautological on the base
//    branch): the branch working file must be deleted before merge.
//    Enforced by construction, not ritual.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, absentStoreNotes } from "./lib/config.mjs";

export function run(args) {
  const { repoRoot: REPO, paths } = loadConfig(args);
  const ADR_DIR = resolve(REPO, paths.adrDir);
  // A missing adrDir is greenfield-tolerated (empty corpus passes); say so
  // when the rest of the bundle exists, so a typo is not a silent pass (CR-068).
  for (const note of absentStoreNotes(REPO, paths, ["adrDir"])) console.error(note);

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

// ---- 2. TEMPSTATE lint ----
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
