#!/usr/bin/env node
// ZDD detection (decision 0039) — which adapters in a folder fit a repo,
// with the evidence and the options each would use, and which parts of the
// app they cover and leave uncovered. Bootstrap asks this over the starter
// library's adapters (decision 0048 point 3); it writes nothing.
//
//   zdd-engine detect --adapters=<dir> [--root=<dir>]   one JSON object on stdout
//
// `--adapters` is the folder of adapters to ask: the starter library's
// `adapters/`, or any folder laid out the same way. Without it, the repo's
// own `localExtractorDir` is asked, when its zdd/config.json names one. The
// core holds no adapter, so with neither there is nothing to ask.
//
// The work is lib/detect-repo.mjs; each adapter's own detect() supplies the
// evidence. Deterministic: the same tree and folder give the same answer.

import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectRepo } from "./lib/detect-repo.mjs";
import { folderModules } from "./lib/adapter-folder.mjs";
import { insideRepo, repoRelative } from "./lib/paths.mjs";

// The repo's own adapter folder, repo-relative, when its zdd/config.json
// names one: never source to a scan (decision 0048), and the folder asked
// when no other is given. Only that key is read, bounded like the config
// load: detection runs before bootstrap has written a config, and a config
// that cannot be read names none — bootstrap is what says what is wrong.
export function ownAdapterFolder(root) {
  const p = join(root, "zdd", "config.json");
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size > 1024 * 1024) return null;
    const dir = JSON.parse(readFileSync(p, "utf8"))?.localExtractorDir;
    if (typeof dir !== "string") return null;
    const rel = repoRelative(dir, "localExtractorDir");
    return { rel, abs: insideRepo(root, resolve(root, rel), "localExtractorDir") };
  } catch {
    return null;
  }
}

// The folder detection asks: `--adapters`, or the repo's localExtractorDir.
export function adaptersFolder(root, given) {
  if (given) return resolve(given);
  return ownAdapterFolder(root)?.abs ?? null;
}

export async function run(args) {
  const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const root = resolve(arg("root") ?? process.cwd());
  let out;
  try {
    const dir = adaptersFolder(root, arg("adapters"));
    if (!dir) throw new Error("no adapters to ask — pass --adapters=<folder of adapters> (the starter library's adapters/, npm @rich-rees/zdd-starter-adapters), or set localExtractorDir in zdd/config.json; the engine ships no adapter of its own");
    const own = ownAdapterFolder(root);
    out = detectRepo(root, await folderModules(dir), own ? { notSource: [own.rel] } : {});
  } catch (e) {
    console.error(`detect: ${e.message}`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
