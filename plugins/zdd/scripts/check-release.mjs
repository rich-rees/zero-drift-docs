#!/usr/bin/env node
// Release check (CAS-97, from CAS-37), run at session start and as `load`'s
// step 0 beside the engine-skew and Pocock-copy checks. An adopter's repo
// LOCKS one ZDD release: `.claude/settings.json` →
// `extraKnownMarketplaces["zero-drift-docs"].source.ref` (a tag, `v2.1.0`).
// That release brings one Pocock release (decision 0014). Nothing updates
// itself, so when a PR moves the lock every other developer's next session
// runs the old release until they refresh — and the mismatch was silent.
// This prints one loud line naming expected and found, then the pin-move
// route: restart, `claude plugin update`, restart again — preceded, only on
// a machine that has one, by removing a stray declaration (below). Advisory,
// never blocking.
//
// Three records are compared against the lock, all under ~/.claude/plugins:
//   - the catalogue: known_marketplaces.json → zero-drift-docs.source.ref.
//     One downloaded catalogue per machine, shared by every repo. It follows
//     the repo's declared ref on a restart — unless the user's settings (or
//     this repo's local settings) ALSO declare zero-drift-docs, which a plain
//     `claude plugin marketplace add` does silently: that declaration holds
//     the catalogue where it is (decision 0022, reproduced on clean profiles
//     for CAS-101). So the route first removes the stray declaration by its
//     scope — the catalogue and installs survive while the repo declares the
//     marketplace. `marketplace update` keeps the recorded ref (CAS-96), so
//     it is never part of the route, and neither is an add.
//   - zdd@zero-drift-docs installed for THIS project path
//     (installed_plugins.json, scope project, projectPath = the repo).
//   - mattpocock-skills@zero-drift-docs installed for this project, against
//     the version the catalogue's marketplace.json names when the catalogue
//     sits at the locked ref, else the running plugin's own pocock.json.
//
//   node check-release.mjs [--root=<dir>] [--home=<dir>] [--json]
//
// Known limit: this sees what is INSTALLED, not what the running session
// loaded — after the commands it still says restart, and clears next
// session. Silent when the repo locks nothing, or everything matches. Exit
// 0 always; every file is untrusted text, printed through `printable`.

import { readFileSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseArgs, adopterRoot, pocockPin, ZDD_PLUGIN_ID, MAX_CONFIG_BYTES } from "./lib/repo.mjs";

export const MARKETPLACE = "zero-drift-docs";
const POCOCK_ID = `mattpocock-skills@${MARKETPLACE}`;
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const printable = (s) => String(s).replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 120);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function readJsonObject(path) {
  try {
    const st = lstatSync(path);
    if (!st.isFile() || st.size > MAX_CONFIG_BYTES) return null;
    const j = JSON.parse(readFileSync(path, "utf8"));
    return isObject(j) ? j : null;
  } catch {
    return null;
  }
}
const samePath = (a, b) => {
  const [x, y] = [resolve(a), resolve(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
};

// The lock: the tag the repo's project settings pin the catalogue to. Only
// the project file is read — the lock is the repo's statement, not a user's.
export function lockedRef(root) {
  const j = readJsonObject(join(root, ".claude", "settings.json"));
  const ref = j?.extraKnownMarketplaces?.[MARKETPLACE]?.source?.ref;
  return typeof ref === "string" && TAG.test(ref) ? ref : null;
}

// Declarations of the marketplace outside the repo's project settings: the
// user's (what a plain `marketplace add` writes) and this repo's local file.
// Any ref, or none — each one can hold the catalogue.
const STRAY = [
  { scope: "user", file: (root, home) => join(home, ".claude", "settings.json") },
  { scope: "local", file: (root) => join(root, ".claude", "settings.local.json") },
];
export function strayDeclarations(root, home) {
  return STRAY.flatMap(({ scope, file }) => {
    const decl = readJsonObject(file(root, home))?.extraKnownMarketplaces?.[MARKETPLACE];
    if (!isObject(decl)) return [];
    const ref = decl.source?.ref;
    return [{ scope, ref: typeof ref === "string" ? ref : null }];
  });
}

export function inspect(root, home = process.env.ZDD_HOME || homedir()) {
  const lock = lockedRef(root);
  if (!lock) return { lock: null, mismatches: [] };
  const expectedZdd = lock.slice(1);
  const plugins = join(home, ".claude", "plugins");

  const known = readJsonObject(join(plugins, "known_marketplaces.json"));
  const catalogueRef = known?.[MARKETPLACE]?.source?.ref;
  const catalogue = typeof catalogueRef === "string" ? catalogueRef : null;

  // The Pocock version the locked release brings: from the catalogue when it
  // is at the lock (its marketplace.json is that release's), else from the
  // running plugin's pin — the best this process can know.
  let expectedPocock = pocockPin().version;
  if (catalogue === lock) {
    const market = readJsonObject(join(plugins, "marketplaces", MARKETPLACE, ".claude-plugin", "marketplace.json"));
    const entry = Array.isArray(market?.plugins) ? market.plugins.find((p) => isObject(p) && p.name === "mattpocock-skills") : null;
    if (entry && typeof entry.version === "string") expectedPocock = entry.version;
  }

  const installed = readJsonObject(join(plugins, "installed_plugins.json"));
  const forProject = (id) => {
    const rows = installed?.plugins?.[id];
    if (!Array.isArray(rows)) return null;
    const row = rows.find((r) => isObject(r) && r.scope === "project" && typeof r.projectPath === "string" && samePath(r.projectPath, root));
    return row && typeof row.version === "string" ? row.version : null;
  };
  const foundZdd = forProject(ZDD_PLUGIN_ID);
  const foundPocock = forProject(POCOCK_ID);

  const mismatches = [];
  if (catalogue !== lock) mismatches.push({ what: "catalogue", expected: lock, found: catalogue });
  if (foundZdd !== expectedZdd) mismatches.push({ what: ZDD_PLUGIN_ID, expected: expectedZdd, found: foundZdd });
  if (foundPocock !== expectedPocock) mismatches.push({ what: POCOCK_ID, expected: expectedPocock, found: foundPocock });
  const strays = catalogue !== lock ? strayDeclarations(root, home) : [];
  return { lock, catalogue, expected: { zdd: expectedZdd, pocock: expectedPocock }, found: { zdd: foundZdd, pocock: foundPocock }, strayDeclarations: strays, mismatches };
}

export function narrate(r) {
  if (!r.mismatches.length) return [];
  const lock = printable(r.lock);
  const said = r.mismatches
    .map((m) => {
      const found = m.found === null ? "not installed for this project" : `found ${printable(m.found)}`;
      return m.what === "catalogue" ? `the catalogue on this machine is at ${m.found === null ? "no recorded ref" : printable(m.found)}, this repo locks ${lock}` : `${m.what} expected ${printable(m.expected)}, ${found}`;
    })
    .join("; ");
  const where = { user: "your user settings (~/.claude/settings.json)", local: "this repo's local settings (.claude/settings.local.json)" };
  const strays = Array.isArray(r.strayDeclarations) ? r.strayDeclarations.filter((d) => where[d.scope]) : [];
  const strayText = strays.map((d) => `; ${where[d.scope]} also declare ${MARKETPLACE}${d.ref ? ` at ${printable(d.ref)}` : ""}, which holds the catalogue there`).join("");
  // The pin-move route (CAS-99; decision 0022): with no stray declaration, a restart
  // moves the catalogue to the lock, `plugin update` moves this project's
  // install to the release the catalogue holds, a second restart loads it.
  // A plugin with no install for this project has nothing to update, so it
  // is installed. While the catalogue is behind, the expected Pocock version
  // is the running plugin's guess — the locked release may move it — so
  // every installed plugin is updated, a no-op where it is current (CR-006).
  const catalogueMoved = r.mismatches.some((m) => m.what === "catalogue");
  const found = { [ZDD_PLUGIN_ID]: r.found?.zdd ?? null, [POCOCK_ID]: r.found?.pocock ?? null };
  const plugins = [ZDD_PLUGIN_ID, POCOCK_ID]
    .filter((id) => r.mismatches.some((m) => m.what === id) || (catalogueMoved && found[id] !== null))
    .map((id) => (found[id] === null ? `claude plugin install ${id} --scope project` : `claude plugin update ${id}`));
  const steps = [];
  for (const d of strays) steps.push(`claude plugin marketplace remove ${MARKETPLACE} --scope ${d.scope}`);
  if (catalogueMoved) steps.push(`restart Claude Code (the catalogue follows this repo's lock on restart)`);
  if (plugins.length) steps.push(...plugins, catalogueMoved ? "then restart Claude Code again" : "then restart Claude Code");
  return [`ZDD release mismatch: ${said}${strayText}. Fix, from this repo's folder: ${steps.join("; ")}. (Installed is not loaded: this line clears on the next session.)`];
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const root = adopterRoot(flags);
  const r = inspect(root, flags.home);
  if (flags.json) {
    process.stdout.write(JSON.stringify(r) + "\n");
    return;
  }
  const lines = narrate(r);
  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
}

if (process.argv[1] && process.argv[1].split(/[\\/]/).join("/").endsWith("/scripts/check-release.mjs")) {
  try {
    main();
  } catch {
    // Advisory by design: never stops `load` or a session start.
  }
  process.exitCode = 0;
}
