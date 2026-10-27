// Detection (decision 0039): each adapter answers "do I fit this repo?" and
// the core only asks. This file names no adapter and no stack; it walks the
// repo once, hands every adapter the same `scan`, and collects the answers.
//
// An adapter takes part by exporting DETECTION (data) and detect():
//
//   DETECTION = {
//     parts:     the parts of the app it covers, from lib/parts.mjs
//     order:     where its proposal sits in the list (then by name)
//     skipDirs:  folder names that are never source in its stack; the scan
//                skips the union of every adapter's
//     sourceFile: a RegExp over a file name; a match makes the repo existing
//                code rather than greenfield (every adapter's are united)
//     existing:  repo-relative files whose presence alone makes it existing
//     after:     true — detect() runs after the others and sees their names
//     fallback:  true — asked only when an existing repo has no proposal
//     stack:     greenfield rules: [{ rank, match, options, path, app }],
//                `match` a case-blind regex source over a stated stack entry,
//                `path` where that entry's path goes in `options`
//     companion: { all, any } — selected beside a stated stack that has
//                every adapter in `all` and one in `any`
//     example:   { options } — the options its `example/` folder derives
//                with, for the greenfield preview
//     optionShape: { paths, pathLists, callLists, objectLists } — the
//                option keys (dotted) holding a repo-relative path, a list
//                of them, a list of call names, or a list of objects whose
//                named key is a path; bootstrap checks answers against it
//     exampleClaims: lines the example feature slice shows as records to link
//     optIn:     true — every upgrade offers it again where detection finds it
//   }
//   detect({ scan, proposed }) -> null | {
//     proposal:  { evidence: [plain words], options }   (absent: not proposed)
//     apps:      [{ name, evidence, extractor }]         Application concepts
//     questions: [{ topic, ask, records }]               what evidence cannot answer
//   }
//
// The scan: `files` (every regular file, sorted, at most DETECT_DEPTH folders
// deep, never a symlink, never a gitignored path), `read(rel)` (the text, or
// null when refused; cached, under the io's caps), `json(rel)`, and
// `memo(key, fn)`, so adapters sharing a helper compute it once.
// `overBudget` says the read budget ran out; `truncated` that the walk did;
// `refused` lists the files an adapter asked for and the io would not read
// (over 1 MiB, unreadable, a link) — evidence there is unseen, so the
// answer says how many (CR-103).

import { posix } from "node:path";
import { makeExtractorIo } from "./extractor-io.mjs";
import { gitIgnoredPredicate } from "./ignored.mjs";
import { PARTS } from "./parts.mjs";

export const DETECT_DEPTH = 6;
const BUNDLE = "zdd"; // ZDD's own folder is never evidence of a stack

function broken(name, msg) {
  throw new Error(`ZDD's adapter catalogue is broken (a packaging defect, not your repo): adapter '${name}' ${msg}`);
}

export function makeScan(io, skipDirs = new Set()) {
  const files = [];
  const walked = io.walk(".", (rel, name) => files.push({ rel, name, dir: posix.dirname(rel) }), {
    enter: (_rel, name) => !name.startsWith(".") && name !== BUNDLE && !skipDirs.has(name),
  });
  const texts = new Map();
  const memos = new Map();
  let overBudget = false;
  const refused = new Set();
  const scan = {
    files,
    truncated: walked.truncated,
    get overBudget() {
      return overBudget;
    },
    get refused() {
      return [...refused].sort();
    },
    read(rel) {
      if (texts.has(rel)) return texts.get(rel);
      const r = io.read(rel);
      if (!r.ok && r.code === "over-budget") overBudget = true;
      else if (!r.ok && r.code !== "missing" && r.code !== "ignored") refused.add(rel);
      const text = r.ok ? r.text : null;
      texts.set(rel, text);
      return text;
    },
    json(rel) {
      const text = scan.read(rel);
      if (text === null) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    memo(key, fn) {
      if (!memos.has(key)) memos.set(key, fn());
      return memos.get(key);
    },
  };
  return scan;
}

function checkAdapter(name, D) {
  if (!Array.isArray(D.parts) || D.parts.some((p) => !PARTS.includes(p))) broken(name, `names a part outside ${PARTS.join(", ")}`);
  if (!Number.isFinite(D.order)) broken(name, "has no detection order");
}

// modules: [{ name, mod }] in name order (derive.mjs catalogueModules).
// `caps` lowers the io's limits, for the tests that reach them.
export function detectRepo(repoRoot, modules, caps = {}) {
  const adapters = modules.filter(({ mod }) => mod.DETECTION);
  for (const { name, mod } of adapters) checkAdapter(name, mod.DETECTION);
  const ignored = gitIgnoredPredicate(repoRoot);
  if (ignored.error) throw new Error(ignored.error);
  const io = makeExtractorIo(repoRoot, "detect", { ignored, maxDepth: DETECT_DEPTH, ...caps });
  const skipDirs = new Set(adapters.flatMap(({ mod }) => mod.DETECTION.skipDirs ?? []));
  const scan = makeScan(io, skipDirs);

  const sourceRes = adapters.map(({ mod }) => mod.DETECTION.sourceFile).filter(Boolean);
  const sourceFiles = scan.files.filter((f) => sourceRes.some((re) => re.test(f.name))).length;
  const existingFiles = new Set(adapters.flatMap(({ mod }) => mod.DETECTION.existing ?? []));
  const mode = sourceFiles === 0 && !scan.files.some((f) => existingFiles.has(f.rel)) ? "greenfield" : "existing";

  const byOrder = (a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const found = [];
  const ask = (list) => {
    for (const { name, mod } of list) {
      if (typeof mod.detect !== "function") continue;
      const out = mod.detect({ scan, proposed: found.filter((f) => f.proposal).map((f) => f.name) });
      if (out) found.push({ name, order: mod.DETECTION.order, parts: mod.DETECTION.parts, ...out });
    }
  };
  ask(adapters.filter(({ mod }) => !mod.DETECTION.after && !mod.DETECTION.fallback));
  ask(adapters.filter(({ mod }) => mod.DETECTION.after));
  if (mode === "existing" && !found.some((f) => f.proposal)) ask(adapters.filter(({ mod }) => mod.DETECTION.fallback));
  found.sort(byOrder);

  const proposals = found.filter((f) => f.proposal).map((f) => ({ name: f.name, parts: f.parts, evidence: f.proposal.evidence, options: f.proposal.options ?? {} }));
  const apps = found.flatMap((f) => f.apps ?? []).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const questions = found.flatMap((f) => f.questions ?? []);
  const coverage = PARTS.map((part) => ({ part, adapters: proposals.filter((p) => p.parts.includes(part)).map((p) => p.name) }));

  // What a greenfield answer can select, and the neutral list of stacks the
  // catalogue has adapters for (0039 point 6): adapter data, never core text.
  const stacks = adapters
    .flatMap(({ name, mod }) => (mod.DETECTION.stack ?? []).map((r) => ({ adapter: r.app && !r.options ? null : name, rank: r.rank, match: r.match, options: r.options ?? null, path: r.path ?? null, app: r.app ?? null })))
    .sort((a, b) => a.rank - b.rank);
  const companions = adapters.filter(({ mod }) => mod.DETECTION.companion).map(({ name, mod }) => ({ adapter: name, all: mod.DETECTION.companion.all, any: mod.DETECTION.companion.any }));
  const catalogue = PARTS.map((part) => ({ part, adapters: adapters.filter(({ mod }) => mod.DETECTION.parts.includes(part) && (mod.DETECTION.stack ?? []).some((r) => r.options)).map(({ name }) => name) }));

  // What bootstrap needs to write a config without naming a stack: each
  // adapter's option shape (the keys that hold repo-relative paths, lists of
  // them, call names, or lists of objects with a path key), the records an
  // example feature slice can show, and whether an upgrade offers it again.
  const shapes = Object.fromEntries(
    adapters.map(({ name, mod }) => [
      name,
      { parts: mod.DETECTION.parts, optionShape: mod.DETECTION.optionShape ?? {}, exampleClaims: mod.DETECTION.exampleClaims ?? [], optIn: Boolean(mod.DETECTION.optIn && typeof mod.detect === "function") },
    ]),
  );

  return {
    mode,
    sourceFiles,
    proposals,
    apps,
    questions,
    coverage,
    uncovered: coverage.filter((c) => !c.adapters.length).map((c) => c.part),
    stacks,
    companions,
    catalogue,
    adapters: shapes,
    limits: { walkTruncated: scan.truncated, readBudgetSpent: scan.overBudget, depth: DETECT_DEPTH, refused: scan.refused.length, refusedFirst: scan.refused.slice(0, 5) },
  };
}
