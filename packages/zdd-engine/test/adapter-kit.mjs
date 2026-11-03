// What an adapter's own tests need from ZDD, and the only file they import
// that is not the adapter's (decision 0048 point 4). An adapter's link to
// ZDD is the contract: the `io` derive hands it, and the `scan` detect
// gets. A test needs both, so this file makes them, and nothing else: what
// the core then does with the answers (coverage, resolution, the merge) is
// the core's, tested in the core's suites.
//
// Here both are the core's own, so a test runs the adapter against the real
// io. A copied adapter's tests travel with it into the app and import this
// file by the same name beside them, with the same three exports; the app's
// copy must hand out an io and a scan that keep the contract (see
// CONTRIBUTING, "The prize: writing an extractor").
//
//   ioFor(root, name)       the io derive hands adapter `name` for repo `root`
//   scanFor(root, skipDirs) the scan detect is handed for `root`: the walk
//                           skips those folder names, as detection's does
//   trialRead(mod, root)    the adapter's own answer to detect, on `root`:
//                           null, or { proposal, apps, questions, declined }

import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";
import { DETECT_DEPTH, makeScan } from "../src/core/lib/detect-repo.mjs";
import { gitIgnoredPredicate } from "../src/core/lib/ignored.mjs";

export const ioFor = (root, name) => makeExtractorIo(root, name);

export function scanFor(root, skipDirs = []) {
  const ignored = gitIgnoredPredicate(root);
  if (ignored.error) throw new Error(ignored.error);
  return makeScan(makeExtractorIo(root, "detect", { ignored, maxDepth: DETECT_DEPTH }), new Set(skipDirs));
}

export const trialRead = (mod, root) => mod.detect({ scan: scanFor(root, mod.DETECTION?.skipDirs ?? []), proposed: [] });
