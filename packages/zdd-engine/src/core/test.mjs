#!/usr/bin/env node
// ZDD adapter tests (decision 0048 points 3 and 4) — runs the tests that
// travel with a repo's adapters, with `@rich-rees/zdd` resolving to this
// engine's test kit (kit.mjs), so a repo with no node_modules runs them too.
// Node's own test runner does the rest.
//
//   zdd-engine test [--adapters=<dir>] [--root=<dir>] [--config=<file>]
//
// An adapter's tests are `<name>/test/*.test.mjs` (a starter's), and
// `<name>/*.test.mjs` beside its index.mjs (where the extractor skill's
// scaffold writes one, CR-305). `--adapters` is the folder of adapters (the
// starter library's `adapters/`, or any laid out the same way); without it,
// the repo's own `localExtractorDir`, from zdd/config.json or `--config`
// (CR-298). The tests are the repo's own code, run as its CI runs them.
// Exits with the runner's status; with no test file to run it says so and
// exits 1, so a check that ran nothing never passes. Needs Node 20.6 or
// later (node:module register).

import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readAdapterFolder } from "./lib/adapter-folder.mjs";
import { adaptersFolder } from "./detect.mjs";

const REGISTER = new URL("./kit-register.mjs", import.meta.url).href;

// Every adapter's own test files, in name order, read from the folder as
// derive reads it (never through a link).
export function adapterTests(dir) {
  const files = [];
  const testsIn = (folder) => {
    const st = existsSync(folder) ? lstatSync(folder) : null;
    if (!st || st.isSymbolicLink() || !st.isDirectory()) return [];
    return readdirSync(folder)
      .sort()
      .map((f) => join(folder, f))
      .filter((p) => p.endsWith(".test.mjs") && lstatSync(p).isFile());
  };
  for (const [name] of readAdapterFolder(dir)) {
    const own = join(resolve(dir), name);
    files.push(...testsIn(own), ...testsIn(join(own, "test")));
  }
  return files;
}

export async function run(args) {
  const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const root = resolve(arg("root") ?? process.cwd());
  let files;
  try {
    const dir = adaptersFolder(root, arg("adapters"), { configPath: arg("config") ? resolve(arg("config")) : null });
    if (!dir) throw new Error("no adapters to test — pass --adapters=<folder of adapters>, or set localExtractorDir in zdd/config.json");
    files = adapterTests(dir);
    if (!files.length) throw new Error(`no adapter in ${dir} has a *.test.mjs file, beside it or in its test/ folder — nothing to run`);
  } catch (e) {
    console.error(`test: ${e.message}`);
    process.exit(1);
  }
  // A run started from inside another test run (a suite that tests this
  // command) is a run of its own: the parent's context would make the runner
  // report to it instead of printing.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const r = spawnSync(process.execPath, [`--import=${REGISTER}`, "--test", ...files], { stdio: "inherit", env });
  process.exit(r.status ?? 1);
}
