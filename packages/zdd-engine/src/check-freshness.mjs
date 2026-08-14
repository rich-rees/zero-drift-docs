#!/usr/bin/env node
// Report SEMANTIC-MAP concepts whose `resource:` code paths are touched by a
// diff but whose concept files were not updated in the same diff.
//
//   zdd-engine freshness [--base origin/<base-branch>]
//
// Narrowed to the semantic map (config paths.mapDir) on purpose: the codebase
// metadata has a BLOCKING deterministic check (`zdd-engine derive --check`) —
// zero drift by construction — so the advisory nudge only needs to watch the
// small curated store, where path-overlap is the best a script can see.
// Output is GitHub-flavored markdown on stdout (pipe into
// $GITHUB_STEP_SUMMARY). Always exits 0 — staleness is a nudge, not a gate;
// the ritual (/zdd:update), not the nudge, is the guarantee.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { loadConfig } from "./lib/config.mjs";

export function run(args) {
  const { repoRoot: REPO, paths, baseBranch } = loadConfig(args);
  const SEMANTIC = resolve(REPO, paths.mapDir);

  const baseIdx = args.indexOf("--base");
  const base = baseIdx > -1 ? args[baseIdx + 1] : `origin/${baseBranch}`;

  const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd: REPO,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  if (changed.length === 0) {
    console.log("No changes against " + base + ".");
    return;
  }
  const changedSet = new Set(changed);

  function walkMarkdown(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walkMarkdown(p, out);
      else if (name.endsWith(".md")) out.push(p);
    }
    return out;
  }

  const stale = [];
  for (const path of walkMarkdown(SEMANTIC)) {
    const text = readFileSync(path, "utf8");
    const m = /^resource:\s*(.+)$/m.exec(text);
    if (!m) continue;
    const resource = m[1].trim().replace(/\/+$/, "");
    if (!resource) continue;
    // resource may be a file or a directory prefix
    const touched = changed.filter((f) => f === resource || f.startsWith(resource + "/"));
    if (touched.length === 0) continue;
    const conceptRel = relative(REPO, path).split(/[\\/]/).join("/");
    if (changedSet.has(conceptRel)) continue; // concept updated in the same diff
    stale.push({ concept: conceptRel, touched });
  }

  if (stale.length === 0) {
    console.log("### Semantic map\n\nNo semantic concepts affected by this diff, or all affected concepts were updated. ✅");
    return;
  }

  console.log("### Semantic map — possibly stale concepts ⚠️\n");
  console.log(
    "This diff touches code that the following semantic-map concepts describe, without updating them. " +
      "If the feature's edges/blessings changed, run `/zdd:update` in this branch (a Claude session skill) and commit the result. " +
      "If the change doesn't alter what the concept says, ignore this.\n",
  );
  console.log("| Concept | Touched resource files |");
  console.log("|---|---|");
  for (const s of stale) {
    const files = s.touched.slice(0, 3).join("<br>") + (s.touched.length > 3 ? `<br>…+${s.touched.length - 3}` : "");
    console.log(`| \`${s.concept}\` | ${files} |`);
  }
}
