#!/usr/bin/env node
// Starter-fix check (decision 0048 point 7), appended by the SessionStart
// hook. A copy of a starter records the library version it came from; when
// the library this ZDD release pins notes fixes for a copy the developer has
// not taken or declined, the session is told once, at load, so it reads the
// notes against the repo and recommends. The reader is `bootstrap.mjs
// starters --json` (`behind`, `offers`), the same status the upgrade reads.
//
//   node check-starters.mjs [--root=<dir>] [--json]
//
// Exit 0 always, silent unless there is something to say. Offline it says
// nothing: the library is read only from a local route or npm's cache, never
// the network, so a session start never waits on it. A copy behind with no
// fix noted is silent too: nothing in it needs the developer's word.

import { parseArgs, adopterRoot, readConfig } from "./lib/repo.mjs";
import { starters } from "./bootstrap.mjs";

const printable = (s) => String(s).replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 200);

// The status, or null when there is nothing to judge (no valid config, no
// copies, or the library out of reach).
export function inspect(root) {
  const cfg = readConfig(root);
  if (cfg.state !== "valid" || typeof cfg.config.localExtractorDir !== "string") return null;
  try {
    return starters(root, { offline: true });
  } catch {
    return null;
  }
}

export function narrate(s) {
  if (!s || !s.offers?.length) return [];
  const names = [...new Set(s.offers.flatMap((o) => Object.keys(o.starters)))].sort();
  const fixes = s.offers.reduce((n, o) => n + Object.values(o.starters).reduce((m, f) => m + f.length, 0), 0);
  return [
    `ZDD: the starter library ${printable(s.version)} notes ${fixes} fix${fixes === 1 ? "" : "es"} for this repo's ${names.length === 1 ? "copy" : "copies"} of ${names.map(printable).join(", ")} (decision 0048 point 7). ` +
      "Read each against this repo and recommend once: the plugin's `bootstrap.mjs starters` lists what each fix changes and who it affects; " +
      "on the developer's yes `starters --move` (the copies move, their tests run, derive), on a no `starters --decline`, kept so it is not asked again.",
  ];
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const s = inspect(adopterRoot(flags));
  if (flags.json) process.stdout.write(JSON.stringify(s) + "\n");
  else {
    const lines = narrate(s);
    if (lines.length) process.stdout.write(lines.join("\n") + "\n");
  }
}

if (process.argv[1] && /[\\/]check-starters\.mjs$/.test(process.argv[1])) {
  try {
    main();
  } catch {
    process.exitCode = 0;
  }
}
