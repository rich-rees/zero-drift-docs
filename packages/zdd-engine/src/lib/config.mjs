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
import { dirname, join, resolve } from "node:path";
import { repoRelative } from "./paths.mjs";

export const DEFAULT_PATHS = {
  glossary: "zdd/glossary.md",
  adrDir: "zdd/adr",
  mapDir: "zdd/map",
  metadataDir: "zdd/metadata",
  agentIndex: "zdd/agent-index.md",
  adrIndex: "zdd/adr-index.md",
  humanIndex: "zdd/human-index.html",
  bundleDir: "zdd",
};

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
// `bootstrap --upgrade` rewrites the config; the engine never does.
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
    const options = config.extractorOptions ?? {};
    return {
      extractors: list.map((name) => ({ name, options: options[name] ?? {} })),
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
    const split = legacy.split(config.adapterOptions);
    return { extractors: legacy.extractors.map((name) => ({ name, options: split[name] ?? {} })), diagnostics };
  }
  return { error: `zdd/config.json names no extractors — add "extractors": ["supabase", "nextjs", ...] (or "generic" for a map-only bundle)` };
}
