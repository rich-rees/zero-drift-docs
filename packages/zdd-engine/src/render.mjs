#!/usr/bin/env node
// ZDD renderer.
//
//   zdd-engine render           # write human-index.html + agent-index.md + adr-index.md + blessing-index.md
//   zdd-engine render --check   # exit 1 if any is stale
//
// Renders the semantic map + codebase metadata join into the machine products:
//   - graph        — the join itself as a viewer-neutral artifact (graph.json,
//                    schema zdd-graph/1): nodes = records + map concepts, edges
//                    = refs + map links, every node carrying its resource
//   - human index  — the graph rendered by a VIEWER picked from the registry
//                    (src/viewers/index.mjs) by config `viewer`
//   - agent index  — llms.txt-shaped, feature-first, budget ~2k tokens
//   - ADR index    — one orientation line per ADR
//   - blessing index — one line per blessing, by trigger question (CAS-96)
// Renderings carry no facts of their own and are never edited; if one looks
// wrong the fix is in a store, the derived layer, or this renderer.
// Deterministic: same inputs in, byte-identical outputs. Node stdlib only.
// The inputs include the git history OF THE STORE FILES ONLY (for the
// latest-change highlight) — never the wider history, so non-store commits
// cannot change the outputs. Repos that want no git dependency at all set
// config `render.storeChanges: false`.

import { readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, existsSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { insideRepo, repoRelative, agentIndexAreaDir } from "./lib/paths.mjs";
import { posix } from "node:path";
import { join, dirname, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { extractLinks as extractMapLinks } from "./lib/map-links.mjs";
import { changedTerms, parseNameStatus } from "./lib/store-changes.mjs";
import { refreshOriginBase } from "./lib/fetch-freshness.mjs";
import { buildAdrIndex } from "./lib/adr-index.mjs";
import { buildBlessingIndex } from "./lib/blessing-index.mjs";
import { slugify } from "./lib/slug.mjs";
import { loadConfig, resolveViewer, resolveNonAreaTags, validateRepoBase, absentStoreNotes } from "./lib/config.mjs";
import { loadViewer, DEFAULT_VIEWER } from "./viewers/index.mjs";

// Per-run state, set by run() from the adopter's config: repo root, artifact
// paths, the bundle folder node ids are relative to (the zdd/ folder), the
// display name, the GitHub base URL for source links, and the base branch.
let REPO, CONFIG, PATHS, BUNDLE, SEMANTIC, DERIVED, OUT_HTML, OUT_INDEX, OUT_ADR_INDEX, OUT_BLESSING_INDEX, OUT_GRAPH;
let BUNDLE_NAME, REPO_BASE, BASE_BRANCH, VIEWER, NON_AREA_TAGS, AGENT_INDEX;
const RECORDS_BY_NODE = new Map(); // node id -> the derived record behind a metadata concept

// Record kind -> the graph's display type. These names are the graph
// vocabulary viewers key on (lanes, palettes, legends); map concepts bring
// their own (`Feature`, `Application`, `External Service`, ...).
const KIND_DISPLAY = {
  route: "API Endpoint",
  table: "Table",
  surface: "UI Surface",
  function: "Database Function",
  bucket: "Storage Bucket",
  module: "Module",
  job: "Job",
  component: "UI Component",
  "external-service": "External Service",
  service: "External Service", // the pre-2.3 kind, while a config still says `services`
};

// Edge verbs (decision 0016) -> how a body and the agent index say them.
// An unknown verb is said as written.
const VERB_LABELS = {
  uses: "uses",
  usedBy: "used by",
  calls: "calls",
  subscribes: "subscribes to",
  reads: "reads",
  writes: "writes",
  dependsOn: "depends on",
  belongsTo: "belongs to",
};

const posixify = (p) => p.split(/[\\/]/).join("/");

// Symlinks are skipped, never followed (lstat): a checked-in link named
// `0001-x.md` pointing at a credentials file would otherwise be embedded in
// the hosted page as an ADR, and a directory link to `.` would recurse until
// the stack blew (CR-014 / CR-016). Symlinks inside an adopter's tree are
// theirs to have; they are just not documentation.
function walk(dir, ext, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, ext, out);
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

// Outputs are written through a real, in-repo parent and never onto a
// symlink: a symlinked graph.json (or a symlinked zdd/ directory) would carry
// the write anywhere the invoking user can reach (CR-015).
function safeOutputPath(path) {
  const parent = dirname(path);
  if (!existsSync(parent)) throw new Error(`output directory ${parent} does not exist`);
  const real = realpathSync(parent);
  insideRepo(realpathSync(REPO), real, `output directory ${parent}`);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`refusing to write through symlink ${path}`);
  return path;
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
// lstat that answers null for "nothing there" — existsSync alone is false for
// a dangling symlink, which is exactly the shape that must still be refused.
const lstatOrNull = (p) => {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
};
function loadDocs() {
  // A greenfield bundle may not have a glossary yet — render it as empty
  // rather than failing; the stores fill in as the mapping session runs.
  // When it does exist it must be a regular markdown file: the bytes go into
  // the hosted page verbatim, so `paths.glossary: ".env"` or a glossary.md
  // symlinked at a credentials file would publish it (CR-063). lstat, so a
  // link is seen as a link and never followed.
  const glossaryPath = resolve(REPO, PATHS.glossary);
  let glossary = "";
  const st = lstatOrNull(glossaryPath);
  if (st) {
    const why = st.isSymbolicLink() ? "not a symlink" : st.isDirectory() ? "not a directory" : "";
    if (st.isSymbolicLink() || !st.isFile() || !PATHS.glossary.endsWith(".md")) {
      console.error(`paths.glossary '${PATHS.glossary}' must be a regular .md file${why ? `, ${why}` : ""} — it is embedded verbatim in the human index`);
      process.exit(1);
    }
    glossary = normEol(readFileSync(glossaryPath, "utf8"));
  }
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

// Map-body links (bundle-absolute or relative, .md and .json) resolve to node
// ids by path arithmetic — lib/map-links.mjs, shared with lint and freshness.
const extractLinks = (body, docDir) => extractMapLinks(body, docDir, BUNDLE);

// ---------------------------------------------------------------------------
// Derived record -> synthesized markdown body (detail panel renders this via
// marked, exactly like a v1 hand-written body — but this one cannot drift).
// ---------------------------------------------------------------------------
function synthesizeBody(record, idOfRef) {
  const lines = [];
  if (record.description) lines.push(record.description, "");
  const f = record.facts;
  // Per-kind sections are feature-detected: a third-party extractor may emit
  // a `route` or `table` with its own facts shape (CR-014).
  if (record.kind === "route") {
    if (Array.isArray(f.methods)) lines.push(`# Methods`, "", f.methods.length ? f.methods.map((m) => `- \`${m}\``).join("\n") : "_(none exported)_", "");
    if (f.auth) lines.push(`# Auth`, "", f.auth, "");
  }
  if (record.kind === "table" && Array.isArray(f.columns)) {
    lines.push(`# Columns (${f.namespace})`, "", "| column | type |", "| --- | --- |");
    for (const c of f.columns) {
      lines.push(`| ${c.name}${c.references ? ` → ${c.references}` : ""} | ${c.type} |`);
    }
    lines.push("");
    if (f.renamedFrom) lines.push(`Renamed from: ${f.renamedFrom.join(", ")}`, "");
  }
  if (record.kind === "function" && f.signature !== undefined) {
    lines.push(`# Signature`, "", "```sql", `${record.title.replace(/\(\)$/, "")}(${f.signature})`, `RETURNS ${f.returns} LANGUAGE ${f.language}`, "```", "");
    if (Array.isArray(f.triggers)) {
      lines.push(`# Trigger attachments`, "", f.triggers.map((t) => `- \`${t}\``).join("\n"), "");
    }
  }
  if (record.kind === "bucket" && f.origin !== undefined) {
    lines.push(`# Facts`, "", `- origin: ${f.origin}`);
    if (f.public !== undefined) lines.push(`- public: ${f.public}`);
    if (f.fileSizeLimit !== undefined) lines.push(`- file size limit: ${f.fileSizeLimit}`);
    if (f.allowedMimeTypes) lines.push(`- mime types: ${f.allowedMimeTypes.join(", ")}`);
    lines.push("");
  }
  if (record.refs.length) {
    lines.push(`# References`, "");
    // A typed edge (decision 0016) says its verb; a plain ref says nothing,
    // exactly as before, so a record without edges renders the same bytes.
    const verbOf = new Map();
    for (const [verb, ids] of Object.entries(f.edges ?? {})) for (const id of ids) if (!verbOf.has(id)) verbOf.set(id, verb);
    for (const ref of record.refs) {
      const id = idOfRef.get(ref);
      if (!id) continue;
      const verb = verbOf.get(ref);
      lines.push(verb ? `- ${VERB_LABELS[verb] ?? verb} [${ref}](/${id}.json)` : `- [${ref}](/${id}.json)`);
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
    // A concept's resource is a repo path that viewers turn into a link —
    // `javascript:…` or an absolute path is refused here, once, so no
    // viewer has to know (CR-002).
    if (parsed.frontmatter.resource) {
      try {
        repoRelative(String(parsed.frontmatter.resource), `${nodeId}: resource`);
      } catch (e) {
        problems.push(e.message);
      }
    }
    semantic.push({ ...parsed, nodeId, path });
  }

  const concepts = [];
  for (const s of semantic) {
    const fm = s.frontmatter;
    concepts.push({
      id: s.nodeId,
      layer: "map",
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
  // Top-level config, resolved in run(): the tag lands in graph.json, so it
  // must not depend on which viewer is selected (CR-003).
  const NON_AREA = new Set(NON_AREA_TAGS);
  const inheritedTag = (feature) =>
    feature.tags.find((t) => !NON_AREA.has(t)) ?? feature.tags[0];
  // Unclaimed routes bucket by URL path — the first static segment after
  // whatever leading segments EVERY route in the bundle shares (a Next.js
  // `/api`, a FastAPI `/v1`, or nothing). Stack-neutral by construction: no
  // framework's prefix is named here (DIO-310; the old rule assumed
  // `/api/<area>`). Two guards keep the area an area (CR-004): the shared
  // prefix never eats the shortest route whole, so `/jobs` + `/jobs/{id}`
  // both bucket as `jobs`; and a dynamic segment (`{id}`, `[id]`, `*`) is
  // never the answer — the nearest static segment before it is.
  const isDynamic = (s) => /^[\[{]/.test(s) || s === "*";
  const routeSegs = derivedRecords
    .filter(({ record }) => record.kind === "route")
    .map(({ record }) => record.id.replace(/^route:/, "").split("/").filter(Boolean));
  let commonRoute = routeSegs.length ? [...routeSegs[0]] : [];
  for (const segs of routeSegs) {
    let i = 0;
    while (i < commonRoute.length && i < segs.length && commonRoute[i] === segs[i]) i++;
    commonRoute = commonRoute.slice(0, i);
  }
  const shortest = Math.min(...routeSegs.map((s) => s.length), Infinity);
  if (commonRoute.length >= shortest) commonRoute = commonRoute.slice(0, Math.max(0, shortest - 1));
  const routeArea = (record) => {
    const segs = record.id.replace(/^route:/, "").split("/").filter(Boolean);
    const own = segs.slice(commonRoute.length);
    const first = own.find((s) => !isDynamic(s)) ?? [...segs].reverse().find((s) => !isDynamic(s));
    return first ?? "root";
  };
  const fallbackTag = (record) => {
    if (record.kind === "route") return routeArea(record);
    if (record.kind === "surface") return record.title.replace(/\s\([^)]*\)$/, "").split("/").filter(Boolean)[0] ?? "root";
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
  const derivedConcept = ({ record, nodeId }, tags) => (RECORDS_BY_NODE.set(nodeId, record), {
    id: nodeId,
    layer: "metadata",
    recordId: record.id,
    type: KIND_DISPLAY[record.kind] ?? record.kind,
    title: record.title,
    description: record.description,
    resource: record.resource[0] ?? "",
    tags,
    body: synthesizeBody(record, idOfRef),
    linksTo: record.refs.map((r) => idOfRef.get(r)).filter(Boolean),
    auth: record.kind === "route" ? record.facts.auth : undefined,
    // target node id -> verb (decision 0016); absent when the record has none.
    verbs: record.facts.edges ? new Map(Object.entries(record.facts.edges).flatMap(([verb, ids]) => ids.map((r) => [idOfRef.get(r), verb]).filter(([id]) => id))) : undefined,
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

  // App membership (decision 0018): a code record belongs to the Application
  // page whose `resource` path is the longest prefix of the record's primary
  // resource. A `belongsTo` edge and an `app` field on the node carry it; a
  // record under no app page (a shared package) belongs to no app and is
  // reached through its inbound edges. Nothing is guessed: an Application
  // page without a resource, or two whose paths nest, is a warning, and the
  // records under them stay unassigned.
  const apps = concepts.filter((c) => c.type === "Application");
  const appWarnings = [];
  for (const a of apps) if (!a.resource) appWarnings.push(`${a.id}: Application page has no resource path — no record can belong to it`);
  const appPaths = apps.filter((a) => a.resource).map((a) => ({ id: a.id, path: a.resource.replace(/\/+$/, "") }));
  const nested = new Set();
  for (const x of appPaths) for (const y of appPaths) if (x !== y && (x.path === y.path || x.path.startsWith(`${y.path}/`))) nested.add(x.id).add(y.id);
  for (const id of [...nested].sort()) appWarnings.push(`${id}: Application pages' resource paths nest or coincide — records under them are not assigned to any app`);
  const usable = appPaths.filter((a) => !nested.has(a.id)).sort((x, y) => y.path.length - x.path.length || (x.id < y.id ? -1 : 1));
  for (const c of concepts) {
    if (c.layer !== "metadata" || !c.resource) continue;
    const app = usable.find((a) => c.resource === a.path || c.resource.startsWith(`${a.path}/`));
    if (!app) continue;
    c.app = app.id;
    if (!c.linksTo.includes(app.id)) c.linksTo.push(app.id);
    (c.verbs ??= new Map()).set(app.id, "belongsTo");
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

  return { concepts, features, appWarnings };
}

// ---------------------------------------------------------------------------
// Rendering 1: the graph artifact (graph.json, schema zdd-graph/1).
// Viewer-neutral on purpose: no colours, sizes, layouts or embedded docs —
// those are a viewer's business (src/viewers/). Node ids are bundle-relative
// paths minus extension, so a node links back to the file it was built from;
// `resource` links it to the source. Edges are deduped and self-refs dropped.
// An edge carries `verb` when the record typed it (decision 0016); a graph
// with no verbs is still zdd-graph/1 and viewers treat a missing verb as plain.
// ---------------------------------------------------------------------------
function buildGraph(concepts) {
  const ids = new Set(concepts.map((c) => c.id));
  const nodes = concepts.map((c) => ({
    id: c.id,
    layer: c.layer,
    ...(c.recordId ? { recordId: c.recordId } : {}),
    type: c.type,
    title: c.title,
    description: c.description,
    resource: c.resource,
    tags: c.tags,
    ...(c.auth ? { auth: c.auth } : {}),
    ...(c.app ? { app: c.app } : {}),
    body: c.body,
  }));
  const edges = [];
  // Dedupe on the (source, target) pair itself — a joined-string key would
  // let two distinct edges collide on ids that happen to contain the joiner,
  // which bundle paths can (CR-005).
  const seen = new Map();
  for (const c of concepts) {
    for (const target of c.linksTo) {
      if (target === c.id || !ids.has(target)) continue;
      if (!seen.has(c.id)) seen.set(c.id, new Set());
      if (seen.get(c.id).has(target)) continue;
      seen.get(c.id).add(target);
      const verb = c.verbs?.get(target);
      edges.push(verb ? { source: c.id, target, verb } : { source: c.id, target });
    }
  }
  return { schema: "zdd-graph/1", name: BUNDLE_NAME, repoBase: REPO_BASE, nodes, edges };
}

// ---------------------------------------------------------------------------
// Rendering 2: the agent index (agent-index.md) — llms.txt-shaped, feature-first.
// Pointer order IS the curation: a feature's `resource` paths first, then its
// outbound links in document order, capped at 5.
// ---------------------------------------------------------------------------
// `levels` (config agentIndex.levels, CAS-103 pick 5): 1 (default) lists
// every feature section in the one file; 2 lists the AREAS first — one line
// per area with its features' names and a link to `<agent-index>/<area>.md`,
// which holds that area's feature sections — so a large repo's index stays
// within budget and every feature is one hop away. An area is a feature's
// first tag that is not a nonAreaTag; an untagged feature is "Other". The
// bytes at one level are exactly the pre-2.3 bytes.
function buildAgentIndex(concepts, features, adrs, { levels = 1, areaDir = "", recordOf = null } = {}) {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const NON_AREA = new Set(NON_AREA_TAGS);
  const areaOf = (f) => (Array.isArray(f.tags) ? f.tags.find((t) => !NON_AREA.has(t)) : undefined) ?? "Other";
  // A concept's file: a metadata record is JSON, a map page is markdown —
  // the External services list linked a service record as `.md` (CAS-99).
  // Read from the concept's layer, never its path: `paths.metadataDir` moves
  // the folder (CR-005).
  const hrefOf = (id) => `${id}${byId.get(id)?.layer === "metadata" ? ".json" : ".md"}`;
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
  // The summary blockquote is omitted when there is no summary: `> ` with a
  // trailing space fails `git diff --check` in adopters' CI (CR-118).
  const summary = CONFIG.agentIndex?.summary ?? "";
  if (summary.trim()) lines.push(`> ${summary}`, "");
  lines.push(
    "Generated by `zdd-engine render` from the semantic map + codebase metadata — do not edit.",
    `Vocabulary: \`${PATHS.glossary}\`. Decisions: \`${PATHS.adrDir}/\`. Human index: \`${PATHS.humanIndex}\`.`,
  );
  lines.push("");

  // One feature's section. `up` is the path from the file being written to
  // the bundle folder: "" for the index itself, "../" for an area file.
  const featureSection = (f, up) => {
    const out = [`## ${f.title}`, ""];
    if (f.description) out.push(f.description, "");
    // Hrefs are relative to this file (zdd/) so they resolve on GitHub; repo
    // resources climb out with ../.
    const pointers = [];
    if (f.resource) pointers.push({ label: f.resource, href: `${up}../${f.resource}`, desc: "" });
    for (const target of f.linksTo) {
      if (pointers.length >= 5) break;
      const t = byId.get(target);
      if (!t) continue;
      pointers.push({ label: t.title, href: `${up}${hrefOf(target)}`, desc: brief(t.description, t.title) });
    }
    for (const p of pointers.slice(0, 5)) {
      out.push(`- [${p.label}](${p.href})${p.desc ? ` — ${p.desc}` : ""}`);
    }
    out.push("");
    return out;
  };
  const areaFiles = new Map(); // slug -> text
  if (levels === 2) {
    const groups = new Map();
    for (const f of features) {
      const area = areaOf(f);
      if (!groups.has(area)) groups.set(area, []);
      groups.get(area).push(f);
    }
    const areas = [...groups.keys()].sort((a, b) => (a === "Other" ? 1 : b === "Other" ? -1 : a < b ? -1 : 1));
    // An area's file name: lower-case letters, digits and dashes only, so it
    // is the same name on every filesystem. Two areas that fold to one name
    // (`Foo Bar` and `foo-bar`) are an error naming both, never a silent
    // overwrite (CR-504).
    const slugOf = (area) => area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "area";
    const bySlug = new Map();
    for (const area of areas) {
      const slug = slugOf(area);
      if (bySlug.has(slug)) throw new Error(`agentIndex.levels 2: the areas '${bySlug.get(slug)}' and '${area}' would both be written as ${areaDir}/${slug}.md — rename one tag (tags are area names)`);
      bySlug.set(slug, area);
    }
    // ADR links from an area file climb to paths.adrDir wherever it is (CR-505).
    const areaDirRel = agentIndexAreaDir(PATHS.agentIndex);
    const adrFromArea = posix.relative(areaDirRel, PATHS.adrDir) || ".";
    lines.push("## Areas", "");
    for (const area of areas) {
      const fs = groups.get(area);
      const slug = slugOf(area);
      const names = fs.map((f) => f.title);
      const shown = names.length > 8 ? `${names.slice(0, 8).join(", ")}, …` : names.join(", ");
      lines.push(`- [${area}](${areaDir}/${slug}.md) — ${fs.length} feature${fs.length === 1 ? "" : "s"}: ${shown}`);
      const body = [`# ${BUNDLE_NAME} — ${area}`, "", `One area of [the agent index](../${PATHS.agentIndex.split("/").pop()}). ${AREA_FILE_MARK}`, ""];
      for (const f of fs) body.push(...featureSection(f, "../"));
      areaFiles.set(slug, linkifyAdrCitations(body.join("\n"), adrs, (file) => `${adrFromArea}/${file}`));
    }
    lines.push("");
  } else {
    for (const f of features) lines.push(...featureSection(f, ""));
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
      lines.push(`- [${s.title}](${hrefOf(s.id)})${d ? ` — ${d}` : ""}`);
    }
    lines.push("");
  };
  tail("External services", ["External Service"]);
  // Background work (CAS-103 pick 6): everything that runs without a user
  // clicking — each with its trigger and what it hits. Repo housekeeping
  // (GitHub Actions schedules, an opt-in) is listed apart: it is the repo's
  // upkeep, not the app.
  const jobs = concepts.filter((c) => c.type === "Job").sort((a, b) => (a.title < b.title ? -1 : 1));
  const jobRecords = new Map(jobs.map((c) => [c.id, (recordOf ? recordOf(c) : null) ?? {}]));
  const describeJob = (c) => {
    const f = jobRecords.get(c.id)?.facts ?? {};
    const trigger = f.schedule ? `cron \`${f.schedule}\`` : f.queue ? `queue \`${f.queue}\`` : f.trigger ?? f.mode ?? "";
    const hits = f.target ?? (f.queue ? (f.consumers?.[0] ?? "") : c.resource ?? "");
    return `${trigger}${hits ? ` → ${hits}` : ""}`;
  };
  const housekeeping = jobs.filter((c) => jobRecords.get(c.id)?.facts?.housekeeping === true);
  const app = jobs.filter((c) => !housekeeping.includes(c));
  for (const [title, list] of [["Background work", app], ["Repo housekeeping", housekeeping]]) {
    if (!list.length) continue;
    lines.push(`## ${title}`, "");
    for (const c of list) lines.push(`- [${c.title}](${hrefOf(c.id)}) — ${describeJob(c)}`);
    lines.push("");
  }
  tail("Apps & packages", ["Application", "Package"]);

  lines.push("---");
  lines.push("");
  lines.push("Reading path: task → feature section above → its pointers → code. Before building,");
  lines.push(`choose patterns: \`${PATHS.blessingIndex}\` lists every blessing by its trigger question.`);
  lines.push(`The codebase metadata (\`${PATHS.metadataDir}/\`) is the mechanical inventory — regenerate`);
  lines.push("with `zdd-engine derive`; never edit.");
  lines.push("");
  // Bare ADR citations become links — hrefs are relative to the bundle folder
  // so they resolve on GitHub, like resource pointers.
  const text = linkifyAdrCitations(lines.join("\n"), adrs, (file) => `adr/${file}`);
  return levels === 2 ? { text, areaFiles } : text;
}
// The index's area folder (lib/paths.mjs, so the layout check sees it too).
export { agentIndexAreaDir };
// Every area file says so in its header; only a file that says so is ZDD's
// to prune (CR-501). Anything else in the folder is the adopter's.
const AREA_FILE_MARK = "Generated by `zdd-engine render` — do not edit.";
// agentIndex.levels and agentIndex.budgetTokens (CAS-103 pick 5): explicit
// settings, never guessed — the index's shape changes only when the config
// says so, so `render --check` never moves without a visible cause.
export function resolveAgentIndexOptions(config) {
  const a = config.agentIndex;
  if (a === undefined) return { levels: 1, budget: 2000 };
  if (!a || typeof a !== "object" || Array.isArray(a)) return { error: "'agentIndex' must be an object" };
  const levels = a.levels === undefined ? 1 : a.levels;
  if (levels !== 1 && levels !== 2) return { error: "'agentIndex.levels' must be 1 (every feature in one file) or 2 (areas first, then one file per area)" };
  const budget = a.budgetTokens === undefined ? 2000 : a.budgetTokens;
  if (!Number.isInteger(budget) || budget < 200) return { error: "'agentIndex.budgetTokens' must be a whole number of at least 200 (the default is 2000)" };
  return { levels, budget };
}

// ---------------------------------------------------------------------------
async function render() {
  const { concepts, features, appWarnings } = buildConcepts();
  for (const w of appWarnings) console.error(`WARNING: ${w}`);
  const docs = loadDocs();
  const changed = computeStoreChanges(docs.glossary);
  const graph = buildGraph(concepts);
  const viewer = await loadViewer(VIEWER.name);
  // The viewer gets the resolved nonAreaTags alongside its own options: its
  // area model must exclude the same tags the graph's inheritance did, and
  // the top-level key is otherwise invisible to it (verification CR-026).
  // Only added when set, so a config without it keeps the v0.3.1 bytes.
  const options = NON_AREA_TAGS.length ? { ...VIEWER.options, nonAreaTags: NON_AREA_TAGS } : VIEWER.options;
  const html = viewer.render({ graph, docs, changed, options, bundleName: BUNDLE_NAME, repoBase: REPO_BASE });
  if (typeof html !== "string") {
    console.error(`Viewer '${VIEWER.name}' must return the human index as a string`);
    process.exit(1);
  }
  const graphJson = JSON.stringify(graph, null, 2) + "\n";
  const built = buildAgentIndex(concepts, features, docs.adrs, { levels: AGENT_INDEX.levels, areaDir: agentIndexAreaDir(PATHS.agentIndex).split("/").pop(), recordOf: (c) => RECORDS_BY_NODE.get(c.id) ?? null });
  const agentIndex = typeof built === "string" ? built : built.text;
  const areaFiles = typeof built === "string" ? new Map() : built.areaFiles;
  // ADR index (DIO-180, ADR-0035): the always-load-whole orientation summary of
  // the ADR corpus — one line per ADR, so full bodies are drill-in-when-cited.
  const adrIndex = buildAdrIndex(docs.adrs);
  // Blessing index (CAS-96): read whole when choosing patterns. Hrefs are
  // relative to the bundle folder, like the agent index's.
  const adrFile = new Map(docs.adrs.map((a) => [a.num, a.file]));
  const { text: blessingIndex, count: blessings } = buildBlessingIndex(concepts.filter((c) => c.layer === "map"), (num) => (adrFile.has(num) ? `adr/${adrFile.get(num)}` : null));
  // ~4 chars/token; the budget is a warning, not a gate — the fix is trimming
  // semantic link lists, which is a judgment call (spec §4).
  const approxTokens = Math.round(agentIndex.length / 4);
  if (approxTokens > AGENT_INDEX.budget) {
    const fix = AGENT_INDEX.levels === 2 ? "trim the features' pointer lists, or raise agentIndex.budgetTokens in zdd/config.json" : 'raise agentIndex.budgetTokens in zdd/config.json, set agentIndex.levels to 2 (areas first, then one file per area, each feature one hop away), or link each feature\'s entry points only';
    console.error(`WARNING: agent index ≈${approxTokens} tokens (budget ${AGENT_INDEX.budget}) — ${fix}`);
  }
  return { html, graphJson, agentIndex, areaFiles, adrIndex, blessingIndex, counts: { blessings, concepts: concepts.length, edges: graph.edges.length, features: features.length, adrs: docs.adrs.length } };
}

export async function run(args) {
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
  OUT_BLESSING_INDEX = resolve(REPO, PATHS.blessingIndex);
  OUT_GRAPH = resolve(REPO, PATHS.graph);
  BUNDLE_NAME = CONFIG.name ?? "Codebase";
  REPO_BASE = CONFIG.repoBase ?? "";
  BASE_BRANCH = resolved.baseBranch;
  VIEWER = resolveViewer(CONFIG, DEFAULT_VIEWER);
  if (VIEWER.error) {
    console.error(VIEWER.error);
    process.exit(1);
  }
  const baseError = validateRepoBase(CONFIG.repoBase);
  if (baseError) {
    console.error(baseError);
    process.exit(1);
  }
  const nonArea = resolveNonAreaTags(CONFIG, VIEWER.options);
  if (nonArea.error) {
    console.error(nonArea.error);
    process.exit(1);
  }
  NON_AREA_TAGS = nonArea.tags;
  for (const d of nonArea.diagnostics) console.error(d);
  AGENT_INDEX = resolveAgentIndexOptions(CONFIG);
  if (AGENT_INDEX.error) {
    console.error(AGENT_INDEX.error);
    process.exit(1);
  }
  // A missing store dir renders as empty; name it when the bundle is
  // otherwise populated, so a typo is not mistaken for greenfield (CR-068/099).
  for (const note of absentStoreNotes(REPO, PATHS, ["adrDir", "mapDir", "metadataDir"])) console.error(note);
  // Refuse an unknown viewer before any store is read: the error names the
  // registry so the fix is a config edit, not a source dig.
  try {
    await loadViewer(VIEWER.name);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  let rendered;
  try {
    rendered = await render();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { html, graphJson, agentIndex, areaFiles, adrIndex, blessingIndex, counts } = rendered;
  const norm = (s) => s.replace(/\r\n/g, "\n");
  const outputs = [
    ["graph.json", OUT_GRAPH, graphJson],
    ["human-index.html", OUT_HTML, html],
    ["agent-index.md", OUT_INDEX, agentIndex],
    ["adr-index.md", OUT_ADR_INDEX, adrIndex],
    ["blessing-index.md", OUT_BLESSING_INDEX, blessingIndex],
  ];
  // The area files (agentIndex.levels 2) live in a sibling folder of the
  // index; a file there that this render did not produce is stale, so the
  // folder is checked and pruned whole, like derive's metadata folder.
  const areaDirAbs = resolve(REPO, agentIndexAreaDir(PATHS.agentIndex));
  const areaLabel = `${agentIndexAreaDir(PATHS.agentIndex).split("/").pop()}/`;
  for (const [slug, text] of [...areaFiles].sort(([a], [b]) => (a < b ? -1 : 1))) outputs.push([`${areaLabel}${slug}.md`, join(areaDirAbs, `${slug}.md`), text]);
  // What the folder holds that this render did not produce, split into
  // ZDD's own (an area that no longer exists: stale, pruned) and the
  // adopter's (no generated header: never touched; at two levels the folder
  // must be ZDD's alone, so render refuses) — CR-501. A folder that is not a
  // real directory (a file, a symlink) is refused outright (CR-503, CR-526).
  const areaDirState = () => {
    let st;
    try {
      st = lstatSync(areaDirAbs);
    } catch {
      return { stale: [], foreign: [], missing: true };
    }
    if (st.isSymbolicLink()) throw new Error(`${areaLabel} (${areaDirAbs}) is a symlink — the agent index's area folder must be a real folder inside the repo`);
    if (!st.isDirectory()) throw new Error(`${areaLabel} (${areaDirAbs}) is not a folder — the agent index's area folder takes the index's name; rename paths.agentIndex or remove the file`);
    const produced = new Set([...areaFiles.keys()].map((s) => `${s}.md`));
    const stale = [];
    const foreign = [];
    for (const f of readdirSync(areaDirAbs).sort()) {
      if (!f.endsWith(".md") || produced.has(f)) continue;
      let head = "";
      try {
        head = readFileSync(join(areaDirAbs, f), "utf8").slice(0, 600);
      } catch {
        /* unreadable: not ours to touch */
      }
      (head.includes(AREA_FILE_MARK) ? stale : foreign).push(f);
    }
    return { stale, foreign, missing: false };
  };
  const areaExtras = () => {
    const { stale, foreign } = areaDirState();
    if (foreign.length && areaFiles.size) {
      throw new Error(`${areaLabel} holds ${foreign.length === 1 ? "a file" : "files"} that ZDD did not write (${foreign.join(", ")}) — agentIndex.levels 2 writes one file per area there and prunes the folder, so it must be ZDD's alone; move ${foreign.length === 1 ? "it" : "them"} or set paths.agentIndex to a name whose folder is free`);
    }
    return stale;
  };
  if (args.includes("--check")) {
    const stale = [];
    for (const [label, path, content] of outputs) {
      try {
        if (norm(readFileSync(path, "utf8")) !== norm(content)) stale.push(label);
      } catch {
        stale.push(label);
      }
    }
    let extras;
    try {
      extras = areaExtras();
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    for (const extra of extras) stale.push(`${areaLabel}${extra} (stale: no such area)`);
    if (stale.length) {
      console.error(
        `${stale.join(" + ")} out of sync with semantic map + metadata inputs.\n` +
          "Run `zdd-engine render` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`renderings in sync (${counts.concepts} concepts, ${counts.edges} edges, ${counts.features} features, viewer ${VIEWER.name})`);
  } else {
    // Stage every output to a sibling temp file, then rename all five: a
    // failure part-way (disk, permissions, a parent that turns out to be a
    // file) leaves the previous generation intact and no half-written
    // artifact behind (CR-098). rename over an existing file is atomic on
    // POSIX and a replace on Windows.
    const staged = [];
    try {
      // The area folder is judged before it is made (CR-526): its parent
      // real and in the repo, itself no symlink, nothing foreign inside.
      const extras = areaExtras();
      if (areaFiles.size) {
        safeOutputPath(areaDirAbs);
        mkdirSync(areaDirAbs, { recursive: true });
      }
      for (const [, path] of outputs) safeOutputPath(path);
      for (const [label, path, content] of outputs) {
        const tmp = `${path}.${process.pid}.tmp`;
        try {
          writeFileSync(tmp, content);
        } catch (e) {
          throw new Error(`could not write ${label} (${path}): ${e.message}`);
        }
        staged.push([tmp, path]);
      }
      // Ceiling: five renames are not one transaction — a crash between them
      // leaves a mixed generation, which the next `render --check` reports as stale.
      for (const [tmp, path] of staged) renameSync(tmp, path);
      // Stale area files (ZDD's own, for areas that no longer exist) go; a
      // folder left empty (levels back to 1) goes too. The adopter's files
      // are never touched.
      for (const extra of extras) rmSync(join(areaDirAbs, extra), { force: true });
      if (existsSync(areaDirAbs) && !readdirSync(areaDirAbs).length) rmSync(areaDirAbs, { recursive: true, force: true });
    } catch (e) {
      for (const [tmp] of staged) rmSync(tmp, { force: true });
      console.error(e.message);
      process.exit(1);
    }
    const sections = areaFiles.size ? `${counts.features} feature sections -> ${areaFiles.size} area files under ${areaLabel} (areas listed in agent-index.md)` : `${counts.features} feature sections -> agent-index.md`;
    console.log(`Wrote ${counts.concepts} concepts, ${counts.edges} edges -> graph.json + human-index.html (viewer ${VIEWER.name}); ${sections}; ${counts.adrs} ADRs -> adr-index.md; ${counts.blessings} blessings -> blessing-index.md`);
  }
}
