#!/usr/bin/env node
// Release check (2.1.0), run at session start and as `load`'s
// step 0 beside the engine-skew and Pocock-copy checks. An adopter's repo
// LOCKS one ZDD release: `.claude/settings.json` →
// `extraKnownMarketplaces["zero-drift-docs"].source.ref` (a tag, `v2.1.0`).
// That release brings one Pocock release (decision 0014). Nothing updates
// itself, so when a PR moves the lock every other developer's next session
// runs the old release until they refresh — and the mismatch was silent.
// This prints one loud line naming expected and found, then the pin-move
// route: when the catalogue is elsewhere, `claude plugin marketplace add
// "<repo>#<lock>" --scope project` and `bootstrap.mjs relock`; then
// `claude plugin update` (or install) for each plugin; then one restart —
// preceded, only on a machine that has one, by removing a stray declaration
// (below). Advisory, never blocking.
//
// Three records are compared against the lock, all under Claude Code's
// plugins folder (~/.claude/plugins, or CLAUDE_CONFIG_DIR's — 2.2.1):
//   - the catalogue: known_marketplaces.json → zero-drift-docs.source.ref.
//     One downloaded catalogue per machine, shared by every repo on it.
//     A restart moves it to a repo's lock only in some cases (0022's
//     profile D); one another repo set at a different tag stays where it
//     is (the 0.14.0 smoke run, twice on one machine; decision 0050,
//     0.14.1, superseding 0022's restart), so the route
//     re-points it with a project-scope add, which declares nothing at user
//     scope but rewrites this repo's declaration without auto-update off —
//     `relock` puts that back. A user (or this repo's local) declaration of
//     zero-drift-docs also holds the catalogue (decision 0022), so the route
//     first removes a stray one by its scope. `marketplace update` keeps the
//     recorded ref (2.0.0), so it is never part of the route.
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
// session. Silent when the repo locks nothing, everything matches, or the
// host is not Claude Code (Codex has no catalogue or installs). Exit
// 0 always; every file is untrusted text, printed through `printable`.

import { readFileSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, adopterRoot, pocockPin, ZDD_PLUGIN_ID, MAX_CONFIG_BYTES, MARKETPLACE, MARKETPLACE_REPO, isOurDeclaration, claudeDir, pluginsDir, userSettingsLabel } from "./lib/repo.mjs";

export { MARKETPLACE };
const POCOCK_ID = `mattpocock-skills@${MARKETPLACE}`;
// The bootstrap beside this check, forward slashes so every shell reads it.
const BOOTSTRAP = fileURLToPath(new URL("./bootstrap.mjs", import.meta.url)).replace(/\\/g, "/");
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
  { scope: "user", file: (root, home) => join(claudeDir(home), "settings.json") },
  { scope: "local", file: (root) => join(root, ".claude", "settings.local.json") },
];
export function strayDeclarations(root, home) {
  return STRAY.flatMap(({ scope, file }) => {
    const decl = readJsonObject(file(root, home))?.extraKnownMarketplaces?.[MARKETPLACE];
    if (!isObject(decl)) return [];
    const ref = decl.source?.ref;
    // Only a declaration of this repository is ours to prescribe removing; a
    // fork or mirror is the user's, and other repos may rely on it (CR-007).
    const src = isObject(decl.source) ? decl.source : {};
    return [{ scope, ref: typeof ref === "string" ? ref : null, ours: isOurDeclaration(decl), source: String(src.repo ?? src.url ?? src.path ?? "an unknown source") }];
  });
}

// The lock, the catalogue and the installs are all Claude Code's. Codex shares
// this hook file but has none of them, so there the check is silent
// (2.2.0 CR-001). Claude Code sets CLAUDECODE in every hook and shell it
// starts (verified on 2.1.295, even when the parent shell lacked it).
const underClaudeCode = () => Boolean(process.env.CLAUDECODE);

// `lock`: the tag to check against instead of the repo's (the upgrade's
// `next:` note, for the tag it moves to — in a plan, before the write).
// `host`: true when the caller is not a session-start hook but the
// developer's own command (`move-machine`, run from a plain terminal).
export function inspect(root, home, { lock: wanted = null, host = false } = {}) {
  const lock = wanted !== null && TAG.test(String(wanted)) ? String(wanted) : lockedRef(root);
  if (!lock || !(host || underClaudeCode())) return { lock, mismatches: [] };
  const expectedZdd = lock.slice(1);
  const plugins = pluginsDir(home);

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
  return { lock, catalogue, expected: { zdd: expectedZdd, pocock: expectedPocock }, found: { zdd: foundZdd, pocock: foundPocock }, strayDeclarations: strays, userSettings: userSettingsLabel(home), mismatches };
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
  const where = { user: `your user settings (${printable(r.userSettings ?? "~/.claude/settings.json")})`, local: "this repo's local settings (.claude/settings.local.json)" };
  const strays = Array.isArray(r.strayDeclarations) ? r.strayDeclarations.filter((d) => where[d.scope]) : [];
  const strayText = strays
    .map((d) =>
      d.ours === false
        ? `; ${where[d.scope]} declare ${MARKETPLACE} from ${printable(d.source)}, not ${MARKETPLACE_REPO} — yours to resolve by hand before the rest (it holds the catalogue there, and other repos may use it)`
        : `; ${where[d.scope]} also declare ${MARKETPLACE}${d.ref ? ` at ${printable(d.ref)}` : ""}, which holds the catalogue there`,
    )
    .join("");
  const catalogueMoved = r.mismatches.some((m) => m.what === "catalogue");
  const why = catalogueMoved ? ` The catalogue is one per machine, shared by every repo on it: a restart does not move it once another repo has set it, so it is re-pointed here — a repo on another release moves it again.` : "";
  return [`ZDD release mismatch: ${said}${strayText}. Fix, from this repo's folder: ${moveCommand(r)}.${why} (Installed is not loaded: this line clears on the next session.)`];
}

// The pin-move route as a plan (0.14.1, decision 0050), which
// `bootstrap.mjs move-machine` runs step by step, stopping at the first that
// fails (CR-386). A stray declaration of ours is removed by its scope first
// (decision 0022). When the catalogue is not at the lock, a project-scope add
// re-points it — a restart would not — and relock puts back the auto-update
// off the add drops. Then each plugin: `update` names the project scope, as
// the found install is this project's (the route a crossing to 0.11.0
// proved, ZDD-10); one with no install for this project is installed. While
// the catalogue is behind, the expected Pocock version is the running
// plugin's guess — the locked release may move it — so every installed
// plugin is updated, a no-op where it is current (CR-006). One restart, said
// in words, loads it all. Each step is { argv } (claude's arguments) or
// { relock: true }.
export function routePlan(r) {
  const catalogueMoved = r.mismatches.some((m) => m.what === "catalogue");
  const found = { [ZDD_PLUGIN_ID]: r.found?.zdd ?? null, [POCOCK_ID]: r.found?.pocock ?? null };
  const steps = [];
  const strays = Array.isArray(r.strayDeclarations) ? r.strayDeclarations.filter((d) => d.scope === "user" || d.scope === "local") : [];
  for (const d of strays.filter((x) => x.ours !== false)) steps.push({ argv: ["plugin", "marketplace", "remove", MARKETPLACE, "--scope", d.scope] });
  if (catalogueMoved) steps.push({ argv: ["plugin", "marketplace", "add", `${MARKETPLACE_REPO}#${r.lock}`, "--scope", "project"], moves: r.lock }, { relock: true });
  for (const id of [ZDD_PLUGIN_ID, POCOCK_ID]) {
    if (!(r.mismatches.some((m) => m.what === id) || (catalogueMoved && found[id] !== null))) continue;
    steps.push({ argv: ["plugin", found[id] === null ? "install" : "update", id, "--scope", "project"] });
  }
  return steps;
}

// The plan in words, for the line that names the command.
export function describePlan(steps) {
  const said = steps.map((s) =>
    s.relock ? "puts auto-update off back on the lock" : s.argv[2] === "remove" ? `removes the ${s.argv[5]} declaration` : s.argv[2] === "add" ? `re-points the catalogue to ${s.moves} with a project-scope marketplace add` : `${s.argv[1] === "install" ? "installs" : "updates"} ${s.argv[2]}`,
  );
  return said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said.at(-1)}` : (said[0] ?? "");
}

// A path as one argument that bash, Git Bash and PowerShell all read
// literally (CR-389): single quotes, which neither expands inside. A path
// holding a single quote has no such spelling, and is said instead.
export function shellArg(p) {
  return p.includes("'") ? null : `'${p}'`;
}

// The one command the line names, the plan it runs, and the restart after.
export function moveCommand(r) {
  const plan = routePlan(r);
  const arg = shellArg(BOOTSTRAP);
  const cmd = arg ? `node ${arg} move-machine` : `bootstrap.mjs move-machine, run with node from ${printable(BOOTSTRAP.replace(/\/[^/]*$/, ""))} (its path holds a quote no shell reads literally)`;
  return `${cmd} (it ${describePlan(plan)}, and stops at the first step that fails), then restart Claude Code`;
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
