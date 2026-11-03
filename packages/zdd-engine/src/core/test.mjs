#!/usr/bin/env node
// ZDD adapter tests (decision 0048 points 3 and 4) — runs the tests that
// travel with a repo's adapters, `<adapters>/<name>/test/*.test.mjs`, with
// `@rich-rees/zdd` resolving to this engine's test kit (kit.mjs), so a repo
// with no node_modules runs them too. Node's own test runner does the rest.
//
//   zdd-engine test [--adapters=<dir>] [--root=<dir>] [--config=<file>]
//
// `--adapters` is the folder of adapters (the starter library's `adapters/`,
// or any laid out the same way); without it, the repo's own
// `localExtractorDir`. Exits with the runner's status; with no test file to
// run it says so and exits 1, so a check that ran nothing never passes.

import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readAdapterFolder } from "./lib/adapter-folder.mjs";
import { adaptersFolder } from "./detect.mjs";

const REGISTER = new URL("./kit-register.mjs", import.meta.url).href;

// Every adapter's own test files, in name order: `<name>/test/*.test.mjs`,
// read from the folder as derive reads it (never through a link).
export function adapterTests(dir) {
  const files = [];
  for (const [name] of readAdapterFolder(dir)) {
    const tests = join(resolve(dir), name, "test");
    const st = existsSync(tests) ? lstatSync(tests) : null;
    if (!st || st.isSymbolicLink() || !st.isDirectory()) continue;
    for (const f of readdirSync(tests).sort()) {
      const p = join(tests, f);
      if (f.endsWith(".test.mjs") && lstatSync(p).isFile()) files.push(p);
    }
  }
  return files;
}

export async function run(args) {
  const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const root = resolve(arg("root") ?? process.cwd());
  let files;
  try {
    const dir = adaptersFolder(root, arg("adapters"));
    if (!dir) throw new Error("no adapters to test — pass --adapters=<folder of adapters>, or set localExtractorDir in zdd/config.json");
    files = adapterTests(dir);
    if (!files.length) throw new Error(`no adapter in ${dir} has a test/ folder of *.test.mjs files — nothing to run`);
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
