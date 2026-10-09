#!/usr/bin/env node
// The findings home's one line at session start (CAS-103, the process scope;
// decision 7 of its design session): ZDD findings live as GitHub Issues on
// this repository, labelled `finding` (and `blocker` for one a new user
// following the README can hit). This prints one line counting them and
// recommends a release train when the rule says so — any blocker, ten or
// more findings, or the oldest past thirty days. Silent when `gh` is not
// installed, not logged in, or offline: it is advisory, and a session start
// must never wait on the network for long.
//
//   node scripts/open-findings.mjs            # one line, or nothing
//
// Wired from this repo's .claude/settings.json as a SessionStart hook.
import { execFileSync } from "node:child_process";

const REPO = "rich-rees/zero-drift-docs";
const TRAIN_AT = { findings: 10, days: 30 };

function issues(label) {
  const out = execFileSync("gh", ["issue", "list", "--repo", REPO, "--label", label, "--state", "open", "--limit", "200", "--json", "number,createdAt,title"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 8000,
  });
  return JSON.parse(out);
}

try {
  const findings = issues("finding");
  const blockers = issues("blocker");
  if (!findings.length && !blockers.length) process.exit(0);
  const oldest = findings.map((i) => new Date(i.createdAt)).sort((a, b) => a - b)[0];
  const ageDays = oldest ? Math.floor((Date.now() - oldest.getTime()) / 86_400_000) : 0;
  const reasons = [];
  if (blockers.length) reasons.push(`${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`);
  if (findings.length >= TRAIN_AT.findings) reasons.push(`${findings.length} findings open`);
  if (ageDays >= TRAIN_AT.days) reasons.push(`the oldest is ${ageDays} days old`);
  const train = reasons.length ? ` — a release train is due (${reasons.join("; ")})` : "";
  process.stdout.write(`ZDD findings: ${findings.length} open (oldest ${ageDays} days), ${blockers.length} blocker${blockers.length === 1 ? "" : "s"} — https://github.com/${REPO}/issues?q=is%3Aopen+label%3Afinding${train}\n`);
} catch {
  /* no gh, not logged in, offline: silent */
}
