// The parts of scripts/pre-tag.mjs a test can reach without running every
// suite (ZDD-11 slice 7, CR-381): the environment every dry-run step runs
// with, and the line counting what an adopter's upgrade will ask about.

// Every step runs this checkout's engine, never the one an adopter's pin
// names: the dry run comes before the tag, so that version is not on npm
// yet. A repo's own scaffolded adapter test runs the engine at its pin
// through npx unless ZDD_ENGINE_BIN names one, and `starters --move` runs
// those tests: without it, every adopter holding such an adapter fails.
export const dryRunEnv = (engine, env = process.env) => ({ ...env, ZDD_ENGINE_BIN: engine });

// A copy pinned on the old line (zdd/config.json's `engine`, no `release`,
// decision 0042): its upgrade also crosses 0.9, whose own changes move
// records, so the dry run derives them before proof 1, as the upgrade's
// note tells the developer to (CR-371, CR-385). A config that cannot be
// read is not the old line: the upgrade itself says what is wrong.
export function pinnedOnOldLine(configText) {
  try {
    const c = JSON.parse(configText);
    return Boolean(c) && typeof c === "object" && c.release === undefined && typeof c.engine === "string";
  } catch {
    return false;
  }
}

// What `bootstrap.mjs unread --json` or `gaps --json` said, as one line:
// how many the upgrade's steps 4c and 4d will ask about, by kind (a gap)
// or adapter (an unread item). A list that cannot be read is a failure,
// never zero. Names come from the adopter's records, so only a plain name
// is printed.
export function answerCounts(which, { status, stdout = "", stderr = "" }) {
  let list = null;
  try {
    list = status === 0 ? JSON.parse(stdout) : null;
  } catch {
    list = null;
  }
  if (!Array.isArray(list?.open)) {
    return { ok: false, line: `${which} (the list to answer) — exit ${status}\n${(stdout + stderr).split("\n").slice(-20).join("\n")}` };
  }
  const by = new Map();
  for (const x of list.open) {
    const raw = which === "gaps" ? x?.kind : x?.adapter;
    const name = typeof raw === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(raw) ? raw : "?";
    by.set(name, (by.get(name) ?? 0) + 1);
  }
  const kinds = [...by].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `${n} ${k}`).join(", ");
  return { ok: true, count: list.open.length, line: `${list.open.length} ${which === "gaps" ? "gaps" : "unread items"} to answer${kinds ? ` (${kinds})` : ""}` };
}
