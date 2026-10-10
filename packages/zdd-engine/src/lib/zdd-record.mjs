// The ZDD record (decision 0028): the block "update ZDD" writes into the
// update commit's message, under a `ZDD record:` heading — five fixed
// sections, always all five, each either exactly `- none` or a list of
// lines that open with a fixed verb and continue in a plain sentence. The
// verbs are what `tally` counts; the sentence is for the reviewer. A
// `Pattern record:` (2.0–2.3, decision 0015) is read as the `blessings`
// section alone, with the blessing verbs only, so history is neither lost
// nor inflated.
//
// Shape only is checked here (decision 0029): whether a sentence is true
// stays with the reviewer. A line that fails the shape is kept in the parse
// with `valid: false` and named in `problems`, so the tally can list it and
// leave it out of the counts (a line with no counterfactual is a read, and
// a read does not count — decision 0027). Nothing in this module runs git;
// `recordsInLog` takes the text `git log` produced.
//
// Everything here reads adopter-written text (commit messages, store
// files): bounded work per line, no quadratic scans, and every excerpt that
// reaches a terminal goes through `printable` (CAS-105 review CR-011/013).

export const SECTIONS = ["glossary", "adrs", "blessings", "map", "comments"];
export const USE_VERBS = ["turned", "confirmed", "reused"];
export const STORE_VERB = "stored";
// The blessing verbs the pattern record already had (decision 0015), kept
// unchanged so no adopter's history or host harness breaks.
export const BLESSING_VERBS = ["followed", "departed", "minted", "dropped candidate", "precedent", "no blessing applied"];
export const NONE = "none";

// A `turned` or `confirmed` line must say what would otherwise have
// happened (decision 0027). These are the constructions that do: each
// relates an alternative action, never a bare state word (`not`, `changed`)
// that any summary of an ADR contains (CR-004).
export const COUNTERFACTUAL_MARKERS = [/\bwould\b/i, /\babout to\b/i, /\binstead\b/i, /\botherwise\b/i, /\brather than\b/i];

export const HEADING = /^(ZDD record|Pattern record)(\s*\(amended\))?:\s*$/;

// One anchored grammar per line: `- <verb>: <sentence>` or exactly `- none`
// (CR-003). Verbs longest first so `no blessing applied` wins over `none`.
const ALL_VERBS = [...USE_VERBS, STORE_VERB, ...BLESSING_VERBS];
const LINE_RE = new RegExp(`^- (${[...ALL_VERBS].sort((a, b) => b.length - a.length).join("|")}): (\\S.*)$`);
const NONE_RE = /^- none$/;
const SECTION_RE = /^([a-z][a-z-]*):$/;
const TRAILER_RE = /^[A-Z][A-Za-z-]+: /; // a git trailer (Co-Authored-By: …) ends the block

// Parse one commit message. Returns null when it carries no record heading;
// otherwise { kind: "zdd" | "pattern", amended, sections: { name: [{ verb,
// text, valid }] }, problems: [string] }. `problems` is the shape report;
// `valid: false` marks the lines that raised one, so a caller can count the
// rest (one typo never erases a commit).
export function parseRecord(message) {
  const lines = String(message).replace(/\r\n?/g, "\n").split("\n");
  const headings = [];
  for (let i = 0; i < lines.length; i++) if (HEADING.test(lines[i].trim())) headings.push(i);
  if (!headings.length) return null;
  const start = headings[0];
  const head = lines[start].trim().match(HEADING);
  const kind = head[1] === "ZDD record" ? "zdd" : "pattern";
  const amended = Boolean(head[2]);
  const sections = Object.fromEntries(SECTIONS.map((s) => [s, []]));
  const problems = [];
  if (headings.length > 1) problems.push(`more than one record heading (lines ${headings.map((h) => h + 1).join(", ")}) — one record per commit; only the first is read (CR-010)`);
  const seen = [];
  const sawNone = new Set();
  let current = kind === "pattern" ? "blessings" : null;
  const legalVerbs = (section) => (kind === "pattern" ? BLESSING_VERBS : section === "blessings" ? [...USE_VERBS.filter((v) => v !== "reused"), STORE_VERB, ...BLESSING_VERBS] : section === "map" ? [...USE_VERBS, STORE_VERB] : ["turned", "confirmed", STORE_VERB]);
  const push = (section, verb, text, valid) => sections[section].push({ verb, text, valid });
  // One forward index for the blank-line lookahead (CR-011): a run of blank
  // lines is scanned once, never re-sliced per line.
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) break;
      const t = lines[j].trim();
      const sec = t.match(SECTION_RE);
      if (!((sec && SECTIONS.includes(sec[1])) || t.startsWith("- "))) break;
      i = j;
      continue;
    }
    i++;
    const sec = line.match(SECTION_RE);
    if (sec) {
      if (kind === "pattern") break; // a pattern record has no sections; something else follows
      if (!SECTIONS.includes(sec[1])) {
        problems.push(`unknown section '${printable(sec[1])}' (the five are ${SECTIONS.join(", ")})`);
        current = null;
        continue;
      }
      if (seen.includes(sec[1])) problems.push(`section '${sec[1]}' appears twice`);
      seen.push(sec[1]);
      current = sec[1];
      continue;
    }
    if (!line.startsWith("- ")) {
      if (current === null && kind === "zdd" && seen.length === 0) problems.push(`a line before the first section: '${excerpt(line)}'`);
      if (!(current !== null && seen.length)) break;
      if (TRAILER_RE.test(line)) break;
      problems.push(`not a list line: '${excerpt(line)}'`);
      continue;
    }
    if (current === null) {
      problems.push(`a line outside any section: '${excerpt(line.slice(2))}'`);
      continue;
    }
    if (NONE_RE.test(line)) {
      if (kind === "pattern") {
        problems.push(`blessings: '- none' is not a pattern record line`);
        continue;
      }
      if (sawNone.has(current)) problems.push(`${current}: '- none' appears twice`);
      sawNone.add(current);
      continue;
    }
    const m = line.match(LINE_RE);
    if (!m) {
      const body = line.slice(2);
      const tried = ALL_VERBS.find((v) => body.toLowerCase().startsWith(v));
      problems.push(
        /^none\b/i.test(body)
          ? `${current}: '- none' takes no sentence: '${excerpt(body)}'`
          : tried
            ? `${current}: a line must read '- ${tried}: <sentence>': '${excerpt(body)}'`
            : `${current}: a line with no known verb: '${excerpt(body)}' (verbs: ${[...USE_VERBS, STORE_VERB].join(", ")}; under blessings also ${BLESSING_VERBS.join(", ")})`,
      );
      continue;
    }
    const [, verb, text] = m;
    let valid = true;
    if (!legalVerbs(current).includes(verb)) {
      valid = false;
      problems.push(
        verb === "reused"
          ? `${current}: 'reused' belongs under map only (decision 0027)`
          : BLESSING_VERBS.includes(verb)
            ? `${current}: '${verb}' is a blessings verb`
            : `${current}: '${verb}' is not a verb of this ${kind === "pattern" ? "pattern record (its verbs: " + BLESSING_VERBS.join(", ") + ")" : "section"}`,
      );
    } else if ((verb === "turned" || verb === "confirmed") && !COUNTERFACTUAL_MARKERS.some((re) => re.test(text))) {
      valid = false;
      problems.push(`${current}: '${verb}' says nothing of what would otherwise have happened: '${excerpt(text)}' — a line with no counterfactual is a read, not a use (decision 0027); it is left out of the tally`);
    }
    push(current, verb, text, valid);
  }
  if (kind === "zdd") {
    for (const s of SECTIONS) if (!seen.includes(s)) problems.push(`section '${s}' missing (all five are always present; '- none' when empty)`);
    const order = seen.filter((s) => SECTIONS.includes(s));
    const expected = SECTIONS.filter((s) => order.includes(s));
    if (order.join() !== expected.join()) problems.push(`sections out of order (${order.join(", ")}; the order is ${SECTIONS.join(", ")})`);
    for (const s of seen) {
      if (!SECTIONS.includes(s)) continue;
      const entries = sections[s].length;
      if (!entries && !sawNone.has(s)) problems.push(`${s}: empty — a section with nothing says '- none' (decision 0028)`);
      if (entries && sawNone.has(s)) problems.push(`${s}: '- none' beside ${entries} line${entries === 1 ? "" : "s"} — one or the other`);
    }
  }
  return { kind, amended, sections, problems };
}

// The `git log` format whose output `recordsInLog` reads: hash, NUL, body,
// NUL. NUL is the one byte a commit message cannot carry, so a message can
// never forge a second commit (CR-009).
export const LOG_FORMAT = "--format=%H%x00%B%x00";

// Split that output into commits, each with its record parsed (or null).
// Pure: the caller runs git. A SHA-1 hash is 40 hex characters, a SHA-256
// one 64 (CR-014).
export function recordsInLog(logText) {
  const out = [];
  const parts = String(logText).split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const hash = parts[i].trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)) {
      // Resynchronise on the next hash-shaped part rather than misreading
      // the stream as shifted by one.
      i--;
      continue;
    }
    const message = parts[i + 1];
    out.push({ hash, subject: (message.split("\n")[0] ?? "").trim(), message, record: parseRecord(message) });
  }
  return out;
}

// A matcher for one store item (a glossary term, a blessing's question),
// compiled once: whole-word, case-insensitive, with `_` part of a word so
// "thing" never credits "nothing" or "save_thing" (CR-012).
export function itemMatcher(needle) {
  const n = String(needle).trim();
  if (!n) return () => false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(n)}(?=$|[^\\p{L}\\p{N}_])`, "iu");
  return (text) => re.test(text);
}

// Which ADR numbers a record names, and a test for a store item, over the
// record's VALID lines only (a line the shape refused is a read, decision
// 0027; CR-001). ADRs by number anywhere in those lines.
export function namesIn(record) {
  const texts = SECTIONS.flatMap((s) => record.sections[s].filter((e) => e.valid).map((e) => e.text));
  const adrs = new Set();
  for (const t of texts) for (const m of t.matchAll(/\bADR[-\s]?0*(\d{1,4})\b/gi)) adrs.add(m[1].padStart(4, "0"));
  return { adrs, mentions: (matcher) => texts.some((t) => matcher(t)) };
}

// The terms a glossary defines: every `**Term**:` opener (authoring.md's
// shape), in file order, deduped.
export function glossaryTerms(text) {
  const seen = new Set();
  const out = [];
  for (const m of String(text).matchAll(/^\*\*([^*\n]+?)\*\*\s*[:—-]/gm)) {
    const term = m[1].trim();
    if (term && !seen.has(term)) {
      seen.add(term);
      out.push(term);
    }
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Every character class that can reorder, hide or spoof terminal output:
// C0/C1 controls, Unicode format characters (bidi overrides among them),
// line and paragraph separators (CR-013).
export const printable = (t) => String(t).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "?");
const excerpt = (t) => {
  const p = printable(t);
  return p.length > 60 ? p.slice(0, 59) + "…" : p;
};
