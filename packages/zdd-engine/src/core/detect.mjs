#!/usr/bin/env node
// ZDD detection (decision 0039) — which catalogue adapters fit a repo, with
// the evidence and the options each would use, and which parts of the app
// they cover and leave uncovered. Bootstrap asks this; it reads no config
// (there is none yet) and writes nothing.
//
//   zdd-engine detect [--root=<dir>]     one JSON object on stdout
//
// The work is lib/detect-repo.mjs; each adapter's own detect() supplies the
// evidence. Deterministic: the same tree gives the same answer.

import { resolve } from "node:path";
import { detectRepo } from "./lib/detect-repo.mjs";
import { catalogueModules } from "./derive.mjs";

export async function run(args) {
  const rootArg = args.find((a) => a.startsWith("--root="));
  const root = resolve(rootArg ? rootArg.slice("--root=".length) : process.cwd());
  let out;
  try {
    out = detectRepo(root, await catalogueModules());
  } catch (e) {
    console.error(`detect: ${e.message}`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
