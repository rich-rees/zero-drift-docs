#!/usr/bin/env node
// Pocock-copy check (CAS-93, decision 0014), run beside the engine skew check
// as `load`'s step 0 and appended by the SessionStart hook. ZDD pins one
// release of mattpocock-skills and brings it in from its own marketplace as
// a dependency. Claude Code loads two enabled plugins of the same name as
// ONE, silently — and in the CAS-93 experiment the other copy won (the
// user-scope official-marketplace copy, 1.2.3, loaded; the dependency's
// 1.3.1 did not). Bootstrap switches the other copies off in the repo's
// project settings; this check catches what that cannot reach — a local
// settings file, a marketplace nobody foresaw — and names the fix.
//
//   node check-pocock.mjs [--root=<dir>] [--home=<dir>] [--json]
//
// Exit 0 always, silent unless there is something to say (CR-020 shape, the
// same as check-skew). Settings files and install records are untrusted
// text: ids and versions are printed through `printable`, capped.

import { parseArgs, adopterRoot, pocockCopies } from "./lib/repo.mjs";

const printable = (s) => String(s).replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 200);

export function narrate(r) {
  const lines = [];
  if (r.others.length) {
    const named = r.others.map((o) => `${printable(o.id)} ${o.version ? printable(o.version) : "unknown version"} (enabled in ${o.label})`).join(", ");
    const fix = r.others.map((o) => `"${printable(o.id)}": false`).join(", ");
    lines.push(
      `ZDD: another copy of ${r.pinned.name} is switched on in this repo — ${named} — beside the copy ZDD pins, ${r.pinned.id} ${r.pinned.version}. ` +
        `Only one copy's skills load, and it may be the other one. Fix: in this repo's .claude/settings.json set ${fix} under enabledPlugins ` +
        `("upgrade ZDD" writes it). Never uninstall it: it still works in your other repos.`,
    );
  }
  if (!r.pinned.enabled) {
    lines.push(`ZDD: ${r.pinned.id} is switched off in ${r.pinned.label} — zdd does not load while its dependency is off. Set it to true there, or remove the line.`);
  }
  return lines;
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const root = adopterRoot(flags);
  const r = pocockCopies(root, flags.home);
  if (flags.json) {
    process.stdout.write(
      JSON.stringify({
        pinned: { id: r.pinned.id, version: r.pinned.version, enabled: r.pinned.enabled, source: r.pinned.source },
        others: r.others.map((o) => ({ id: o.id, version: o.version, source: o.source })),
      }) + "\n",
    );
    return;
  }
  const lines = narrate(r);
  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
}

if (process.argv[1] && process.argv[1].split(/[\\/]/).join("/").endsWith("/scripts/check-pocock.mjs")) {
  try {
    main();
  } catch {
    // Advisory by design: never stops `load` or a session start.
  }
  process.exitCode = 0;
}
