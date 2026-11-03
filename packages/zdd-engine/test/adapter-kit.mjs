// What an adapter's own tests need from ZDD, and the only file they import
// that is not the adapter's (decision 0048 point 4). An adapter's link to
// ZDD is the contract: the `io` derive hands it, and the `scan` detect
// gets. A test needs both, so this file makes them, and nothing else: what
// the core then does with the answers (coverage, resolution, the merge) is
// the core's, tested in the core's suites.
//
// Here both are the core's own, so a test runs the adapter against the real
// io and the real detection scan. A copied adapter's tests travel with it
// into the app and import this file by the same name beside them, with the
// same three exports; the app's copy must hand out an io and a scan that
// keep the contract. Where that copy comes from is the starter library's
// (ZDD-11 slice 4).
//
//   ioFor(root, name)   the io derive hands adapter `name` for repo `root`
//   scanFor(root)       the scan detection hands every adapter for `root`:
//                       one walk, skipping the folders every detecting
//                       adapter the repo has names (here, the catalogue's)
//   trialRead(mod, root) the adapter's own answer to detect on that scan:
//                       null, or { proposal, apps, questions, declined }

import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";
import { detectScan } from "../src/core/lib/detect-repo.mjs";
import { catalogueModules } from "../src/core/derive.mjs";

const modules = await catalogueModules();

export const ioFor = (root, name) => makeExtractorIo(root, name);

export const scanFor = (root) => detectScan(root, modules);

export const trialRead = (mod, root) => mod.detect({ scan: scanFor(root), proposed: [] });
