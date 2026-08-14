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
