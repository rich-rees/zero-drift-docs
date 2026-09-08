#!/usr/bin/env node
// Report SEMANTIC-MAP concepts whose code is touched by a diff but whose
// concept files were not updated in the same diff.
//
//   zdd-engine freshness [--base origin/<base-branch>]
//
// Narrowed to the semantic map (config paths.mapDir) on purpose: the codebase
// metadata has a BLOCKING deterministic check (`zdd-engine derive --check`) —
// zero drift by construction — so the advisory nudge only needs to watch the
// small curated store, where path-overlap is the best a script can see.
//
// What "a concept's code" is (widened in DIO-313): the frontmatter `resource:`
// path, AND the source behind every metadata record the body links to — the
// edges and blessings already point at the route / module / table records,
// and each record carries the file(s) it was derived from. Before this, a
// concept whose resource was one folder never fired when a blessed route in
// another folder changed; PressPlay's video-pipeline concept sat on four such
// changes. Still advisory: output is GitHub-flavored markdown on stdout (pipe
// into $GITHUB_STEP_SUMMARY) and the exit code is always 0 — staleness is a
// nudge, not a gate; the ritual (/zdd:update), not the nudge, is the guarantee.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync, lstatSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { extractLinks } from "./lib/map-links.mjs";

const posixify = (p) => p.split(/[\\/]/).join("/");

// The repo paths a concept describes, each with where it came from: the
// frontmatter resource, or the id of the linked metadata record. A link that
// does not resolve to a regular file inside metadataDir is not a metadata
// link (a map-to-map link, a broken one — render's job to refuse) and
// contributes nothing. Exported for the unit test.
export function watchedPaths(conceptPath, text, { bundleDir, metadataDir }) {
  const parsed = parseFrontmatter(text);
  const out = [];
  const seen = new Set();
  const add = (path, via) => {
    const p = String(path).trim().replace(/\/+$/, "");
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push({ path: p, via });
  };
  if (parsed?.frontmatter.resource) add(parsed.frontmatter.resource, "resource");
  const body = parsed ? parsed.body : text;
  for (const id of extractLinks(body, dirname(conceptPath), bundleDir)) {
    const file = resolve(bundleDir, `${id}.json`);
    const inside = relative(metadataDir, file);
    if (!inside || inside.startsWith("..") || resolve(inside) === inside) continue;
    let record;
    try {
      if (!lstatSync(file).isFile()) continue;
      record = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const resources = Array.isArray(record?.resource) ? record.resource : typeof record?.resource === "string" ? [record.resource] : [];
    for (const r of resources) if (typeof r === "string") add(r, id);
  }
  return out;
}

export function run(args) {
  const { repoRoot: REPO, paths, baseBranch, bundleDir } = loadConfig(args);
  const SEMANTIC = resolve(REPO, paths.mapDir);
  const METADATA = resolve(REPO, paths.metadataDir);

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
    const conceptRel = posixify(relative(REPO, path));
    if (changedSet.has(conceptRel)) continue; // concept updated in the same diff
    const text = readFileSync(path, "utf8");
    const hits = [];
    for (const { path: watched, via } of watchedPaths(path, text, { bundleDir, metadataDir: METADATA })) {
      // a watched path may be a file or a directory prefix
      for (const f of changed) if (f === watched || f.startsWith(watched + "/")) hits.push({ file: f, via });
    }
    if (hits.length === 0) continue;
    const files = [];
    const via = [];
    for (const h of hits) {
      if (!files.includes(h.file)) files.push(h.file);
      if (!via.includes(h.via)) via.push(h.via);
    }
    stale.push({ concept: conceptRel, touched: files, via });
  }

  if (stale.length === 0) {
    console.log("### Semantic map\n\nNo semantic concepts affected by this diff, or all affected concepts were updated. ✅");
    return;
  }

  console.log("### Semantic map — possibly stale concepts ⚠️\n");
  console.log(
    "This diff touches code that the following semantic-map concepts describe — their `resource:` path, or the source behind a metadata record they link to — without updating them. " +
      "If the feature's edges/blessings changed, run `/zdd:update` in this branch (a Claude session skill) and commit the result. " +
      "If the change doesn't alter what the concept says, ignore this.\n",
  );
  console.log("| Concept | Touched files | Via |");
  console.log("|---|---|---|");
  for (const s of stale) {
    const files = s.touched.slice(0, 3).join("<br>") + (s.touched.length > 3 ? `<br>…+${s.touched.length - 3}` : "");
    const via = s.via.map((v) => (v === "resource" ? "`resource:`" : `\`${v}\``)).join("<br>");
    console.log(`| \`${s.concept}\` | ${files} | ${via} |`);
  }
}
