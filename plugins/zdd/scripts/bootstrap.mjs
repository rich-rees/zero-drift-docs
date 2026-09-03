#!/usr/bin/env node
// The bootstrap runbook's deterministic half. The `bootstrap` skill is the
// conversation — it asks the questions — and this script is the only thing
// that reads the adopter's stack and writes into the adopter's repo. Splitting
// it this way is what makes the runbook testable at the file seam: drive the
// script with a scripted answer set against a fixture repo and assert what
// landed on disk, no LLM in the loop.
//
//   bootstrap.mjs detect  [--root=<dir>] [--home=<dir>] [--json]
//       Scan for each extractor's convention. Prints a proposal — extractor
//       set + options, with the EVIDENCE for each — or "greenfield" when there
//       is no source to read. Also reports whether the mattpocock-skills
//       plugin is installed (the recommendation step). Writes nothing.
//
//   bootstrap.mjs apply --answers=<file.json> [--root=<dir>] [--date=YYYY-MM-DD] [--json]
//       Write the setup from an answer set (shape below). Idempotent: an
//       artifact that already exists is KEPT, never overwritten — curated
//       content is the adopter's, and a second run only fills gaps.
//
//   bootstrap.mjs upgrade [--root=<dir>] [--json]
//       The only later writer into an adopter's repo. Migrates `adapter` →
//       `extractors`, moves `viewer.nonAreaTags` to the top level, rewrites
//       every plugin-owned file (engine pins, hook, snippet blocks) to this
//       plugin's version, and names every file it changed. Never touches a
//       curated artifact.
//
// Answer set (every key optional unless noted):
//   {
//     "name": "My App", "repoBase": "https://github.com/o/r/tree/main/", "baseBranch": "main",
//     "extractors": ["supabase", "fastapi"],          // else derived from `stack`, else the detection
//     "extractorOptions": { ... },                     // else defaults per extractor
//     "stack": ["FastAPI", "Supabase", "React web", "Expo"],   // greenfield answers; strings or {name, path}
//     "apps": ["Web", "Mobile"],                       // map skeleton (Application concepts); else from `stack`
//     "optIns": { "autoLoad": true, "fence": true, "ci": true, "prePush": true },   // defaults: all on
//     "codex": false,                                  // also write AGENTS.md
//     "seedAdr": true                                  // ADR-0001 "Adopt Zero-Drift Docs"
//   }

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  chmodSync,
} from "node:fs";
import { join, dirname, basename, relative } from "node:path";
import { execFileSync } from "node:child_process";
import {
  PLUGIN_ROOT,
  ENGINE_PACKAGE,
  DEFAULT_PATHS,
  pluginVersion,
  parseArgs,
  adopterRoot,
  readJson,
  loadConfig,
  artifactPaths,
  findPocock,
  posixify,
} from "./lib/repo.mjs";

const TEMPLATES = join(PLUGIN_ROOT, "templates");
const SNIPPET_BEGIN = "<!-- zdd:begin";
const SNIPPET_END = "<!-- zdd:end -->";
const LEGACY_SNIPPET_HEADING = "## Documentation — Zero-Drift Docs (ZDD)";
const MANAGED_MARK = "Managed by zdd";
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".venv", "venv", "__pycache__", ".expo", "zdd"]);

// Mirror of the engine's LEGACY_ADAPTERS (src/lib/config.mjs): the one legacy
// adapter and how its options split. The engine expands it at derive time;
// this is the migration that makes the expansion unnecessary.
const LEGACY_ADAPTERS = {
  "nextjs-supabase": {
    extractors: ["supabase", "nextjs"],
    split(options = {}) {
      const { migrationNamespaces = [], externalBuckets = [], ...nextjs } = options;
      return { supabase: { migrationNamespaces, externalBuckets }, nextjs };
    },
  },
};

// ---------------------------------------------------------------------------
// Detection — one probe per extractor convention, each returning the evidence
// it found and the options that evidence implies. Purely file-shaped and
// sorted, so the proposal is the same for the same tree.
// ---------------------------------------------------------------------------
function walk(root, onFile, maxDepth = 6) {
  const rec = (dir, depth) => {
    if (depth > maxDepth) return;
    let names;
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith(".")) rec(p, depth + 1);
      } else onFile(p, name, posixify(relative(root, p)));
    }
  };
  rec(root, 0);
}

function readPackageJson(root) {
  const p = join(root, "package.json");
  if (!existsSync(p)) return null;
  try {
    return readJson(p);
  } catch {
    return null;
  }
}

export function detect(root) {
  const sqlDirs = new Map(); // dir -> count
  const pyRouters = new Map(); // dir -> { routers, apps }
  const pyRoots = new Set();
  let appDir = null;
  let middlewarePath = null;
  let sourceFiles = 0;

  walk(root, (abs, name, rel) => {
    if (/\.(ts|tsx|js|jsx|py|sql|go|rb|rs|java|cs)$/.test(name)) sourceFiles++;
    if (name.endsWith(".sql") && /(^|\/)migrations\//.test(rel + "/")) {
      const dir = posixify(dirname(rel));
      sqlDirs.set(dir, (sqlDirs.get(dir) ?? 0) + 1);
    }
    if (name.endsWith(".py")) {
      let text = "";
      try {
        text = readFileSync(abs, "utf8");
      } catch {
        return;
      }
      const routers = /\bAPIRouter\s*\(/.test(text);
      const app = /\bFastAPI\s*\(/.test(text);
      if (routers || app) {
        const dir = posixify(dirname(rel));
        const cur = pyRouters.get(dir) ?? { routers: 0, apps: 0 };
        if (routers) cur.routers++;
        if (app) cur.apps++;
        pyRouters.set(dir, cur);
        // The scan root is the top-level file or the first path segment.
        pyRoots.add(dir === "." ? rel : rel.split("/")[0]);
      }
    }
    if (/^(page|route|layout)\.(tsx|ts|jsx|js)$/.test(name)) {
      const m = /^(.*?(?:^|\/)app)(\/|$)/.exec(posixify(dirname(rel)) + "/");
      if (m && (!appDir || m[1].length < appDir.length)) appDir = m[1];
    }
    if (/^middleware\.(ts|js)$/.test(name) && rel.split("/").length <= 2) middlewarePath = rel;
  });

  const pkg = readPackageJson(root);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const proposals = [];

  if (sqlDirs.size) {
    const dirs = [...sqlDirs.keys()].sort();
    proposals.push({
      name: "supabase",
      evidence: dirs.map((d) => `SQL migrations under \`${d}\` (${sqlDirs.get(d)} file${sqlDirs.get(d) === 1 ? "" : "s"})`),
      options: {
        migrationNamespaces: dirs.map((d, i) => ({ name: dirs.length === 1 ? "db" : basename(dirname(d)) || `db${i + 1}`, dir: d })),
      },
    });
  }
  if (appDir || deps.next) {
    const ev = [];
    if (appDir) ev.push(`App Router tree at \`${appDir}\` (page/route/layout files)`);
    if (deps.next) ev.push(`\`next\` in package.json dependencies`);
    if (middlewarePath) ev.push(`\`${middlewarePath}\` present`);
    const options = { appDir: appDir ?? "src/app", apiPrefix: "/api" };
    if (middlewarePath) options.middlewarePath = middlewarePath;
    proposals.push({ name: "nextjs", evidence: ev, options });
  }
  if (pyRouters.size) {
    const ev = [];
    for (const [dir, c] of [...pyRouters.entries()].sort()) {
      if (c.routers) ev.push(`\`APIRouter\` under \`${dir}\``);
      if (c.apps) ev.push(dir === "." ? "`FastAPI()` app at the repo root" : `\`FastAPI()\` app under \`${dir}\``);
    }
    proposals.push({ name: "fastapi", evidence: ev, options: { roots: [...pyRoots].sort() } });
  }

  const apps = [];
  if (deps.expo || deps["expo-router"]) apps.push({ name: "Mobile (Expo)", evidence: "`expo` in package.json", extractor: "expo-router (not yet shipped — the map carries the surfaces)" });
  if (deps["react-router"] || deps["react-router-dom"]) apps.push({ name: "Web (React)", evidence: "`react-router` in package.json", extractor: "react-router (not yet shipped — the map carries the surfaces)" });

  const mode = sourceFiles === 0 && !pkg ? "greenfield" : "existing";
  if (mode === "existing" && !proposals.length) {
    proposals.push({ name: "generic", evidence: ["source present but no known convention found — map-only ZDD; add extractors later"], options: {} });
  }
  return { mode, proposals, apps, sourceFiles };
}

// ---------------------------------------------------------------------------
// Greenfield: the answers name a stack; map each part to an extractor with
// its future paths, or to an Application concept for the map when no
// extractor exists yet.
// ---------------------------------------------------------------------------
const STACK_RULES = [
  { match: /fastapi/i, extractor: "fastapi", options: (path) => ({ roots: [path || "api"] }) },
  { match: /supabase|postgres/i, extractor: "supabase", options: (path) => ({ migrationNamespaces: [{ name: "db", dir: path || "supabase/migrations" }] }) },
  { match: /next(\.js)?/i, extractor: "nextjs", options: (path) => ({ appDir: path || "src/app", apiPrefix: "/api" }) },
  { match: /expo|react.?native/i, app: "Mobile (Expo)" },
  { match: /react|web|vite/i, app: "Web (React)" },
];

function fromStack(stack = []) {
  const extractors = [];
  const extractorOptions = {};
  const apps = [];
  for (const entry of stack) {
    const name = typeof entry === "string" ? entry : entry.name;
    const path = typeof entry === "string" ? undefined : entry.path;
    const rule = STACK_RULES.find((r) => r.match.test(name));
    if (!rule) {
      apps.push(name);
      continue;
    }
    if (rule.extractor) {
      if (!extractors.includes(rule.extractor)) {
        extractors.push(rule.extractor);
        extractorOptions[rule.extractor] = rule.options(path);
      }
    } else apps.push(rule.app);
  }
  return { extractors, extractorOptions, apps };
}

// ---------------------------------------------------------------------------
// Writers. Every one reports what it did to the ledger — wrote / kept /
// skipped — so the runbook can narrate and the tests can assert.
// ---------------------------------------------------------------------------
class Ledger {
  constructor(root) {
    this.root = root;
    this.wrote = [];
    this.kept = [];
    this.skipped = [];
    this.notes = [];
  }
  rel(p) {
    return posixify(relative(this.root, p));
  }
  write(path, content, { executable = false } = {}) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    if (executable) {
      try {
        chmodSync(path, 0o755);
      } catch {
        /* windows */
      }
    }
    this.wrote.push(this.rel(path));
  }
  writeIfMissing(path, content, opts) {
    if (existsSync(path)) {
      this.kept.push(this.rel(path));
      return false;
    }
    this.write(path, content, opts);
    return true;
  }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "app";

function snippetText() {
  return readFileSync(join(TEMPLATES, "claude-md-snippet.md"), "utf8");
}

// Insert or refresh the managed block. Three cases: our marked block (refresh
// in place), the v0.3.1 unmarked snippet (replace that section, bounded by
// the next `## ` heading), or nothing (append).
function upsertSnippet(existing, snippet) {
  const body = snippet.trimEnd() + "\n";
  if (!existing) return { text: body, changed: true, how: "created" };
  const b = existing.indexOf(SNIPPET_BEGIN);
  const e = existing.indexOf(SNIPPET_END);
  if (b !== -1 && e > b) {
    const next = existing.slice(0, b) + body.trimEnd() + existing.slice(e + SNIPPET_END.length);
    return { text: next, changed: next !== existing, how: "refreshed" };
  }
  const h = existing.indexOf(LEGACY_SNIPPET_HEADING);
  if (h !== -1) {
    const after = existing.indexOf("\n## ", h + LEGACY_SNIPPET_HEADING.length);
    const end = after === -1 ? existing.length : after + 1;
    const next = existing.slice(0, h) + body + existing.slice(end);
    return { text: next, changed: true, how: "replaced the pre-0.4 snippet" };
  }
  const sep = existing.endsWith("\n") ? (existing.endsWith("\n\n") ? "" : "\n") : "\n\n";
  return { text: existing + sep + body, changed: true, how: "appended" };
}

function writeSnippet(ledger, file) {
  const path = join(ledger.root, file);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const { text, changed, how } = upsertSnippet(existing, snippetText());
  if (!changed) {
    ledger.kept.push(file);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  ledger.wrote.push(file);
  ledger.notes.push(`${file}: ${how} the ZDD instruction block`);
}

function pinEngine(text, version) {
  const re = new RegExp(ENGINE_PACKAGE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "@[0-9][^\"'\\s]*", "g");
  return text.replace(re, `${ENGINE_PACKAGE}@${version}`);
}

function workflowText(version) {
  return pinEngine(readFileSync(join(TEMPLATES, "zdd.yml"), "utf8"), version);
}
function prePushText(version) {
  return pinEngine(readFileSync(join(TEMPLATES, "pre-push"), "utf8"), version);
}

function hasGit(root) {
  return existsSync(join(root, ".git"));
}

function setHooksPath(ledger) {
  if (!hasGit(ledger.root)) {
    ledger.notes.push("no .git here — after `git init`, run: git config core.hooksPath .githooks");
    return;
  }
  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: ledger.root, stdio: "ignore" });
    ledger.notes.push("git config core.hooksPath .githooks (local config, not committed — each clone runs it once)");
  } catch {
    ledger.notes.push("could not run git config — set it yourself: git config core.hooksPath .githooks");
  }
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------
export function apply(root, answers, { date = today(), home } = {}) {
  const ledger = new Ledger(root);
  const version = pluginVersion();
  const detection = detect(root);
  const optIns = { autoLoad: true, fence: true, ci: true, prePush: true, ...(answers.optIns ?? {}) };
  const existingConfig = loadConfig(root);
  const paths = artifactPaths(existingConfig);
  const mode = existingConfig ? "repair" : detection.mode;

  // --- config.json -------------------------------------------------------
  let config = existingConfig;
  const stack = fromStack(answers.stack);
  if (!config) {
    let extractors = answers.extractors;
    let extractorOptions = answers.extractorOptions;
    if (!extractors?.length && stack.extractors.length) ({ extractors, extractorOptions } = stack);
    if (!extractors?.length) {
      extractors = detection.proposals.map((p) => p.name);
      extractorOptions = Object.fromEntries(detection.proposals.map((p) => [p.name, p.options]));
    }
    if (!extractors?.length) extractors = ["generic"];
    if (!extractorOptions) {
      extractorOptions = {};
      for (const name of extractors) {
        const found = detection.proposals.find((p) => p.name === name);
        extractorOptions[name] = found?.options ?? stack.extractorOptions[name] ?? {};
      }
    }
    config = {
      name: answers.name || basename(root),
      repoBase: answers.repoBase || "",
      baseBranch: answers.baseBranch || "main",
      engine: version,
      extractors,
      extractorOptions: Object.fromEntries(extractors.map((n) => [n, extractorOptions[n] ?? {}])),
      hooks: { autoLoad: optIns.autoLoad, fence: optIns.fence },
    };
    if (!hasGit(root)) config.render = { storeChanges: false };
    ledger.write(join(root, "zdd", "config.json"), JSON.stringify(config, null, 2) + "\n");
  } else {
    ledger.kept.push("zdd/config.json");
  }

  // --- curated skeleton (empty templates; never overwritten) ---------------
  ledger.writeIfMissing(join(root, paths.glossary), "# Glossary\n\n<!-- One paragraph per term: **Term**: definition. Canonical, not descriptive. -->\n");
  for (const sub of ["features", "apps", "services"]) {
    const dir = join(root, paths.mapDir, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      ledger.write(join(dir, ".gitkeep"), "");
    }
  }
  const apps = answers.apps ?? stack.apps;
  for (const app of apps) {
    const file = join(root, paths.mapDir, "apps", `${slug(app)}.md`);
    ledger.writeIfMissing(
      file,
      `---\ntype: Application\ntitle: ${app}\ndescription: ${app} — declared at bootstrap; fill in as the code lands.\nresource: .\ntags: []\n---\n\n${app}: planned at adoption, before any code existed. Link its features here as they appear.\n`,
    );
  }
  const adrDir = join(root, paths.adrDir);
  mkdirSync(adrDir, { recursive: true });
  const adrFiles = readdirSync(adrDir).filter((f) => /^\d{4}-.*\.md$/.test(f));
  if (answers.seedAdr !== false) {
    if (adrFiles.length) ledger.kept.push(`${posixify(paths.adrDir)}/ (${adrFiles.length} ADR${adrFiles.length === 1 ? "" : "s"} present — seed skipped)`);
    else {
      const adr = readFileSync(join(TEMPLATES, "adr-0001-adopt-zero-drift-docs.md"), "utf8").replace("<DATE>", date);
      ledger.write(join(adrDir, "0001-adopt-zero-drift-docs.md"), adr);
    }
  } else ledger.skipped.push(`${posixify(paths.adrDir)}/0001-adopt-zero-drift-docs.md (declined)`);
  mkdirSync(join(root, paths.metadataDir), { recursive: true });

  // --- opt-ins ------------------------------------------------------------
  if (existingConfig && (existingConfig.hooks?.autoLoad !== optIns.autoLoad || existingConfig.hooks?.fence !== optIns.fence)) {
    // Repair run with a changed answer: the hooks block is plugin-owned, so
    // rewrite just that key.
    existingConfig.hooks = { autoLoad: optIns.autoLoad, fence: optIns.fence };
    writeFileSync(join(root, "zdd", "config.json"), JSON.stringify(existingConfig, null, 2) + "\n");
    ledger.wrote.push("zdd/config.json (hooks block)");
    ledger.kept.splice(ledger.kept.indexOf("zdd/config.json"), 1);
  }
  ledger.notes.push(`hooks: autoLoad ${optIns.autoLoad ? "on" : "off"}, fence ${optIns.fence ? "on" : "off"} (recorded in zdd/config.json; the plugin's hooks.json reads it)`);

  if (optIns.ci) {
    ledger.writeIfMissing(join(root, ".github", "workflows", "zdd.yml"), workflowText(version));
    ledger.skipped.push(".githooks/pre-push (CI accepted — not needed)");
  } else {
    ledger.skipped.push(".github/workflows/zdd.yml (CI declined)");
    if (optIns.prePush) {
      if (ledger.writeIfMissing(join(root, ".githooks", "pre-push"), prePushText(version), { executable: true })) setHooksPath(ledger);
    } else ledger.skipped.push(".githooks/pre-push (declined)");
  }

  writeSnippet(ledger, "CLAUDE.md");
  if (answers.codex) writeSnippet(ledger, "AGENTS.md");
  else ledger.skipped.push("AGENTS.md (not using Codex)");

  const pocock = findPocock(root, home);
  return { mode, version, date, config, optIns, pocock, detection, ...ledgerOut(ledger) };
}

function ledgerOut(l) {
  return { wrote: l.wrote, kept: l.kept, skipped: l.skipped, notes: l.notes };
}

// ---------------------------------------------------------------------------
// upgrade
// ---------------------------------------------------------------------------
export function upgrade(root) {
  const ledger = new Ledger(root);
  const version = pluginVersion();
  const configPath = join(root, "zdd", "config.json");
  if (!existsSync(configPath)) throw new Error(`no zdd/config.json under ${root} — nothing to upgrade (run bootstrap without --upgrade to adopt)`);
  const config = readJson(configPath);
  const before = JSON.stringify(config);
  const changes = [];

  if (config.adapter !== undefined) {
    const legacy = LEGACY_ADAPTERS[config.adapter];
    if (!legacy) throw new Error(`unknown legacy adapter '${config.adapter}' — migrate by hand to "extractors": [...]`);
    const split = legacy.split(config.adapterOptions);
    const next = {};
    // Keep the adopter's key order, with the new keys where the old ones sat.
    for (const [k, v] of Object.entries(config)) {
      if (k === "adapter") next.extractors = legacy.extractors;
      else if (k === "adapterOptions") next.extractorOptions = Object.fromEntries(legacy.extractors.map((n) => [n, split[n] ?? {}]));
      else next[k] = v;
    }
    if (!next.extractorOptions) next.extractorOptions = Object.fromEntries(legacy.extractors.map((n) => [n, split[n] ?? {}]));
    for (const k of Object.keys(config)) delete config[k];
    Object.assign(config, next);
    changes.push(`adapter "${next.extractors.join('" + "')}" → extractors ${JSON.stringify(next.extractors)}; adapterOptions split into extractorOptions`);
  }
  if (config.viewer && typeof config.viewer === "object" && Array.isArray(config.viewer.nonAreaTags)) {
    if (config.nonAreaTags === undefined) config.nonAreaTags = config.viewer.nonAreaTags;
    delete config.viewer.nonAreaTags;
    if (!Object.keys(config.viewer).length) delete config.viewer;
    changes.push("viewer.nonAreaTags → top-level nonAreaTags (it shapes graph.json, not just the viewer)");
  }
  if (config.engine !== version) {
    changes.push(`engine pin ${config.engine ?? "(none)"} → ${version}`);
    config.engine = version;
  }
  if (JSON.stringify(config) !== before) {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    ledger.wrote.push("zdd/config.json");
    for (const c of changes) ledger.notes.push(`zdd/config.json: ${c}`);
  } else ledger.kept.push("zdd/config.json");

  // Plugin-owned files: rewrite to this version, only where they exist.
  const wf = join(root, ".github", "workflows", "zdd.yml");
  if (existsSync(wf)) {
    const cur = readFileSync(wf, "utf8");
    const next = pinEngine(cur, version);
    if (next !== cur) {
      writeFileSync(wf, next);
      ledger.wrote.push(".github/workflows/zdd.yml");
      ledger.notes.push(`.github/workflows/zdd.yml: engine pin → ${version}`);
    } else ledger.kept.push(".github/workflows/zdd.yml");
  }
  const hook = join(root, ".githooks", "pre-push");
  if (existsSync(hook)) {
    const cur = readFileSync(hook, "utf8");
    const next = cur.includes(MANAGED_MARK) ? prePushText(version) : pinEngine(cur, version);
    if (next !== cur) {
      writeFileSync(hook, next);
      ledger.wrote.push(".githooks/pre-push");
      ledger.notes.push(`.githooks/pre-push: ${cur.includes(MANAGED_MARK) ? "rewritten from the template" : "engine pin updated"} (${version})`);
    } else ledger.kept.push(".githooks/pre-push");
  }
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    const p = join(root, file);
    if (!existsSync(p)) continue;
    const cur = readFileSync(p, "utf8");
    if (!cur.includes(SNIPPET_BEGIN) && !cur.includes(LEGACY_SNIPPET_HEADING)) {
      ledger.kept.push(`${file} (no ZDD block to refresh)`);
      continue;
    }
    writeSnippet(ledger, file);
  }
  ledger.notes.push("curated artifacts (glossary, ADRs, map) untouched — upgrade never writes them");
  ledger.notes.push("if the engine pin moved: run `render` and commit the regenerated artifacts in the same PR");
  return { version, ...ledgerOut(ledger) };
}

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------
function narrateDetect(d, pocock) {
  const out = [];
  if (d.mode === "greenfield") {
    out.push("Mode: GREENFIELD — no source to read. Ask for the intended stack and configure extractors ahead of the code.");
  } else {
    out.push(`Mode: EXISTING codebase (${d.sourceFiles} source files). Proposed extractors, with the evidence:`);
    for (const p of d.proposals) {
      out.push(`  - ${p.name}`);
      for (const e of p.evidence) out.push(`      evidence: ${e}`);
      out.push(`      options:  ${JSON.stringify(p.options)}`);
    }
    for (const a of d.apps) out.push(`  - map only: ${a.name} — ${a.evidence}; extractor ${a.extractor}`);
  }
  out.push(narratePocock(pocock));
  return out.join("\n");
}

function narratePocock(p) {
  if (p.installed) return `mattpocock-skills: installed (${p.hits[0]}) — \`grill\` will run the real interview.`;
  return (
    "mattpocock-skills: NOT installed. Recommended, never required: your glossary and ADRs will only be as good as the design " +
    "sessions that fill them, and `grill` (the design interview that writes them as it goes) needs Matt Pocock's skills. " +
    "Install: `/plugin marketplace add mattpocock/skills` then `/plugin install mattpocock-skills@skills` (Claude Code). " +
    "Without it, work decisions out in plan mode and let \"update ZDD\" capture them."
  );
}

function narrateApply(r) {
  const out = [`Bootstrap (${r.mode}) — plugin ${r.version}, ${r.date}`];
  for (const f of r.wrote) out.push(`  wrote   ${f}`);
  for (const f of r.kept) out.push(`  kept    ${f}`);
  for (const f of r.skipped) out.push(`  skipped ${f}`);
  for (const n of r.notes) out.push(`  note    ${n}`);
  out.push("");
  out.push("Next, run the engine (the skill does this): derive, then the mapping session, then render.");
  out.push(`  npx -y ${ENGINE_PACKAGE}@${r.version} derive`);
  out.push(`  npx -y ${ENGINE_PACKAGE}@${r.version} render`);
  out.push("");
  if (r.optIns.ci) {
    out.push("One step only you can do: in branch protection, require the `zdd` check to pass and require branches to be up to date before merging. Now stale generated artifacts cannot merge.");
  } else {
    out.push(
      "CI declined: ZDD runs on the two verbs alone" +
        (r.optIns.prePush ? ", with the pre-push hook making a forgotten update loud" : "") +
        ". The guarantee is weaker without CI — drift is a habit you keep, not a check that blocks a merge.",
    );
  }
  out.push(narratePocock(r.pocock));
  return out.join("\n");
}

function narrateUpgrade(r) {
  const out = [`Upgrade to plugin ${r.version}`];
  if (!r.wrote.length) out.push("  nothing to change — every plugin-owned file is already at this version");
  for (const f of r.wrote) out.push(`  changed ${f}`);
  for (const f of r.kept) out.push(`  kept    ${f}`);
  for (const n of r.notes) out.push(`  note    ${n}`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && posixify(process.argv[1]).endsWith("/scripts/bootstrap.mjs")) {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const root = adopterRoot(flags);
  try {
    if (cmd === "detect") {
      const d = detect(root);
      const pocock = findPocock(root, flags.home);
      process.stdout.write(flags.json ? JSON.stringify({ ...d, pocock }, null, 2) + "\n" : narrateDetect(d, pocock) + "\n");
    } else if (cmd === "apply") {
      if (!flags.answers) throw new Error("apply needs --answers=<file.json>");
      const answers = readJson(flags.answers);
      const r = apply(root, answers, { date: flags.date || today(), home: flags.home });
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narrateApply(r) + "\n");
    } else if (cmd === "upgrade") {
      const r = upgrade(root);
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narrateUpgrade(r) + "\n");
    } else {
      process.stderr.write("Usage: bootstrap.mjs <detect|apply --answers=<file>|upgrade> [--root=<dir>] [--date=YYYY-MM-DD] [--home=<dir>] [--json]\n");
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`bootstrap: ${e.message}\n`);
    process.exit(1);
  }
}
