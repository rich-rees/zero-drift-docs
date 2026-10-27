// sqlalchemy adapter — data access through raw SQL in Python (decision
// 0037), the shape SQLAlchemy's `text("…")` takes, and any driver's SQL
// string. One `data-access` record per Python function whose string literals
// hold SQL, keyed by file + function name (adapters/python/source.mjs cuts
// the functions), with each table the SQL names as an UNRESOLVED ref.
//
// A string literal is SQL when it holds one of the statement words SELECT,
// INSERT, UPDATE, DELETE or WITH. In it, the identifier after FROM or JOIN is
// read (a `reads` edge), and after INTO, UPDATE or DELETE FROM is written (a
// `writes` edge), optionally schema-qualified (`public.jobs`) and quoted
// (`"jobs"`). Each is `?table:<name>`, so the deriver keeps only names the
// schema adapter minted: a word after FROM that is no table (`EXTRACT(EPOCH
// FROM created_at)`, a subquery alias, a CTE name) matches nothing and is
// dropped, never invented. A table named only in a variable, or built up
// with f-string holes, is not seen — the same honesty as the other scanners.
// SQLAlchemy's ORM (`select(Job)`, `session.query(Job)`) is not read: a
// model class names its table in code this adapter does not resolve; say
// so on the map, or add an adapter for it.
// Options (extractorOptions.sqlalchemy):
//   roots        repo-relative files or directories to scan (default ["."])
//   excludeDirs  directory names skipped during the walk
// A missing root is "nothing to inventory" with a diagnostic, never an error.

import { repoRelative } from "../../core/lib/paths.mjs";
import { DEFAULT_EXCLUDE_DIRS, dataAccessRecord, defs, pythonFiles, strings } from "../python/source.mjs";

export const FACTS_KEY_ORDER = {
  "data-access": ["function"],
};

const STATEMENT = /\b(?:select|insert|update|delete|with)\b/i;
const IDENT = String.raw`("?)((?:[A-Za-z_]\w*\1\.\1)?[A-Za-z_]\w*)\1`;
const READS = new RegExp(String.raw`\b(?:from|join)\s+${IDENT}`, "gi");
const WRITES = new RegExp(String.raw`\b(?:into|update)\s+${IDENT}`, "gi");
const DELETE_FROM = new RegExp(String.raw`\bdelete\s+from\s+${IDENT}`, "gi");
// Words that follow FROM/JOIN/INTO/UPDATE in SQL without being a table.
const NOT_TABLES = new Set(["select", "lateral", "only", "unnest", "set", "values", "default", "the"]);

// The tables one piece of SQL names: { reads, writes }, each a sorted list.
export function sqlTables(sql) {
  const reads = new Set();
  const writes = new Set();
  const name = (m) => m[2].replace(/"/g, "");
  const ok = (n) => !NOT_TABLES.has(n.toLowerCase());
  const deleted = new Set();
  for (const m of sql.matchAll(DELETE_FROM)) if (ok(name(m))) {
    writes.add(name(m));
    deleted.add(m.index + m[0].length);
  }
  for (const m of sql.matchAll(READS)) {
    if (deleted.has(m.index + m[0].length)) continue; // the FROM of a DELETE FROM is a write
    if (ok(name(m))) reads.add(name(m));
  }
  for (const m of sql.matchAll(WRITES)) if (ok(name(m))) writes.add(name(m));
  return { reads: [...reads].sort(), writes: [...writes].sort() };
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
    for (const fn of defs(read.text)) {
      const reads = new Set();
      const writes = new Set();
      for (const s of strings(fn.body)) {
        if (!STATEMENT.test(s)) continue;
        const t = sqlTables(s);
        t.reads.forEach((n) => reads.add(n));
        t.writes.forEach((n) => writes.add(n));
      }
      if (!reads.size && !writes.size) continue;
      const ref = (n) => `?table:${n}`;
      const edges = {};
      if (reads.size) edges.reads = [...reads].sort().map(ref);
      if (writes.size) edges.writes = [...writes].sort().map(ref);
      records.push(dataAccessRecord("sqlalchemy", rel, fn, new Set([...reads, ...writes].map(ref)), edges));
    }
  }
  return { records, diagnostics };
}
