// Repo + config resolution shared by every engine command. The engine is
// installed OUTSIDE the adopter repo (node_modules / npx cache), so the repo
// root can never come from this file's own location — it comes from the
// invocation:
//
//   --root=<dir>     explicit repo root
//   --config=<file>  explicit config file (else <root>/zdd/config.json)
//   neither          walk up from cwd to the first dir holding zdd/config.json
//                    (falling back to the first .git dir, then cwd itself)
//
// zdd/config.json is the discovery convention — configurable paths live INSIDE
// the config, but the config itself is found at the conventional spot.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { repoRelative, overlaps } from "./paths.mjs";

export const DEFAULT_PATHS = {
  glossary: "zdd/glossary.md",
  adrDir: "zdd/adr",
  mapDir: "zdd/map",
  metadataDir: "zdd/metadata",
  agentIndex: "zdd/agent-index.md",
  adrIndex: "zdd/adr-index.md",
  humanIndex: "zdd/human-index.html",
  graph: "zdd/graph.json",
  bundleDir: "zdd",
};

// Viewer selection (DIO-310). `viewer` is a name (`"minimal"`) or an object
// whose `name` picks the viewer and whose other keys are its options —
// `{ defaultFocus, authHubs, nonAreaTags }` for cytoscape. An object with no
// `name` (every pre-registry config) means the default viewer, so no adopter
// config changes meaning. The name is validated against the registry by the
// renderer, which owns the list.
export function resolveViewer(config, defaultName) {
  const v = config.viewer;
  if (v === undefined || v === null) return { name: defaultName, options: {} };
  if (typeof v === "string") return { name: v, options: {} };
  if (typeof v !== "object" || Array.isArray(v)) return { error: `'viewer' must be a name or an object with a 'name'` };
  const { name = defaultName, ...options } = v;
  if (typeof name !== "string") return { error: `'viewer.name' must be a string` };
  // Shape-check the built-in options up front — a `{}` where a list belongs
  // otherwise throws mid-render, or worse, inside the rendered page (CR-012).
  for (const key of ["authHubs", "nonAreaTags"]) {
    if (options[key] !== undefined && !(Array.isArray(options[key]) && options[key].every((t) => typeof t === "string"))) {
      return { error: `'viewer.${key}' must be an array of strings` };
    }
  }
  if (options.defaultFocus !== undefined && typeof options.defaultFocus !== "string") return { error: `'viewer.defaultFocus' must be a string` };
  return { name, options };
}

// Tags that are properties rather than product areas (tech tags like
// `react-flow`). They shape the GRAPH — which area a record inherits from its
// claiming feature — so they are a top-level key, not a viewer option: the
// artifact must not change when the viewer does (CR-003). The pre-0.4 home,
// `viewer.nonAreaTags`, is still read as a fallback with a note.
export function resolveNonAreaTags(config, viewerOptions) {
  if (config.nonAreaTags !== undefined) {
    if (!Array.isArray(config.nonAreaTags) || !config.nonAreaTags.every((t) => typeof t === "string")) {
      return { error: `'nonAreaTags' must be an array of strings` };
    }
    return { tags: config.nonAreaTags, diagnostics: [] };
  }
  if (viewerOptions.nonAreaTags !== undefined) {
    return {
      tags: viewerOptions.nonAreaTags,
      diagnostics: [`[config] 'viewer.nonAreaTags' shapes the graph, not just the viewer — move it to a top-level "nonAreaTags" key`],
    };
  }
  return { tags: [], diagnostics: [] };
}

// Source links are `repoBase + resource`; a base that is not http(s) would
// make every link a script gadget (CR-002). Empty means relative links.
export function validateRepoBase(repoBase) {
  if (repoBase === undefined || repoBase === "") return null;
  if (typeof repoBase !== "string" || !/^https?:\/\/\S+$/i.test(repoBase)) {
    return `'repoBase' must be empty or an http(s) URL, got ${JSON.stringify(repoBase)}`;
  }
  return null;
}

// Layout rule over the resolved paths, checked once for every command.
//
// 1. `derive` prunes metadataDir, so it must be a dedicated folder: a
//    metadataDir that equals, contains or sits inside any other configured
//    path — or the config file itself — would let a one-line config typo
//    (`"metadataDir": "zdd"`) delete the glossary, the map and config.json
//    as "orphaned records" (CR-059).
// 2. `render` writes its four outputs last and unconditionally, so they must
//    be pairwise distinct and disjoint from everything it reads: two outputs
//    on one file leave `--check` permanently red, and an output on the
//    glossary or config.json clobbers a curated store (CR-061).
//
// bundleDir is the one deliberate ancestor (everything lives under zdd/) and
// is not in the set. `configRel` is the config file's repo-relative name (it
// may start with `..` when --config= points elsewhere; then it overlaps
// nothing). Returns an error string or null.
const OUTPUT_KEYS = ["graph", "humanIndex", "agentIndex", "adrIndex"];
const INPUT_KEYS = ["glossary", "adrDir", "mapDir", "metadataDir"];
export function validatePathLayout(paths, configRel) {
  const label = (key) => (key === "config" ? "the config file" : `paths.${key}`);
  const value = (key) => (key === "config" ? configRel : paths[key]);
  const clash = (a, b, why) => `${label(a)} '${value(a)}' overlaps ${label(b)} '${value(b)}' — ${why}`;
  const metadataWhy = "metadataDir must be a dedicated folder (derive prunes everything in it that is not a current record)";
  for (const key of ["glossary", "adrDir", "mapDir", ...OUTPUT_KEYS, "config"]) {
    if (overlaps(paths.metadataDir, value(key))) return clash("metadataDir", key, metadataWhy);
  }
  const outputWhy = "render's outputs must be distinct files, apart from every store and the config it reads";
  for (let i = 0; i < OUTPUT_KEYS.length; i++) {
    for (let j = i + 1; j < OUTPUT_KEYS.length; j++) {
      if (overlaps(paths[OUTPUT_KEYS[i]], paths[OUTPUT_KEYS[j]])) return clash(OUTPUT_KEYS[i], OUTPUT_KEYS[j], outputWhy);
    }
    for (const key of [...INPUT_KEYS, "config"]) {
      if (overlaps(paths[OUTPUT_KEYS[i]], value(key))) return clash(OUTPUT_KEYS[i], key, outputWhy);
    }
  }
  return null;
}

// Greenfield tolerance has a blind spot: a mistyped store dir lints and
// renders as an EMPTY corpus, exactly like a bundle that has none yet
// (CR-068 / CR-099). So: for each asked-for store dir that is absent, one
// WARNING line when any other store (adr, map, metadata, glossary) is
// present — the bundle is not greenfield, the path is probably wrong. A
// truly greenfield bundle gets no line. Advisory: exit codes are unchanged.
const STORE_KEYS = ["adrDir", "mapDir", "metadataDir", "glossary"];
export function absentStoreNotes(repoRoot, paths, keys) {
  const present = STORE_KEYS.filter((k) => existsSync(resolve(repoRoot, paths[k])));
  if (!present.length) return [];
  return keys
    .filter((k) => !present.includes(k))
    .map(
      (k) =>
        `WARNING: paths.${k} '${paths[k]}' does not exist, but ${present.map((p) => `paths.${p}`).join(" + ")} ${present.length > 1 ? "do" : "does"} ` +
        `(not greenfield) — a mistyped path reads as an empty store`,
    );
}

function argValue(args, name) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

export function loadConfig(args, cwd = process.cwd()) {
  const rootArg = argValue(args, "root");
  const configArg = argValue(args, "config");

  let repoRoot = rootArg ? resolve(cwd, rootArg) : null;
  if (!repoRoot) {
    let gitRoot = null;
    for (let dir = cwd; ; ) {
      if (existsSync(join(dir, "zdd", "config.json"))) {
        repoRoot = dir;
        break;
      }
      if (!gitRoot && existsSync(join(dir, ".git"))) gitRoot = dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!repoRoot) repoRoot = gitRoot ?? cwd;
  }

  const configPath = configArg ? resolve(cwd, configArg) : join(repoRoot, "zdd", "config.json");
  if (!existsSync(configPath)) {
    console.error(
      `No ZDD config found at ${configPath} — run from inside a repo that has ` +
        `adopted ZDD (zdd/config.json), or pass --root= / --config=.`,
    );
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const paths = { ...DEFAULT_PATHS, ...(config.paths ?? {}) };
  // Every artifact path is read or written on the adopter's behalf — none may
  // point outside the checkout (CR-006). Same rule for localExtractorDir.
  for (const [key, value] of Object.entries(paths)) paths[key] = repoRelative(value, `paths.${key}`);
  if (config.localExtractorDir !== undefined) config.localExtractorDir = repoRelative(config.localExtractorDir, "localExtractorDir");
  const configRel = relative(repoRoot, configPath).split(/[\\/]/).join("/");
  const layoutError = validatePathLayout(paths, configRel);
  if (layoutError) {
    console.error(layoutError);
    process.exit(1);
  }
  return {
    repoRoot,
    configPath,
    config,
    paths,
    // The branch PRs merge into — merge-bases, freshness diffs, and the
    // changed-set highlight all key on origin/<baseBranch>.
    baseBranch: config.baseBranch ?? "main",
    bundleDir: resolve(repoRoot, paths.bundleDir),
  };
}

// ---------------------------------------------------------------------------
// Extractor selection. The 1.0 shape is `extractors: [names]` + per-extractor
// `extractorOptions: { <name>: {...} }` — one extractor per convention,
// composed by config, so a stack combination never needs a bespoke adapter
// (docs/decisions/0001). The pre-1.0 `adapter` + `adapterOptions` pair still
// works: it expands to the extractors it was a bundle of, with the old option
// keys routed to the extractor that owns them, and prints a deprecation note.
// The engine never rewrites the config; the plugin's `bootstrap --upgrade`
// does (plugins/zdd/scripts/bootstrap.mjs mirrors LEGACY_ADAPTERS for that),
// and the deprecation note says how to do it by hand.
// ---------------------------------------------------------------------------
export const LEGACY_ADAPTERS = {
  "nextjs-supabase": {
    extractors: ["supabase", "nextjs"],
    split(options = {}) {
      const { migrationNamespaces = [], externalBuckets = [], ...nextjs } = options;
      return { supabase: { migrationNamespaces, externalBuckets }, nextjs };
    },
  },
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function resolveExtractors(config) {
  const diagnostics = [];
  const hasNew = config.extractors !== undefined;
  const hasLegacy = config.adapter !== undefined || config.adapterOptions !== undefined;
  // Both forms at once would mean one silently wins and the other's options
  // are ignored (CR-019: 15 records quietly became 9). Refuse.
  if (hasNew && hasLegacy) {
    return { error: `zdd/config.json has both 'adapter' and 'extractors' — keep 'extractors' + 'extractorOptions' and delete the deprecated 'adapter' / 'adapterOptions' keys` };
  }
  if (hasNew) {
    const list = config.extractors;
    if (!Array.isArray(list)) return { error: `'extractors' must be an array of names` };
    if (!list.length) return { error: `'extractors' lists nothing — name at least one extractor ("generic" for a map-only bundle); an empty list would prune every metadata record` };
    if (list.some((n) => typeof n !== "string")) return { error: `'extractors' entries must be strings (names)` };
    const dup = list.find((n, i) => list.indexOf(n) !== i);
    if (dup) return { error: `extractor '${dup}' is listed twice` };
    // `extractorOptions: null` / `[]` / a string, or a per-extractor entry
    // that is not an object, reached the extractor's destructuring as-is
    // (CR-107). Refuse with the key named.
    const options = config.extractorOptions === undefined ? {} : config.extractorOptions;
    if (!isPlainObject(options)) return { error: `'extractorOptions' must be an object keyed by extractor name, got ${JSON.stringify(options)}` };
    // hasOwn: an extractor named `constructor` must read its own options,
    // not Object.prototype's (CR-022).
    const own = (name) => (Object.hasOwn(options, name) ? options[name] : undefined);
    for (const name of list) {
      if (own(name) !== undefined && !isPlainObject(own(name))) {
        return { error: `'extractorOptions.${name}' must be an object, got ${JSON.stringify(own(name))}` };
      }
    }
    return {
      extractors: list.map((name) => ({ name, options: own(name) ?? {} })),
      diagnostics,
    };
  }
  if (config.adapter !== undefined) {
    const legacy = LEGACY_ADAPTERS[config.adapter];
    if (!legacy) {
      return { error: `Unknown adapter '${config.adapter}' — 'adapter' is deprecated; use "extractors": [...] (known legacy adapters: ${Object.keys(LEGACY_ADAPTERS).join(", ")})` };
    }
    diagnostics.push(
      `[config] 'adapter' is deprecated — use "extractors": ${JSON.stringify(legacy.extractors)} with "extractorOptions" (split adapterOptions by key: migrationNamespaces + externalBuckets under supabase, the rest under nextjs)`,
    );
    if (config.adapterOptions !== undefined && !isPlainObject(config.adapterOptions)) {
      return { error: `'adapterOptions' must be an object, got ${JSON.stringify(config.adapterOptions)}` };
    }
    const split = legacy.split(config.adapterOptions);
    return { extractors: legacy.extractors.map((name) => ({ name, options: split[name] ?? {} })), diagnostics };
  }
  return { error: `zdd/config.json names no extractors — add "extractors": ["supabase", "nextjs", ...] (or "generic" for a map-only bundle)` };
}
