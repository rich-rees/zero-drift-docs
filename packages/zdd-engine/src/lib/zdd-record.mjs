// The ZDD record (decision 0028): the block "update ZDD" writes into the
// update commit's message, under a `ZDD record:` heading — five fixed
// sections, always all five, each a list of lines that open with a fixed
// verb and continue in a plain sentence. The verbs are what `tally` counts;
// the sentence is for the reviewer. A `Pattern record:` (2.0–2.3, decision
// 0015) is read as the `blessings` section alone, so history is neither lost
// nor inflated.
//
// Shape only is checked here (decision 0029): whether a sentence is true
// stays with the reviewer. Nothing in this module runs git; `recordsInLog`
// takes the text `git log` produced.

export const SECTIONS = ["glossary", "adrs", "blessings", "map", "comments"];
export const USE_VERBS = ["turned", "confirmed", "reused"];
export const STORE_VERB = "stored";
// The blessing verbs the pattern record already had (decision 0015), kept
// unchanged so no adopter's history or host harness breaks.
export const BLESSING_VERBS = ["followed", "departed", "minted", "dropped candidate", "precedent", "no blessing applied"];
export const NONE = "none";

// A `turned` or `confirmed` line must say what would otherwise have
// happened (decision 0027): one of these, anywhere in the sentence, is the
// shape check's whole test for that. Loose on purpose — the lint warns,
// never fails, and a false "no counterfactual" costs one line of stderr.
export const COUNTERFACTUAL_MARKERS = [/\bwould\b/i, /\babout to\b/i, /\binstead\b/i, /\botherwise\b/i, /\brather than\b/i, /\bdid not\b/i, /\bdidn't\b/i, /\bnot\b/i, /\bkept\b/i, /\brenamed\b/i, /\bchanged\b/i];

export const HEADING = /^(ZDD record|Pattern record)(\s*\(amended\))?:\s*$/;

const VERBS_LONGEST_FIRST = [...new Set([...USE_VERBS, STORE_VERB, ...BLESSING_VERBS, NONE])].sort((a, b) => b.length - a.length);

// Parse one commit message. Returns null when it carries no record heading;
// otherwise { kind: "zdd" | "pattern", amended, sections: { name: [{ verb,
// text }] }, problems: [string] }. `problems` is the shape report; a record
// with problems still has its parseable lines counted, so one typo does not
// erase a commit from the tally.
export function parseRecord(message) {
  const lines = String(message).replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => HEADING.test(l.trim()));
  if (start === -1) return null;
  const head = lines[start].trim().match(HEADING);
  const kind = head[1] === "ZDD record" ? "zdd" : "pattern";
  const amended = Boolean(head[2]);
  const sections = Object.fromEntries(SECTIONS.map((s) => [s, []]));
  const problems = [];
  const seen = [];
  let current = kind === "pattern" ? "blessings" : null;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      // A blank line ends the block — unless the record is simply spaced
      // out and the next non-blank line is still a section or an entry.
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (next === undefined) break;
      const t = next.trim();
      if (!(/^[a-z]+:$/.test(t) && SECTIONS.includes(t.slice(0, -1))) && !t.startsWith("- ")) break;
      continue;
    }
    const sec = line.match(/^([a-z][a-z-]*):$/);
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
      // Anything else (a trailer, prose after the record) ends the block.
      if (!(current !== null && seen.length)) break;
      if (/^[A-Z][A-Za-z-]+: /.test(line)) break; // a git trailer (Co-Authored-By: …)
      problems.push(`not a list line: '${excerpt(line)}'`);
      continue;
    }
    const body = line.slice(2).trim();
    if (current === null) {
      problems.push(`a line outside any section: '${excerpt(body)}'`);
      continue;
    }
    const verb = VERBS_LONGEST_FIRST.find((v) => body === v || body.startsWith(v + ":") || (v === NONE && body.startsWith(v + " ")));
    if (!verb) {
      problems.push(`${current}: a line with no known verb: '${excerpt(body)}' (verbs: ${[...USE_VERBS, STORE_VERB].join(", ")}; under blessings also ${BLESSING_VERBS.join(", ")})`);
      continue;
    }
    const text = body.slice(verb.length + 1).trim();
    if (verb === NONE) {
      if (text) problems.push(`${current}: '- none' takes no sentence`);
      continue;
    }
    if (BLESSING_VERBS.includes(verb) && current !== "blessings") problems.push(`${current}: '${verb}' is a blessings verb`);
    if (verb === "reused" && current !== "map") problems.push(`${current}: 'reused' belongs under map only (decision 0027)`);
    if (!text) problems.push(`${current}: '${verb}' with no sentence after it`);
    else if ((verb === "turned" || verb === "confirmed") && !COUNTERFACTUAL_MARKERS.some((re) => re.test(text))) {
      problems.push(`${current}: '${verb}' says nothing of what would otherwise have happened: '${excerpt(text)}' — a line with no counterfactual is a read, not a use (decision 0027)`);
    }
    sections[current].push({ verb, text });
  }
  if (kind === "zdd") {
    for (const s of SECTIONS) if (!seen.includes(s)) problems.push(`section '${s}' missing (all five are always present; '- none' when empty)`);
    const order = seen.filter((s) => SECTIONS.includes(s));
    const expected = SECTIONS.filter((s) => order.includes(s));
    if (order.join() !== expected.join()) problems.push(`sections out of order (${order.join(", ")}; the order is ${SECTIONS.join(", ")})`);
  }
  return { kind, amended, sections, problems };
}

// Split the text of `git log --format=%H%x1f%B%x1e` into commits, each with
// its record parsed (or null). Pure: the caller runs git.
export function recordsInLog(logText) {
  const out = [];
  for (const chunk of String(logText).split("\x1e")) {
    const sep = chunk.indexOf("\x1f");
    if (sep === -1) continue;
    const hash = chunk.slice(0, sep).trim();
    if (!/^[0-9a-f]{7,40}$/.test(hash)) continue;
    const message = chunk.slice(sep + 1);
    out.push({ hash, subject: (message.split("\n")[0] ?? "").trim(), message, record: parseRecord(message) });
  }
  return out;
}

// Which ADR numbers, glossary terms and blessing questions a record names,
// for the tally's "never named" list (decision 0029). ADRs by number anywhere
// in the record; a term or a question when its text appears in any line,
// case-insensitively, as a whole (a question's wording is distinctive; a
// term is matched on word boundaries so "thing" never credits "nothing" or
// "save_thing").
export function namesIn(record) {
  const texts = SECTIONS.flatMap((s) => record.sections[s].map((e) => e.text));
  const adrs = new Set();
  for (const t of texts) for (const m of t.matchAll(/\bADR[-\s]?0*(\d{1,4})\b/gi)) adrs.add(m[1].padStart(4, "0"));
  const mentions = (needle) => {
    const n = needle.trim();
    if (!n) return false;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(n)}(?=$|[^\\p{L}\\p{N}_])`, "iu");
    return texts.some((t) => re.test(t));
  };
  return { adrs, mentions };
}

// The terms a glossary defines: every `**Term**:` opener (authoring.md's
// shape), in file order, deduped.
export function glossaryTerms(text) {
  const out = [];
  for (const m of String(text).matchAll(/^\*\*([^*\n]+?)\*\*\s*[:—-]/gm)) {
    const term = m[1].trim();
    if (term && !out.includes(term)) out.push(term);
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const printable = (t) => String(t).replace(/[\x00-\x1f\x7f]/g, "?");
const excerpt = (t) => {
  const p = printable(t);
  return p.length > 60 ? p.slice(0, 59) + "…" : p;
};
