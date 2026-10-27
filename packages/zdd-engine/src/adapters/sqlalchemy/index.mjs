// sqlalchemy adapter — data access through raw SQL in Python (decision
// 0037), the shape SQLAlchemy's `text("…")` takes, and any driver's SQL
// string. One `data-access` record per Python function whose string literals
// hold SQL — its own, and those of the same-file functions it uses — keyed by
// file + function name (adapters/python/source.mjs cuts the functions), with
// each table the SQL names as an UNRESOLVED ref.
//
// A string literal is SQL when it holds one of the statement words SELECT,
// INSERT, UPDATE, DELETE or WITH. In it, SQL comments and single-quoted SQL
// literals are blanked first, and so are the arguments of EXTRACT, SUBSTRING,
// TRIM, OVERLAY and POSITION (their FROM is not a table). Then the relations
// after FROM and JOIN are read (a `reads` edge; FROM takes a comma list), and
// after INTO, UPDATE and DELETE FROM (a `writes` edge), each optionally
// schema-qualified and quoted part by part (`public."jobs"`), past ONLY and
// LATERAL. A name a WITH clause defines (a CTE) is not a table. Each is
// `?table:<name>`, so the deriver keeps only names the schema adapter
// minted: anything else matches nothing and is dropped, never invented. A
// table named only in a variable, or built up with f-string holes, is not
// seen — the same honesty as the other scanners. SQLAlchemy's ORM
// (`select(Job)`, `session.query(Job)`) is not read: a model class names its
// table in code this adapter does not resolve; say so on the map, or add an
// adapter for it.
// Options (extractorOptions.sqlalchemy):
//   roots        repo-relative files or directories to scan (default ["."])
//   excludeDirs  directory names skipped during the walk
// A missing root is "nothing to inventory" with a diagnostic, never an error.

import { repoRelative } from "../../core/lib/paths.mjs";
import { DEFAULT_EXCLUDE_DIRS, closeOver, dataAccessRecord, defs, pythonFiles, strings } from "../python/source.mjs";

export const FACTS_KEY_ORDER = {
  "data-access": ["function"],
};

const STATEMENT = /\b(?:select|insert|update|delete|with)\b/i;
// Words that follow a relation keyword without being a relation.
const NOT_TABLES = new Set(["select", "set", "values", "default", "where", "on", "using", "as"]);
const MODIFIERS = new Set(["only", "lateral"]);

// SQL with comments, single-quoted literals and the FROM-taking functions'
// arguments blanked to spaces; double-quoted identifiers are kept.
function maskSql(sql) {
  let out = "";
  for (let i = 0; i < sql.length; ) {
    if (sql.startsWith("--", i)) {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl;
      out += " ".repeat(end - i);
      i = end;
    } else if (sql.startsWith("/*", i)) {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? sql.length : close + 2;
      out += sql.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      const end = Math.min(j + 1, sql.length);
      out += sql.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
}

function blankFunctionArgs(sql) {
  const chars = [...sql];
  for (const m of sql.matchAll(/\b(?:extract|substring|trim|overlay|position)\s*\(/gi)) {
    let depth = 0;
    for (let k = m.index + m[0].length - 1; k < chars.length; k++) {
      if (chars[k] === "(") depth++;
      else if (chars[k] === ")" && --depth === 0) break;
      else if (depth > 0 && chars[k] !== "\n") chars[k] = " ";
    }
  }
  return chars.join("");
}

// One name part at `i`: a quoted identifier or a bare one. -> [name, next] | null
function namePart(sql, i) {
  if (sql[i] === '"') {
    const close = sql.indexOf('"', i + 1);
    return close === -1 ? null : [sql.slice(i + 1, close), close + 1];
  }
  const m = /^[A-Za-z_]\w*/.exec(sql.slice(i, i + 200));
  return m ? [m[0], i + m[0].length] : null;
}

const skipSpace = (sql, i) => {
  while (i < sql.length && /\s/.test(sql[i])) i++;
  return i;
};

// A relation at `i`, past ONLY / LATERAL: -> { name, next } | null. When
// `read` (after FROM / JOIN), a name followed by `(` is a function call. A
// subquery `(` or a word that is not a relation reads as none.
function relation(sql, i, read = false) {
  for (;;) {
    i = skipSpace(sql, i);
    const p = namePart(sql, i);
    if (!p) return null;
    if (sql[i] !== '"' && MODIFIERS.has(p[0].toLowerCase())) {
      i = p[1];
      continue;
    }
    if (sql[i] !== '"' && NOT_TABLES.has(p[0].toLowerCase())) return null;
    let name = p[0];
    let next = p[1];
    if (sql[next] === ".") {
      const q = namePart(sql, next + 1);
      if (q) {
        name = `${name}.${q[0]}`;
        next = q[1];
      }
    }
    if (read && sql[skipSpace(sql, next)] === "(") return null; // FROM `unnest(x)`: a function, not a table (INTO t (a, b) is a column list)
    return { name, next };
  }
}

// After a relation, its alias (`AS x` or a bare word) and then a comma, if
// FROM lists another: -> the index after the comma, or -1.
function nextInList(sql, i) {
  i = skipSpace(sql, i);
  const alias = /^(?:as\s+)?(?:"[^"]*"|[A-Za-z_]\w*)/i.exec(sql.slice(i, i + 200));
  const KEYWORD = /^(?:where|join|inner|left|right|full|cross|natural|on|using|group|order|limit|offset|union|returning|set|values|for|having|window)\b/i;
  if (alias && !KEYWORD.test(sql.slice(i, i + 20))) i = skipSpace(sql, i + alias[0].length);
  return sql[i] === "," ? i + 1 : -1;
}

// The tables one piece of SQL names: { reads, writes }, each a sorted list.
export function sqlTables(sql) {
  const text = blankFunctionArgs(maskSql(sql));
  const ctes = new Set();
  for (const m of text.matchAll(/(?:\bwith(?:\s+recursive)?|,)\s*(?:"([^"]+)"|([A-Za-z_]\w*))\s*(?:\([^)]*\)\s*)?as\s*(?:not\s+)?(?:materialized\s+)?\(/gi)) ctes.add((m[1] ?? m[2]).toLowerCase());
  const reads = new Set();
  const writes = new Set();
  const take = (set, rel) => {
    if (!rel) return;
    if (!rel.name.includes(".") && ctes.has(rel.name.toLowerCase())) return;
    set.add(rel.name);
  };
  const deleted = new Set();
  for (const m of text.matchAll(/\bdelete\s+from\b/gi)) {
    const rel = relation(text, m.index + m[0].length);
    take(writes, rel);
    deleted.add(m.index + m[0].length - 4); // the FROM of a DELETE FROM is a write, not a read
  }
  for (const m of text.matchAll(/\b(from|join)\b/gi)) {
    if (deleted.has(m.index)) continue;
    let at = m.index + m[0].length;
    for (let guard = 0; guard < 64; guard++) {
      const rel = relation(text, at, true);
      take(reads, rel);
      if (!rel || m[1].toLowerCase() !== "from") break;
      const more = nextInList(text, rel.next);
      if (more === -1) break;
      at = more;
    }
  }
  for (const m of text.matchAll(/\b(?:into|update)\b/gi)) take(writes, relation(text, m.index + m[0].length));
  return { reads: [...reads].sort(), writes: [...writes].sort() };
}

// One function's own SQL tables, tagged by direction ("r:jobs", "w:jobs").
function ownTables(fn) {
  const out = new Set();
  for (const s of strings(fn.body)) {
    if (!STATEMENT.test(s)) continue;
    const t = sqlTables(s);
    t.reads.forEach((n) => out.add(`r:${n}`));
    t.writes.forEach((n) => out.add(`w:${n}`));
  }
  return out;
}

export function derive({ options, io }) {
  const diagnostics = [];
  const { roots = ["."], excludeDirs = DEFAULT_EXCLUDE_DIRS } = options;
  if (!Array.isArray(roots)) throw new Error(`sqlalchemy: 'roots' must be an array of repo-relative paths`);
  if (!Array.isArray(excludeDirs)) throw new Error(`sqlalchemy: 'excludeDirs' must be an array of directory names`);
  const files = pythonFiles(io, roots.map((r) => repoRelative(r, "sqlalchemy.roots")), excludeDirs, diagnostics);
  const records = [];
  for (const rel of files) {
    const read = io.read(rel);
    if (!read.ok) {
      if (read.code !== "missing" && read.code !== "ignored") diagnostics.push(`${rel}: ${read.reason} — skipped`);
      continue;
    }
    // A function's tables are its own and those of every same-file function
    // it uses, the rule the route side follows (decision 0037).
    const fns = defs(read.text);
    const closed = closeOver(fns, ownTables);
    for (const fn of fns) {
      const tagged = [...closed.get(fn.name)];
      if (!tagged.length) continue;
      const reads = tagged.filter((t) => t.startsWith("r:")).map((t) => t.slice(2)).sort();
      const writes = tagged.filter((t) => t.startsWith("w:")).map((t) => t.slice(2)).sort();
      const ref = (n) => `?table:${n}`;
      const edges = {};
      if (reads.length) edges.reads = [...new Set(reads)].map(ref);
      if (writes.length) edges.writes = [...new Set(writes)].map(ref);
      records.push(dataAccessRecord("sqlalchemy", rel, fn, new Set([...reads, ...writes].map(ref)), edges));
    }
  }
  return { records, diagnostics };
}
