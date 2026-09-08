#!/usr/bin/env node
// Report SEMANTIC-MAP concepts whose code is touched by a diff but whose
// concept files were not updated in the same diff.
//
//   zdd-engine freshness [--base <ref>]
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
// changes.
//
// Advisory means advisory: output is GitHub-flavored markdown on stdout (pipe
// into $GITHUB_STEP_SUMMARY) and the exit code is 0 whatever the checkout
// looks like — no git, no origin, an unborn branch, a `--base` that does not
// resolve — with one line saying what could not be compared (CR-011).
// Staleness is a nudge, not a gate; the ritual (/zdd:update), not the nudge,
// is the guarantee. Paths come from git NUL-delimited so a quoted name still
// matches its resource (CR-012), are made adopter-relative when the adopter
// root sits inside a larger checkout (CR-016), and everything read from the
// stores is bounded and never reached through a symlink (CR-013/CR-014).

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { extractLinks } from "./lib/map-links.mjs";
import { walkMarkdown, readBounded, regularFileInside, MAX_STORE_FILE_BYTES } from "./lib/walk-markdown.mjs";

const posixify = (p) => p.split(/[\\/]/).join("/");

// The repo paths a concept describes, each with the ways it came in: the
// frontmatter resource, and/or the ids of the linked metadata records that
// carry it. A link that does not resolve to a regular file physically inside
// metadataDir (a map-to-map link, a broken one — render's job to refuse — or
// a symlinked parent) contributes nothing; a record over the size cap is not
// a record. `cache` is shared across concepts so a record linked from many is
// read once. Exported for the unit test.
export function watchedPaths(conceptPath, text, { bundleDir, metadataDir, cache = new Map() }) {
  const parsed = parseFrontmatter(text);
  const out = new Map(); // path -> [via, ...] in document order
  const add = (path, via) => {
    const p = String(path).trim().replace(/\/+$/, "");
    if (!p) return;
    if (!out.has(p)) out.set(p, []);
    if (!out.get(p).includes(via)) out.get(p).push(via);
  };
  if (parsed?.frontmatter.resource) add(parsed.frontmatter.resource, "resource");
  const body = parsed ? parsed.body : text;
  for (const id of extractLinks(body, dirname(conceptPath), bundleDir)) {
    const file = resolve(bundleDir, `${id}.json`);
    const inside = relative(metadataDir, file);
    if (!inside || inside === ".." || inside.startsWith(`..${inside[2] ?? ""}`) || isAbsolute(inside)) continue;
    if (!cache.has(file)) {
      let resources = [];
      if (regularFileInside(metadataDir, file)) {
        const raw = readBounded(file, MAX_STORE_FILE_BYTES);
        try {
          const record = raw === null ? null : JSON.parse(raw);
          const r = record?.resource;
          resources = Array.isArray(r) ? r.filter((x) => typeof x === "string") : typeof r === "string" ? [r] : [];
        } catch {
          resources = [];
        }
      }
      cache.set(file, resources);
    }
    for (const r of cache.get(file)) add(r, id);
  }
  return [...out].map(([path, via]) => ({ path, via }));
}

// Table cells and code spans are built from checkout-controlled names; a
// pipe, a backtick or a control character in one must not restyle the
// summary (CR-015).
export const cell = (s) => String(s).replace(/[\x00-\x1f\x7f]/g, "?").replace(/\|/g, "\\|").replace(/`/g, "'");

const gitBuf = (cwd, args) => execFileSync("git", args, { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
const gitText = (cwd, args) => gitBuf(cwd, args).toString("utf8").trim();

// The diff to judge: files changed between the base and HEAD, NUL-delimited,
// made adopter-relative (dropping anything outside the adopter root). Returns
// { base, changed } or { note } when nothing can be compared.
export function changedAgainstBase(repoRoot, requestedBase, baseBranch) {
  let top;
  try {
    top = resolve(gitText(repoRoot, ["rev-parse", "--show-toplevel"]));
  } catch {
    return { note: "No git checkout here — nothing to compare the semantic map against." };
  }
  const candidates = requestedBase ? [requestedBase] : [`origin/${baseBranch}`, baseBranch];
  let base = null;
  for (const ref of candidates) {
    try {
      gitText(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      base = ref;
      break;
    } catch {
      /* next */
    }
  }
  if (!base) return { note: `No base to diff against (tried ${candidates.join(", ")}) — nothing to compare the semantic map against.` };
  let raw;
  try {
    raw = gitBuf(repoRoot, ["diff", "--name-only", "-z", `${base}...HEAD`]);
  } catch {
    return { note: `git diff ${base}...HEAD failed (unborn branch, or unrelated histories?) — nothing to compare the semantic map against.` };
  }
  // Both sides through realpath: git reports the canonical long path, while
  // the adopter root may be spelled through a short (8.3) or differently-cased
  // segment — on the D:-drive CI runner the two disagreed and the prefix
  // filter dropped nothing.
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const rootRel = posixify(relative(real(top), real(repoRoot)));
  const prefix = rootRel && rootRel !== "." && !rootRel.startsWith("..") ? rootRel + "/" : "";
  const changed = [];
  for (const f of raw.toString("utf8").split("\0")) {
    if (!f) continue;
    if (prefix) {
      if (!f.startsWith(prefix)) continue;
      changed.push(f.slice(prefix.length));
    } else changed.push(f);
  }
  return { base, changed };
}

export function run(args) {
  const { repoRoot: REPO, paths, baseBranch, bundleDir } = loadConfig(args);
  const SEMANTIC = resolve(REPO, paths.mapDir);
  const METADATA = resolve(REPO, paths.metadataDir);

  const baseIdx = args.indexOf("--base");
  const requested = baseIdx > -1 ? args[baseIdx + 1] : undefined;
  if (baseIdx > -1 && (typeof requested !== "string" || !requested || requested.startsWith("-"))) {
    console.log("`--base` needs a ref (e.g. `--base origin/main`) — nothing compared.");
    return;
  }

  const diff = changedAgainstBase(REPO, requested, baseBranch);
  if (diff.note) {
    console.log(diff.note);
    return;
  }
  const { base, changed } = diff;
  if (changed.length === 0) {
    console.log("No changes against " + base + ".");
    return;
  }
  const changedSet = new Set(changed);

  const stale = [];
  const cache = new Map();
  for (const path of walkMarkdown(SEMANTIC)) {
    const conceptRel = posixify(relative(REPO, path));
    if (changedSet.has(conceptRel)) continue; // concept updated in the same diff
    const text = readBounded(path);
    if (text === null) continue; // over the cap: not a concept the nudge can read
    const hits = [];
    for (const { path: watched, via } of watchedPaths(path, text, { bundleDir, metadataDir: METADATA, cache })) {
      // a watched path may be a file or a directory prefix
      for (const f of changed) if (f === watched || f.startsWith(watched + "/")) hits.push({ file: f, via });
    }
    if (hits.length === 0) continue;
    const files = [];
    const via = [];
    for (const h of hits) {
      if (!files.includes(h.file)) files.push(h.file);
      for (const v of h.via) if (!via.includes(v)) via.push(v);
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
    const files = s.touched.slice(0, 3).map(cell).join("<br>") + (s.touched.length > 3 ? `<br>…+${s.touched.length - 3}` : "");
    const via = s.via.map((v) => (v === "resource" ? "`resource:`" : `\`${cell(v)}\``)).join("<br>");
    console.log(`| \`${cell(s.concept)}\` | ${files} | ${via} |`);
  }
}
