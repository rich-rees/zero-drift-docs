// What an adapter saw and could not read (decision 0048 point 5). The adapter
// returns `unread: [{ file, what }]`; the core turns each item into a record
// of kind `unread` under metadataDir, so `derive --check` keeps the list
// honest, lint and render read it from the same place, and a repo with
// nothing unread gets no new file. The records are not adapters' records:
// they are neither nodes in the graph nor claimable.
//
// An item is answered by fixing the adapter (it stops reporting it) or by a
// mark in zdd/config.json, kept once and read by its id:
//
//   "unread": { "strict": true, "fine": [{ "id": "unread:<adapter>/<hash>", "what": "…", "why": "…" }] }
//
// `strict` is what makes an open item fail lint. A release adds the check as
// a warning (decisions 0035 and 0040 point 7): a fresh install writes
// `strict: true`, and an upgraded repo gets it from `bootstrap.mjs unread
// --raise` once every item is answered. Only an ABSENT block defaults; a
// misspelt key is an error, so enforcement is never silently off.
//
// An id is the adapter, the file and the text as the adapter wrote it, hashed:
// no line number, so a mark survives the code around the item moving and
// lapses when the item itself changes, a change of whitespace or one past the
// cut of the display included. Line endings do not count, so a CRLF checkout
// gets the id CI gets. Stack-free like everything under core/.

import { createHash } from "node:crypto";

export const UNREAD_KIND = "unread";
export const MAX_WHAT = 300; // an item's text, as shown; the id hashes it whole
export const MAX_WHY = 500;
export const MAX_MARKS = 10_000;
// One adapter's items. Each is a file, so a hostile source must not choose how
// many: past this, the reader is what needs fixing, and derive stops first.
export const MAX_ITEMS = 5_000;
// An item's id, exactly: what a mark may name, and nothing that can break a line.
export const UNREAD_ID = /^unread:[a-z][a-z0-9-]*\/[0-9a-f]{16}$/;
// Lines one run prints: `unread` lists the rest, and so does the human index.
export const MAX_PRINTED = 500;

const UNREAD_KEYS = ["strict", "fine"];
const MARK_KEYS = ["id", "what", "why"];

// One line of plain text, whatever the source held. Every control, format and
// line-separator character goes, so nothing can forge a line in a CI log or
// reorder one with a bidi mark.
export const oneLine = (s) => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
export const cut = (s, n) => {
  const chars = Array.from(s); // never through a surrogate pair
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : s;
};
const brief = (v) => cut(oneLine(String(v)), 60);

// The items one adapter returned, as records. An item's own extra keys are
// ignored, so the contract can grow by optional fields. Returns { records }
// or { error }.
export function unreadRecords(name, list) {
  if (!Array.isArray(list)) return { error: `Extractor '${name}': unread must be an array of { file, what }` };
  const seen = new Map();
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: `Extractor '${name}': every unread item must be an object { file, what }` };
    const { file, what } = item;
    if (typeof file !== "string" || !file || /[\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(file) || file.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(file) || file.split("/").includes("..")) {
      return { error: `Extractor '${name}': unread item file ${JSON.stringify(brief(file))} must be repo-relative POSIX (no '..')` };
    }
    const text = typeof what === "string" ? oneLine(what) : "";
    if (!text) return { error: `Extractor '${name}': unread item in ${brief(file)} has no 'what' — say what was seen and not read` };
    // One statement written twice in a file is one item, one answer.
    const hash = createHash("sha256").update(`${name}\0${file}\0${what.replace(/\r\n?/g, "\n")}`).digest("hex").slice(0, 16);
    if (seen.has(hash)) continue;
    if (seen.size >= MAX_ITEMS) return { error: `Extractor '${name}' reports more than ${MAX_ITEMS} unread items — fix what it cannot read before it says more; each item is a file in the metadata folder` };
    seen.set(hash, {
      kind: UNREAD_KIND,
      id: `${UNREAD_KIND}:${name}/${hash}`,
      title: cut(text, MAX_WHAT),
      description: "",
      resource: [file],
      refs: [],
      facts: { adapter: name },
      filename: `${name}--${hash}.json`,
    });
  }
  return { records: [...seen.values()] };
}

// A record as lint, render and the report read it. Metadata can be edited by
// hand, so every field is cut to one plain line here, the one way in; a
// record's truth is `derive --check`'s to hold.
export function itemOf(record) {
  const file = Array.isArray(record.resource) ? String(record.resource[0] ?? "") : "";
  return { id: oneLine(String(record.id)), adapter: oneLine(String(record.facts?.adapter ?? "")), file: oneLine(file), what: oneLine(String(record.title ?? "")) };
}

// A block of one-time marks in the config: `strict`, plus one list of
// `{ id, what, why }` per answer it takes. The unread items' block is one
// (`unread`, answered `fine`); the map's gaps are another (`gaps`, answered
// `fine` or `known`, decision 0049), read by the same rules so a mark means
// the same thing in both. Returns { strict, <answer>: Map(id -> { what, why }) }
// or { error }. An id is in one list at most.
export function marksConfig(config, key, { lists, idRe, idShape, itemName, reason }) {
  const u = config[key] === undefined ? {} : config[key];
  const keys = ["strict", ...lists];
  const fail = (msg) => ({ error: `zdd/config.json: ${msg}` });
  if (u === null || typeof u !== "object" || Array.isArray(u)) return fail(`'${key}' must be an object`);
  const unknown = Object.keys(u).find((k) => !keys.includes(k));
  if (unknown !== undefined) return fail(`'${key}' has an unknown key '${brief(unknown)}' (known: ${keys.join(", ")})`);
  if (u.strict !== undefined && typeof u.strict !== "boolean") return fail(`'${key}.strict' must be true or false`);
  const out = { strict: u.strict === true };
  const seen = new Map();
  for (const answer of lists) {
    const at = `${key}.${answer}`;
    const list = u[answer] === undefined ? [] : u[answer];
    if (!Array.isArray(list)) return fail(`'${at}' must be an array of { id, what, why }`);
    if (list.length > MAX_MARKS) return fail(`'${at}' lists more than ${MAX_MARKS} marks`);
    const marks = new Map();
    for (const m of list) {
      if (!m || typeof m !== "object" || Array.isArray(m)) return fail(`every '${at}' entry must be an object { id, what, why }`);
      const extra = Object.keys(m).find((k) => !MARK_KEYS.includes(k));
      if (extra !== undefined) return fail(`an '${at}' entry has an unknown key '${brief(extra)}' (known: ${MARK_KEYS.join(", ")})`);
      if (typeof m.id !== "string" || !idRe.test(m.id)) return fail(`'${at}' id ${JSON.stringify(brief(m.id))} is not ${itemName}'s id ("${idShape}")`);
      if (m.what !== undefined && typeof m.what !== "string") return fail(`'${at}' entry '${brief(m.id)}': 'what' must be a string`);
      if (typeof m.why !== "string" || !m.why.trim()) return fail(`'${at}' entry '${brief(m.id)}' gives no 'why' — ${reason(answer)}, for whoever reads it next`);
      if (m.why.length > MAX_WHY) return fail(`'${at}' entry '${brief(m.id)}': 'why' is over ${MAX_WHY} characters`);
      if (marks.has(m.id)) return fail(`'${at}' lists '${brief(m.id)}' twice`);
      if (seen.has(m.id)) return fail(`'${brief(m.id)}' is in both '${seen.get(m.id)}' and '${at}' — one answer per item`);
      seen.set(m.id, at);
      marks.set(m.id, { what: m.what ?? "", why: m.why });
    }
    out[answer] = marks;
  }
  return out;
}

// The `unread` block of the config: { strict, fine: Map(id -> { what, why }) }
// or { error }. Every command that reads the block reads it through here.
export function unreadConfig(config) {
  return marksConfig(config, "unread", { lists: UNREAD_KEYS.slice(1), idRe: UNREAD_ID, idShape: `${UNREAD_KIND}:<adapter>/<hash>`, itemName: "an unread item", reason: () => "a mark says why the item is fine" });
}

const byPlace = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.what < b.what ? -1 : a.what > b.what ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Items against marks. `open` has no answer yet; `fine` carries each mark's
// reason; `stale` is a mark no item answers any more (the adapter was fixed,
// or the statement changed). A stale mark excuses nothing, so it warns and
// never fails: fixing an adapter must not turn CI red.
export function unreadReport(items, { strict, fine }) {
  const sorted = [...items].sort(byPlace);
  const ids = new Set(sorted.map((i) => i.id));
  return {
    strict,
    open: sorted.filter((i) => !fine.has(i.id)),
    fine: sorted.filter((i) => fine.has(i.id)).map((i) => ({ ...i, why: oneLine(fine.get(i.id).why) })),
    stale: [...fine.keys()].filter((id) => !ids.has(id)).sort(),
  };
}

// The lines every derive prints, unanswered first, and bounded: a repo with
// thousands of items must not lose the rest of the log to a piped stderr.
export function unreadLines(report) {
  const open = report.open.map((i) => `UNREAD ${i.id}  ${i.file}: ${i.what}`);
  const fine = report.fine.map((i) => `UNREAD ${i.id}  ${i.file}: ${i.what} (marked fine: ${cut(i.why, 120)})`);
  const all = [...open, ...fine];
  if (!all.length) return [];
  const lines = all.slice(0, MAX_PRINTED);
  if (all.length > lines.length) lines.push(`… and ${all.length - lines.length} more — the engine's \`unread\` lists them all, and so does the human index`);
  if (report.open.length) lines.push(`${report.open.length} item${report.open.length === 1 ? "" : "s"} an adapter saw and could not read, with no answer yet — fix the adapter, or mark each one fine once (${MARK_ROUTE}). ${report.strict ? "lint fails until then." : "lint warns for now; `unread.strict` makes it fail."}`);
  return lines;
}

// How a person answers, said wherever an open item is named.
export const MARK_ROUTE = `the plugin's \`bootstrap.mjs unread --mark=<id> --why="…"\`, kept in zdd/config.json's unread.fine`;
