#!/usr/bin/env node
// ZDD detection (decision 0039) — which adapters in a folder fit a repo,
// with the evidence and the options each would use, and which parts of the
// app they cover and leave uncovered. Bootstrap asks this over the starter
// library's adapters (decision 0048 point 3); it writes nothing.
//
//   zdd-engine detect --adapters=<dir> [--root=<dir>] [--config=<file>]   one JSON object on stdout
//
// `--adapters` is the folder of adapters to ask: the starter library's
// `adapters/`, or any folder laid out the same way. Without it, the repo's
// own `localExtractorDir` is asked, when its zdd/config.json (or --config)
// names one; a config there that cannot be read is said, never taken for no
// folder (CR-303). The core holds no adapter, so with neither there is
// nothing to ask. Of the config only that key is read. Neither folder is
// ever walked as the repo's source, when it lies inside the repo (CR-293).
//
// The work is lib/detect-repo.mjs; each adapter's own detect() supplies the
// evidence. Deterministic: the same tree and folder give the same answer.

import { resolve } from "node:path";
import { detectRepo } from "./lib/detect-repo.mjs";
import { folderModules, ownAdapterFolder, toolingIn } from "./lib/adapter-folder.mjs";

// The folder detection (and `zdd-engine test`) asks: `--adapters`, or the
// repo's own localExtractorDir, read strictly.
export function adaptersFolder(root, given, { configPath = null } = {}) {
  if (given) return resolve(given);
  return ownAdapterFolder(root, { strict: true, configPath })?.abs ?? null;
}

export async function run(args) {
  const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const root = resolve(arg("root") ?? process.cwd());
  const configPath = arg("config") ? resolve(arg("config")) : null;
  let out;
  try {
    const dir = adaptersFolder(root, arg("adapters"), { configPath });
    if (!dir) throw new Error("no adapters to ask — pass --adapters=<folder of adapters> (the starter library's adapters/, npm @rich-rees/zdd-starter-adapters), or set localExtractorDir in zdd/config.json; the engine ships no adapter of its own");
    const own = ownAdapterFolder(root, { configPath });
    out = detectRepo(root, await folderModules(dir), { notSource: toolingIn(root, [own?.abs, dir]) });
  } catch (e) {
    console.error(`detect: ${e.message}`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
