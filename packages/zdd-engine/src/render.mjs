#!/usr/bin/env node
// ZDD renderer.
//
//   zdd-engine render           # write human-index.html + agent-index.md + adr-index.md
//   zdd-engine render --check   # exit 1 if any is stale
//
// Renders the semantic map + codebase metadata join into the machine products:
//   - human index  — the hosted graph view
//   - agent index  — llms.txt-shaped, feature-first, budget ~2k tokens
//   - ADR index    — one orientation line per ADR
// Renderings carry no facts of their own and are never edited; if one looks
// wrong the fix is in a store, the derived layer, or this renderer.
// Deterministic: same inputs in, byte-identical outputs. Node stdlib only.
// The inputs include the git history OF THE STORE FILES ONLY (for the
// latest-change highlight) — never the wider history, so non-store commits
// cannot change the outputs. Repos that want no git dependency at all set
// config `render.storeChanges: false`.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { changedTerms, parseNameStatus } from "./lib/store-changes.mjs";
import { refreshOriginBase } from "./lib/fetch-freshness.mjs";
import { buildAdrIndex } from "./lib/adr-index.mjs";
import { loadConfig } from "./lib/config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Per-run state, set by run() from the adopter's config: repo root, artifact
// paths, the bundle folder node ids are relative to (the zdd/ folder), the
// display name, the GitHub base URL for source links, and the base branch.
let REPO, CONFIG, PATHS, BUNDLE, SEMANTIC, DERIVED, OUT_HTML, OUT_INDEX, OUT_ADR_INDEX;
let BUNDLE_NAME, REPO_BASE, BASE_BRANCH;

// Palette keys are the v1 display-type names on purpose (legends and the
// dark-mode fold in viz.js key on them). Module / Database Function /
// Storage Bucket got their own entries under DIO-149 — they previously all
// collapsed into the fallback grey and were indistinguishable across views.
const TYPE_PALETTE = {
  "API Endpoint": "#2a78d6",
  "Table": "#008300",
  "UI Surface": "#e87ba4",
  "Feature": "#4a3aa7",
  "External Service": "#eda100",
  "Database Function": "#0d9488",
  "Storage Bucket": "#b45309",
  "Module": "#64748b",
};
const DEFAULT_NODE_COLOR = "#94a3b8";
const KIND_DISPLAY = {
  route: "API Endpoint",
  table: "Table",
  surface: "UI Surface",
  function: "Database Function",
  bucket: "Storage Bucket",
  module: "Module",
  job: "Job",
};

const posixify = (p) => p.split(/[\\/]/).join("/");

function walk(dir, ext, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

// Frontmatter parsing lives in lib/frontmatter.mjs (CRLF-tolerant, DIO-148) —
// extracted so it can be unit-tested: this module runs render() on import.

// ---------------------------------------------------------------------------
// Store embeds (DIO-149, ADR-0021): the glossary and the full ADR corpus ride
// into viz.html as render projections — read-only copies for the hosted-wiki
// audience (no repo checkout). Single-sourced from the glossary / ADR corpus
// (config paths.glossary / paths.adrDir), so
// `render --check` proves the embedded copy matches the stores every PR.
// Normalize CRLF on read: a core.autocrlf Windows checkout would otherwise
// embed different bytes than CI and fail the check (same trap as DIO-148).
// ---------------------------------------------------------------------------
const normEol = (s) => s.replace(/\r\n/g, "\n");
function loadDocs() {
  const glossary = normEol(readFileSync(resolve(REPO, PATHS.glossary), "utf8"));
  const adrDir = resolve(REPO, PATHS.adrDir);
  const adrs = [];
  for (const path of walk(adrDir, ".md")) {
    const file = posixify(relative(adrDir, path));
    const num = /^(\d{4})-/.exec(file)?.[1];
    if (!num) continue;
    const body = normEol(readFileSync(path, "utf8"));
    const title = /^#\s+(.+)$/m.exec(body)?.[1] ?? file;
    adrs.push({ num, file, title, body });
  }
  return { glossary, adrs };
}

// ---------------------------------------------------------------------------
// Latest store change: which ADRs / glossary terms the most recent
// store-touching commit-set changed — so the hosted human index can highlight
// "what just changed". Determinism constraint (load-bearing): the result must
// be a pure function of the STORES' git history + working tree, identical on
// the dev branch, the CI merge ref, and the base branch after the merge —
// otherwise `render --check` churns. Two-step rule:
//   1. stores diff vs merge-base(HEAD, origin/<base>), working tree included —
//      on a feature branch this is "everything this PR changed so far";
//   2. empty (i.e. on/at the base branch) -> the last first-parent
//      store-touching commit's own diff — after a merge commit that is the
//      whole merged PR.
// Both sides of a store-touching PR agree: step 1 on the branch and step 2 on
// the base branch after merge produce the same set. No commit hashes or dates
// are embedded (they differ between the branch and the CI merge ref / churn).
// ---------------------------------------------------------------------------
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // git's canonical empty tree
function computeStoreChanges(glossaryText) {
  // Opt-out for repos that want no git dependency in the render (fixtures,
  // no-git environments): highlights off is deterministic by construction.
  if (CONFIG.render?.storeChanges === false) return { adrs: [], glossaryTerms: [] };
  // timeout bounds the fetch below (a hung network degrades to the warning
  // instead of hanging the render); local git ops finish in ms.
  const git = (...args) =>
    execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  // origin/<base> must be fresh before the merge-base below, or a stale clone
  // embeds a changed-set CI disagrees with.
  refreshOriginBase(git, BASE_BRANCH);
  const glossaryRel = posixify(relative(REPO, resolve(REPO, PATHS.glossary)));
  const adrRel = posixify(relative(REPO, resolve(REPO, PATHS.adrDir))) + "/";
  const storePaths = [glossaryRel, adrRel];
  const none = { adrs: [], glossaryTerms: [] };
  try {
    let left = null;
    let right = null; // null right side = working tree
    // Untracked store files (a just-written ADR) are invisible to `git diff`
    // — surface them as additions so the pre-commit render already counts them.
    const untracked = git("ls-files", "--others", "--exclude-standard", "--", ...storePaths)
      .split("\n")
      .filter(Boolean)
      .map((p) => `A\t${p}`);
    try {
      const base = git("merge-base", "HEAD", `origin/${BASE_BRANCH}`).trim();
      if (untracked.length || git("diff", "--name-only", base, "--", ...storePaths).trim()) left = base;
    } catch {
      // no origin/<base> (unusual checkout) — fall through to step 2
    }
    if (!left) {
      const m = git("log", "--first-parent", "-1", "--format=%H", "--", ...storePaths).trim();
      if (!m) return none;
      try {
        left = git("rev-parse", "--verify", `${m}^1`).trim();
      } catch {
        left = EMPTY_TREE; // root commit
      }
      right = m;
    }
    const diffArgs = (extra, ...paths) =>
      right ? ["diff", ...extra, left, right, "--", ...paths] : ["diff", ...extra, left, "--", ...paths];
    const nameStatus = [git(...diffArgs(["--name-status"], ...storePaths))];
    if (!right) nameStatus.push(...untracked);
    const { adrs, glossaryChanged } = parseNameStatus(
      nameStatus.join("\n"),
      glossaryRel,
      adrRel,
    );
    let glossaryTerms = [];
    if (glossaryChanged) {
      const newGlossary = right ? normEol(git("show", `${right}:${glossaryRel}`)) : glossaryText;
      let oldGlossary = "";
      try {
        oldGlossary = normEol(git("show", `${left}:${glossaryRel}`));
      } catch {
        // no glossary on the left side (brand-new file / empty tree)
      }
      glossaryTerms = changedTerms(oldGlossary, newGlossary, git(...diffArgs(["-U0"], glossaryRel)));
    }
    return { adrs, glossaryTerms };
  } catch (e) {
    // No git available: degrade to no highlights rather than blocking the
    // render — but say so, because a checkout WITH git would render different
    // bytes and fail --check against this output.
    console.error(`WARNING: store-change highlights unavailable (${e.message.split("\n")[0]})`);
    return none;
  }
}

// Bare ADR-NNNN citations become links. viz.html resolves them in-page (the
// viewer owns that); markdown output gets explicit targets via this helper —
// skip citations that are already link text or part of a path.
function linkifyAdrCitations(text, adrs, hrefOf) {
  const byNum = new Map(adrs.map((a) => [a.num, a.file]));
  return text.replace(/(?<!\[)\bADR-(\d{4})\b(?!\]|\()/g, (m, num) =>
    byNum.has(num) ? `[ADR-${num}](${hrefOf(byNum.get(num))})` : m,
  );
}

// Map bodies link bundle-absolutely to .md (map) and .json (metadata)
// targets. Node ids are bundle-relative paths minus extension for BOTH layers,
// so links resolve to ids by simple path arithmetic.
const LINK_RE = /\]\(([^)\s]+\.(?:md|json))(?:#[A-Za-z0-9_-]*)?\)/g;
function extractLinks(body, docDir) {
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(LINK_RE)) {
    const target = m[1];
    if (target.includes("://")) continue;
    const abs = target.startsWith("/") ? join(BUNDLE, target.slice(1)) : resolve(docDir, target);
    const rel = posixify(relative(BUNDLE, abs));
    if (rel.startsWith("..")) continue;
    const id = rel.replace(/\.(md|json)$/, "");
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Derived record -> synthesized markdown body (detail panel renders this via
// marked, exactly like a v1 hand-written body — but this one cannot drift).
// ---------------------------------------------------------------------------
function synthesizeBody(record, idOfRef) {
  const lines = [];
  if (record.description) lines.push(record.description, "");
  const f = record.facts;
  if (record.kind === "route") {
    lines.push(`# Methods`, "", f.methods.length ? f.methods.map((m) => `- \`${m}\``).join("\n") : "_(none exported)_", "");
    lines.push(`# Auth`, "", f.auth, "");
  }
  if (record.kind === "table") {
    lines.push(`# Columns (${f.namespace})`, "", "| column | type |", "| --- | --- |");
    for (const c of f.columns) {
      lines.push(`| ${c.name}${c.references ? ` → ${c.references}` : ""} | ${c.type} |`);
    }
    lines.push("");
    if (f.renamedFrom) lines.push(`Renamed from: ${f.renamedFrom.join(", ")}`, "");
  }
  if (record.kind === "function") {
    lines.push(`# Signature`, "", "```sql", `${record.title.replace(/\(\)$/, "")}(${f.signature})`, `RETURNS ${f.returns} LANGUAGE ${f.language}`, "```", "");
    if (f.triggers) {
      lines.push(`# Trigger attachments`, "", f.triggers.map((t) => `- \`${t}\``).join("\n"), "");
    }
  }
  if (record.kind === "bucket") {
    lines.push(`# Facts`, "", `- origin: ${f.origin}`);
    if (f.public !== undefined) lines.push(`- public: ${f.public}`);
    if (f.fileSizeLimit !== undefined) lines.push(`- file size limit: ${f.fileSizeLimit}`);
    if (f.allowedMimeTypes) lines.push(`- mime types: ${f.allowedMimeTypes.join(", ")}`);
    lines.push("");
  }
  if (record.refs.length) {
    lines.push(`# References`, "");
    for (const ref of record.refs) {
      const id = idOfRef.get(ref);
      if (id) lines.push(`- [${ref}](/${id}.json)`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Build the unified concept model
// ---------------------------------------------------------------------------
function buildConcepts() {
  const problems = [];

  // Derived layer: node id = bundle-relative path minus .json.
  const derivedRecords = [];
  const idOfRef = new Map(); // record id ("table:env/journeys") -> node id
  for (const path of walk(DERIVED, ".json")) {
    const record = JSON.parse(readFileSync(path, "utf8"));
    const nodeId = posixify(relative(BUNDLE, path)).replace(/\.json$/, "");
    derivedRecords.push({ record, nodeId });
    idOfRef.set(record.id, nodeId);
  }

  // Semantic layer.
  const semantic = [];
  for (const path of walk(SEMANTIC, ".md")) {
    const parsed = parseFrontmatter(readFileSync(path, "utf8"));
    if (!parsed) {
      problems.push(`${posixify(relative(REPO, path))}: missing frontmatter`);
      continue;
    }
    const nodeId = posixify(relative(BUNDLE, path)).replace(/\.md$/, "");
    semantic.push({ ...parsed, nodeId, path });
  }

  const concepts = [];
  for (const s of semantic) {
    const fm = s.frontmatter;
    concepts.push({
      id: s.nodeId,
      type: String(fm.type || "Unknown"),
      title: String(fm.title || s.nodeId),
      description: String(fm.description || ""),
      resource: String(fm.resource || ""),
      tags: (fm.tags || []).map(String),
      body: s.body,
      linksTo: extractLinks(s.body, dirname(s.path)),
    });
  }

  // Derived tags: inherited from the first semantic feature (title-sorted)
  // that links to the record; fallback = first URL path segment / namespace.
  const featureOf = new Map();
  const features = concepts.filter((c) => c.type === "Feature").sort((a, b) => (a.title < b.title ? -1 : 1));
  for (const f of features) {
    for (const target of f.linksTo) {
      if (!featureOf.has(target)) featureOf.set(target, f);
    }
  }
  // Derived records inherit ONE tag from their claiming feature — the first
  // tag that is a product area (viewer.nonAreaTags excludes tech/property
  // tags like react-flow, DIO-149); inheriting an excluded tag would strand
  // the node in "Other".
  const NON_AREA = new Set(CONFIG.viewer?.nonAreaTags ?? []);
  const inheritedTag = (feature) =>
    feature.tags.find((t) => !NON_AREA.has(t)) ?? feature.tags[0];
  const fallbackTag = (record) => {
    if (record.kind === "route") return record.id.split("/")[2] ?? "api";
    if (record.kind === "surface") return record.title.split("/").filter(Boolean)[0] ?? "root";
    if (record.facts.namespace) return record.facts.namespace;
    return record.kind;
  };

  // Two passes: modules last, so an unclaimed module can inherit its area
  // from what it references (a module whose refs are all journey routes and
  // tables belongs in Journeys — DIO-149; the old kind-fallback made "Module"
  // masquerade as a product area in the columns view). Majority of ref-target
  // areas wins; a true tie gets no tag and folds into "Other" in the viewer.
  // Modules only ref routes/tables/functions/buckets, never other modules, so
  // pass order is enough.
  const tagOfNode = new Map();
  const derivedConcept = ({ record, nodeId }, tags) => ({
    id: nodeId,
    type: KIND_DISPLAY[record.kind] ?? record.kind,
    title: record.title,
    description: record.description,
    resource: record.resource[0] ?? "",
    tags,
    body: synthesizeBody(record, idOfRef),
    linksTo: record.refs.map((r) => idOfRef.get(r)).filter(Boolean),
    auth: record.kind === "route" ? record.facts.auth : undefined,
  });
  for (const entry of derivedRecords.filter(({ record }) => record.kind !== "module")) {
    const feature = featureOf.get(entry.nodeId);
    const tags = feature ? [inheritedTag(feature)] : [fallbackTag(entry.record)];
    tagOfNode.set(entry.nodeId, tags[0]);
    concepts.push(derivedConcept(entry, tags));
  }
  for (const c of concepts) if (c.tags.length && !tagOfNode.has(c.id)) tagOfNode.set(c.id, c.tags[0]);
  for (const entry of derivedRecords.filter(({ record }) => record.kind === "module")) {
    const feature = featureOf.get(entry.nodeId);
    let tags;
    if (feature) {
      tags = [inheritedTag(feature)];
    } else {
      const counts = new Map();
      for (const ref of entry.record.refs) {
        const tag = tagOfNode.get(idOfRef.get(ref));
        if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      tags = best.length && (best.length === 1 || best[0][1] > best[1][1]) ? [best[0][0]] : [];
    }
    concepts.push(derivedConcept(entry, tags));
  }

  // Semantic links must resolve — a broken link is a render error, surfaced
  // by --check in CI.
  const ids = new Set(concepts.map((c) => c.id));
  for (const s of semantic) {
    const c = concepts.find((x) => x.id === s.nodeId);
    for (const target of c.linksTo) {
      if (!ids.has(target)) problems.push(`${s.nodeId}: broken link -> ${target}`);
    }
  }
  if (problems.length) {
    console.error(`Render blocked by ${problems.length} problem(s):\n` + problems.map((p) => `  ${p}`).join("\n"));
    process.exit(1);
  }

  return { concepts, features };
}

// ---------------------------------------------------------------------------
// Rendering 1: the graph (viz.html)
// ---------------------------------------------------------------------------
function buildGraph(concepts, docs) {
  const ids = new Set(concepts.map((c) => c.id));
  const nodes = concepts.map((c) => ({
    data: {
      id: c.id,
      label: c.title,
      type: c.type,
      description: c.description,
      resource: c.resource,
      tags: c.tags,
      ...(c.auth ? { auth: c.auth } : {}),
      color: TYPE_PALETTE[c.type] ?? DEFAULT_NODE_COLOR,
      size: 30 + Math.min(60, Math.floor(c.body.length / 200)),
    },
  }));
  const edges = [];
  const seen = new Set();
  for (const c of concepts) {
    for (const target of c.linksTo) {
      if (target === c.id || !ids.has(target)) continue;
      const key = `${c.id}__${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ data: { id: key, source: c.id, target } });
    }
  }
  const bodies = Object.fromEntries(concepts.map((c) => [c.id, c.body]));
  const types = [...new Set(concepts.map((c) => c.type))].sort();
  return {
    nodes,
    edges,
    bodies,
    types,
    palette: TYPE_PALETTE,
    repoBase: REPO_BASE,
    viewer: CONFIG.viewer ?? {},
    // Glossary + ADR corpus, embedded whole (ADR-0021): the hosted wiki's
    // audience has no checkout, so stores 1–2 ride along as read-only
    // projections. ~21KB + the ADRs, trivial next to the vendored libs.
    docs,
  };
}

// ---------------------------------------------------------------------------
// Rendering 2: the agent index (agent-index.md) — llms.txt-shaped, feature-first.
// Pointer order IS the curation: a feature's `resource` paths first, then its
// outbound links in document order, capped at 5.
// ---------------------------------------------------------------------------
function buildAgentIndex(concepts, features, adrs) {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  // Pointer descriptions: first sentence, capped — the full text lives on the
  // concept; the agent index is a router, and its ~2k-token budget is the
  // constraint that keeps it loadable whole.
  const brief = (desc, title) => {
    if (!desc || desc === title) return "";
    let d = desc.split(/(?<=\.)\s/)[0].trim();
    if (d.length > 110) d = d.slice(0, 107).trimEnd() + "…";
    return d;
  };
  const lines = [];
  lines.push(`# ${BUNDLE_NAME}`);
  lines.push("");
  lines.push(`> ${CONFIG.agentIndex?.summary ?? ""}`);
  lines.push("");
  lines.push(
    "Generated by `zdd-engine render` from the semantic map + codebase metadata — do not edit.",
    `Vocabulary: \`${PATHS.glossary}\`. Decisions: \`${PATHS.adrDir}/\`. Human index: \`${PATHS.humanIndex}\`.`,
  );
  lines.push("");

  for (const f of features) {
    lines.push(`## ${f.title}`);
    lines.push("");
    if (f.description) lines.push(f.description, "");
    // Hrefs are relative to this file (zdd/) so they resolve on GitHub; repo
    // resources climb out with ../.
    const pointers = [];
    if (f.resource) pointers.push({ label: f.resource, href: `../${f.resource}`, desc: "" });
    for (const target of f.linksTo) {
      if (pointers.length >= 5) break;
      const t = byId.get(target);
      if (!t) continue;
      const ext = target.startsWith("metadata/") ? ".json" : ".md";
      pointers.push({ label: t.title, href: `${target}${ext}`, desc: brief(t.description, t.title) });
    }
    for (const p of pointers.slice(0, 5)) {
      lines.push(`- [${p.label}](${p.href})${p.desc ? ` — ${p.desc}` : ""}`);
    }
    lines.push("");
  }

  const tail = (title, types) => {
    const items = concepts
      .filter((c) => types.includes(c.type))
      .sort((a, b) => (a.title < b.title ? -1 : 1));
    if (!items.length) return;
    lines.push(`## ${title}`);
    lines.push("");
    for (const s of items) {
      const d = brief(s.description, s.title);
      lines.push(`- [${s.title}](${s.id}.md)${d ? ` — ${d}` : ""}`);
    }
    lines.push("");
  };
  tail("External services", ["External Service"]);
  tail("Apps & packages", ["Application", "Package"]);

  lines.push("---");
  lines.push("");
  lines.push("Reading path: task → feature section above → its pointers → code. The codebase");
  lines.push(`metadata (\`${PATHS.metadataDir}/\`) is the mechanical inventory — regenerate with`);
  lines.push("`zdd-engine derive`; never edit.");
  lines.push("");
  // Bare ADR citations become links — hrefs are relative to the bundle folder
  // so they resolve on GitHub, like resource pointers.
  return linkifyAdrCitations(lines.join("\n"), adrs, (file) => `adr/${file}`);
}

// ---------------------------------------------------------------------------
const embed = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function render() {
  const { concepts, features } = buildConcepts();
  const docs = loadDocs();
  docs.changed = computeStoreChanges(docs.glossary);
  const graph = buildGraph(concepts, docs);
  const viewer = join(HERE, "viewer");
  const html = readFileSync(join(viewer, "viz.html"), "utf8")
    .replace("/*__CYTOSCAPE_JS__*/", () => readFileSync(join(viewer, "vendor", "cytoscape.min.js"), "utf8"))
    .replace("/*__MARKED_JS__*/", () => readFileSync(join(viewer, "vendor", "marked.min.js"), "utf8"))
    .replace("/*__VIZ_CSS__*/", () => readFileSync(join(viewer, "viz.css"), "utf8"))
    .replace("/*__VIZ_JS__*/", () => readFileSync(join(viewer, "viz.js"), "utf8"))
    .replace("__BUNDLE_TITLE__", () => escapeHtml(`${BUNDLE_NAME} Wiki`))
    .replace("__BUNDLE_NAME__", () => embed(BUNDLE_NAME))
    .replace("__BUNDLE_DATA__", () => embed(graph));
  const agentIndex = buildAgentIndex(concepts, features, docs.adrs);
  // ADR index (DIO-180, ADR-0035): the always-load-whole orientation summary of
  // the ADR corpus — one line per ADR, so full bodies are drill-in-when-cited.
  const adrIndex = buildAdrIndex(docs.adrs);
  // ~4 chars/token; the budget is a warning, not a gate — the fix is trimming
  // semantic link lists, which is a judgment call (spec §4).
  const approxTokens = Math.round(agentIndex.length / 4);
  if (approxTokens > 2000) {
    console.error(`WARNING: agent index ≈${approxTokens} tokens (budget ~2000) — trim semantic feature links`);
  }
  return { html, agentIndex, adrIndex, counts: { concepts: concepts.length, edges: graph.edges.length, features: features.length, adrs: docs.adrs.length } };
}

export function run(args) {
  const resolved = loadConfig(args);
  REPO = resolved.repoRoot;
  CONFIG = resolved.config;
  PATHS = resolved.paths;
  BUNDLE = resolved.bundleDir;
  SEMANTIC = resolve(REPO, PATHS.mapDir);
  DERIVED = resolve(REPO, PATHS.metadataDir);
  OUT_HTML = resolve(REPO, PATHS.humanIndex);
  OUT_INDEX = resolve(REPO, PATHS.agentIndex);
  OUT_ADR_INDEX = resolve(REPO, PATHS.adrIndex);
  BUNDLE_NAME = CONFIG.name ?? "Codebase";
  REPO_BASE = CONFIG.repoBase ?? "";
  BASE_BRANCH = resolved.baseBranch;

  const { html, agentIndex, adrIndex, counts } = render();
  const norm = (s) => s.replace(/\r\n/g, "\n");
  if (args.includes("--check")) {
  const stale = [];
  try {
    if (norm(readFileSync(OUT_HTML, "utf8")) !== norm(html)) stale.push("human-index.html");
  } catch {
    stale.push("human-index.html");
  }
  try {
    if (norm(readFileSync(OUT_INDEX, "utf8")) !== norm(agentIndex)) stale.push("agent-index.md");
  } catch {
    stale.push("agent-index.md");
  }
  try {
    if (norm(readFileSync(OUT_ADR_INDEX, "utf8")) !== norm(adrIndex)) stale.push("adr-index.md");
  } catch {
    stale.push("adr-index.md");
  }
  if (stale.length) {
    console.error(
      `${stale.join(" + ")} out of sync with semantic map + metadata inputs.\n` +
        "Run `zdd-engine render` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`renderings in sync (${counts.concepts} concepts, ${counts.edges} edges, ${counts.features} features)`);
  } else {
    writeFileSync(OUT_HTML, html);
    writeFileSync(OUT_INDEX, agentIndex);
    writeFileSync(OUT_ADR_INDEX, adrIndex);
    console.log(`Wrote ${counts.concepts} concepts, ${counts.edges} edges -> human-index.html; ${counts.features} feature sections -> agent-index.md; ${counts.adrs} ADRs -> adr-index.md`);
  }
}
