// The adapter test kit: the engine package's public entry (decision 0048,
// As built slice 4). An adapter's one link to ZDD is the contract, the `io`
// derive hands it and the `scan` detect gets, so an adapter's own tests need
// both, made by the engine that will run the adapter. This file makes them,
// and nothing else: what the core then does with the answers (coverage,
// resolution, the merge) is the core's, tested in the core's suites. It is
// part of the contract and freezes with it at 1.0.
//
//   import { ioFor, scanFor, trialRead } from "@rich-rees/zdd";
//
//   ioFor(root, name)               the io derive hands adapter `name` for repo `root`,
//                                   the repo's adapter folder never source in it
//   await scanFor(root, adapters)   the scan detection hands every adapter for
//                                   `root`: one walk, skipping the folders every
//                                   detecting adapter in the folder `adapters`
//                                   names — the app's own localExtractorDir, so
//                                   a test sees what detection sees
//   await trialRead(mod, root, adapters)
//                                   the adapter's own answer to detect on that
//                                   scan: null, or { proposal, apps, questions,
//                                   declined }
//
// A test that travels with its adapter finds its folder from where it sits:
// `<adapters>/<name>/test/x.test.mjs`, so `new URL("../../", import.meta.url)`
// is the adapters folder in the starter library and in the app alike.
// `zdd-engine test` runs those tests with this package resolvable, so a repo
// with no node_modules runs them too. Stack-free like everything under core/.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeExtractorIo } from "./lib/extractor-io.mjs";
import { detectScan } from "./lib/detect-repo.mjs";
import { folderModules, ownAdapterFolder, toolingIn } from "./lib/adapter-folder.mjs";

const folderOf = (adapters) => {
  if (adapters instanceof URL) adapters = fileURLToPath(adapters);
  if (typeof adapters !== "string" || !adapters) throw new TypeError("the folder of the app's adapters is required (its localExtractorDir): the scan skips the folders they name, as detection's does");
  return resolve(adapters);
};
const folders = new Map();
function modulesOf(dir) {
  if (!folders.has(dir)) folders.set(dir, folderModules(dir));
  return folders.get(dir);
}

// What derive and detect never read as source, for the same root: the
// repo's own adapter folder (from its config, when it has one) and the
// folder of adapters given, when either lies inside it (CR-292).
const notSourceFor = (root, ...dirs) => toolingIn(root, [ownAdapterFolder(root)?.abs, ...dirs]);

export const ioFor = (root, name) => makeExtractorIo(root, name, { notSource: notSourceFor(root) });

export async function scanFor(root, adapters) {
  const dir = folderOf(adapters);
  return detectScan(root, await modulesOf(dir), { notSource: notSourceFor(root, dir) });
}

export async function trialRead(mod, root, adapters) {
  return mod.detect({ scan: await scanFor(root, adapters), proposed: [] });
}
