// Migration replay engine for the nextjs-supabase ZDD adapter.
//
// Replays a directory of SQL migrations IN ORDER into a mutable schema model
// (tables, functions, buckets), so the derived layer reflects the schema as it
// exists NOW — not the union of everything ever created. A naive CREATE TABLE
// grep is materially wrong for this repo: 00009 renames five survey_* tables,
// 00024 drops member_questions, 00012 drops columns. See zdd/spec.md §3.
//
// Deliberately NOT modeled (their truth is one grep away in the latest
// migration, and modeling them buys parser surface, not orientation):
// constraints (the node_type CHECK churns across 7 migrations), indexes,
// RLS, grants, policies, seed/backfill DML, DO blocks.
// Triggers ARE modeled (DIO-149): trigger functions' bodies never name their
// tables (`NEW.updated_at = now()`), so without CREATE TRIGGER the function
// records float with no edges — the relationship lives only in the trigger
// statement.

// ---------------------------------------------------------------------------
// Tokenizer: split SQL into statements on top-level `;`, tracking `--` line
// comments, `/* */` block comments, '...' strings (with '' escapes) and
// $tag$...$tag$ dollar-quoted bodies. Dollar-quote tracking is mandatory:
// plpgsql function bodies are full of internal semicolons.
// Leading comment lines seen since the previous statement are kept per
// statement — they become table/bucket descriptions.
// ---------------------------------------------------------------------------
export function tokenizeSql(text) {
  // Strip BOM.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const statements = [];
  let stmt = "";
  let comments = [];
  let pendingComment = "";
  let i = 0;
  const n = text.length;
  let state = "normal"; // normal | line-comment | block-comment | string | dollar
  let dollarTag = "";

  const flushStatement = () => {
    const sql = stmt.trim();
    if (sql) statements.push({ sql, leadingComments: comments });
    stmt = "";
    comments = [];
  };

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    if (state === "line-comment") {
      if (ch === "\n") {
        state = "normal";
        // Comments only count as "leading" while the statement buffer is
        // still blank; a trailing comment inside a statement is ignored.
        if (!stmt.trim()) comments.push(pendingComment);
        pendingComment = "";
      } else {
        pendingComment += ch;
      }
      i++;
      continue;
    }
    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        state = "normal";
        i += 2;
      } else i++;
      continue;
    }
    if (state === "string") {
      stmt += ch;
      if (ch === "'") {
        if (next === "'") {
          stmt += next;
          i += 2;
          continue;
        }
        state = "normal";
      }
      i++;
      continue;
    }
    if (state === "dollar") {
      if (ch === "$" && text.startsWith(dollarTag, i)) {
        stmt += dollarTag;
        i += dollarTag.length;
        state = "normal";
      } else {
        stmt += ch;
        i++;
      }
      continue;
    }

    // state === "normal"
    if (ch === "-" && next === "-") {
      state = "line-comment";
      pendingComment = "";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      state = "block-comment";
      i += 2;
      continue;
    }
    if (ch === "'") {
      state = "string";
      stmt += ch;
      i++;
      continue;
    }
    if (ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (m) {
        dollarTag = m[0];
        stmt += dollarTag;
        i += dollarTag.length;
        state = "dollar";
        continue;
      }
    }
    if (ch === ";") {
      flushStatement();
      i++;
      continue;
    }
    // A blank line between a comment block and the next content breaks the
    // "leading" association only if a statement already started; while the
    // buffer is blank we keep accumulating (banner blocks span blank-free runs
    // in this corpus, so no gap logic is needed).
    stmt += ch;
    i++;
  }
  flushStatement();
  return statements;
}

// ---------------------------------------------------------------------------
// Small SQL-text helpers
// ---------------------------------------------------------------------------

// Split `text` on top-level commas (ignoring commas nested in (), [] or '...').
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      cur += ch;
      if (ch === "'") {
        if (text[i + 1] === "'") {
          cur += "'";
          i++;
        } else inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      cur += ch;
    } else if (ch === "(" || ch === "[") {
      depth++;
      cur += ch;
    } else if (ch === ")" || ch === "]") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Extract the body of the first top-level (...) group starting at/after `from`.
function parenBody(text, from = 0) {
  const open = text.indexOf("(", from);
  if (open === -1) return null;
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'" && text[i + 1] !== "'") inString = false;
      else if (ch === "'" ) i++;
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i };
    }
  }
  return null;
}

// Postgres folds unquoted identifiers to lowercase; quoted stay verbatim.
function foldIdent(raw) {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t.toLowerCase();
}

// Column-constraint keywords that terminate a type expression. Multi-word
// types ("timestamp with time zone", "double precision") survive because none
// of their words appear here.
const TYPE_TERMINATORS = new Set([
  "primary", "not", "null", "default", "check", "references", "unique",
  "generated", "constraint", "collate",
]);

function parseColumnDef(def) {
  const tokens = def.trim().split(/\s+/);
  if (!tokens.length) return null;
  const first = tokens[0].toLowerCase();
  if (
    ["primary", "unique", "check", "constraint", "foreign", "exclude", "like"].includes(first)
  ) {
    return null; // table-level constraint, not a column
  }
  const name = foldIdent(tokens[0]);
  const typeTokens = [];
  for (let i = 1; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase();
    if (TYPE_TERMINATORS.has(lower)) break;
    typeTokens.push(tokens[i]);
  }
  const col = { name, type: typeTokens.join(" ").toLowerCase() };
  const ref = /references\s+([\w".]+)\s*\(\s*([\w"]+)\s*\)/i.exec(def);
  if (ref) col.references = `${foldIdent(ref[1])}(${foldIdent(ref[2])})`;
  return col;
}

// Comment-block -> description: drop banner lines (`====`) and file-path
// echoes (this repo's migrations open with `-- supabase/migrations/000NN_x.sql`),
// join the rest.
export function commentsToDescription(comments) {
  return comments
    .map((c) => c.trim())
    .filter((c) => c && !/^=+$/.test(c) && !/^[\w./-]*migrations\/[\w./-]+\.sql$/.test(c))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

// files: [{ name, text }] already sorted into apply order by the caller.
// Returns { tables: Map, functions: Map, buckets: Map, triggers: [], skipped: [] }.
// `skipped` lists statements that LOOK like schema changes (CREATE TABLE /
// ALTER TABLE / DROP ...) but matched no recognizer — the tripwire against
// silently missing a schema mutation.
export function replayMigrations(files) {
  const tables = new Map();
  const functions = new Map();
  const buckets = new Map();
  const triggers = []; // { name, timing, events, table, fn }
  const skipped = [];

  for (const file of files) {
    for (const { sql, leadingComments } of tokenizeSql(file.text)) {
      const head = sql.replace(/\s+/g, " ").slice(0, 200);

      let m;
      // CREATE TABLE
      if ((m = /^create\s+table\s+(?:if\s+not\s+exists\s+)?([\w".]+)/i.exec(sql))) {
        const name = foldIdent(m[1]);
        const paren = parenBody(sql, m[0].length);
        if (!paren) {
          skipped.push({ file: file.name, statement: head });
          continue;
        }
        const columns = [];
        for (const def of splitTopLevel(paren.body)) {
          const col = parseColumnDef(def);
          if (col) columns.push(col);
        }
        tables.set(name, {
          name,
          columns,
          renamedFrom: [],
          createdIn: file.name,
          resources: [file.name],
          description: commentsToDescription(leadingComments),
        });
        continue;
      }

      // ALTER TABLE
      if ((m = /^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w".]+)\s+([\s\S]+)$/i.exec(sql))) {
        const name = foldIdent(m[1]);
        const table = tables.get(name);
        // Unknown table (e.g. storage.objects) — not ours to model.
        if (!table) continue;
        let touched = false;
        for (const action of splitTopLevel(m[2])) {
          let a;
          if ((a = /^rename\s+to\s+([\w".]+)$/i.exec(action))) {
            const newName = foldIdent(a[1]);
            const oldName = table.name;
            table.renamedFrom.push(oldName);
            table.name = newName;
            tables.delete(name);
            tables.set(newName, table);
            // Sweep FK references in every table: `references old(col)` must
            // follow the rename or the FK graph silently rots (00009 renames
            // surveys -> journeys while journey_edges still points at surveys).
            for (const other of tables.values()) {
              for (const col of other.columns) {
                if (col.references?.startsWith(`${oldName}(`)) {
                  col.references = `${newName}(${col.references.slice(oldName.length + 1)}`;
                }
              }
            }
            for (const t of triggers) if (t.table === oldName) t.table = newName;
            touched = true;
          } else if ((a = /^rename\s+(?:column\s+)?([\w"]+)\s+to\s+([\w"]+)$/i.exec(action))) {
            const col = table.columns.find((c) => c.name === foldIdent(a[1]));
            if (col) col.name = foldIdent(a[2]);
            touched = true;
          } else if ((a = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]+)$/i.exec(action))) {
            const col = parseColumnDef(a[1]);
            if (col && !table.columns.some((c) => c.name === col.name)) {
              table.columns.push(col);
              touched = true;
            }
          } else if ((a = /^drop\s+column\s+(?:if\s+exists\s+)?([\w"]+)/i.exec(action))) {
            const colName = foldIdent(a[1]);
            table.columns = table.columns.filter((c) => c.name !== colName);
            touched = true;
          } else if ((a = /^alter\s+(?:column\s+)?([\w"]+)\s+(?:set\s+data\s+)?type\s+([\w\s()\[\]]+)/i.exec(action))) {
            const col = table.columns.find((c) => c.name === foldIdent(a[1]));
            if (col) col.type = a[2].trim().toLowerCase();
            touched = true;
          }
          // All other actions (ADD/DROP CONSTRAINT, SET DEFAULT, ENABLE/DISABLE
          // ROW LEVEL SECURITY, VALIDATE, ...) are deliberately ignored.
        }
        if (touched) {
          const current = tables.get(table.name);
          if (current && !current.resources.includes(file.name)) current.resources.push(file.name);
        }
        continue;
      }

      // DROP TABLE
      if ((m = /^drop\s+table\s+(?:if\s+exists\s+)?([\s\S]+)$/i.exec(sql))) {
        for (const rawName of splitTopLevel(m[1])) {
          const name = foldIdent(rawName.replace(/\s+(cascade|restrict)\s*$/i, ""));
          tables.delete(name);
          for (let i = triggers.length - 1; i >= 0; i--) if (triggers[i].table === name) triggers.splice(i, 1);
        }
        continue;
      }

      // CREATE [OR REPLACE] FUNCTION — upsert by NAME (last definition wins;
      // save_journey_graph is redefined across 6+ migrations). Overload
      // coexistence would be invisible here; acceptable for orientation.
      if ((m = /^create\s+(?:or\s+replace\s+)?function\s+([\w".]+)/i.exec(sql))) {
        const name = foldIdent(m[1]);
        const paren = parenBody(sql, m[0].length);
        const args = paren ? paren.body.replace(/\s+/g, " ").trim() : "";
        const returns = /returns\s+((?:setof\s+)?[\w".\[\]]+)/i.exec(sql);
        const language = /language\s+([\w"]+)/i.exec(sql);
        const existing = functions.get(name);
        const resources = existing ? existing.resources : [];
        if (!resources.includes(file.name)) resources.push(file.name);
        functions.set(name, {
          name,
          signature: args,
          returns: returns ? returns[1].toLowerCase() : "",
          language: language ? foldIdent(language[1]) : "",
          resources,
          description: commentsToDescription(leadingComments),
          // Raw statement text (kept for the function->table ref scan; the
          // last definition's body is the one that matters).
          body: sql,
        });
        continue;
      }

      // DROP FUNCTION — by name, signature ignored (00009 drops both
      // save_survey_graph overloads this way). Its triggers die with it
      // (Postgres would have required CASCADE or a prior DROP TRIGGER anyway).
      if ((m = /^drop\s+function\s+(?:if\s+exists\s+)?([\w".]+)/i.exec(sql))) {
        const name = foldIdent(m[1]);
        functions.delete(name);
        for (let i = triggers.length - 1; i >= 0; i--) if (triggers[i].fn === name) triggers.splice(i, 1);
        continue;
      }

      // CREATE TRIGGER — trigger statements span lines, so this recognizer
      // works statement-wise (the tokenizer already joined them). Only the
      // orientation facts are kept: timing, events, table, function.
      if ((m = /^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+([\w"]+)[\s\S]*?\b(before|after|instead\s+of)\s+([\s\S]*?)\s+on\s+([\w".]+)[\s\S]*?\bexecute\s+(?:function|procedure)\s+([\w".]+)/i.exec(sql))) {
        const name = foldIdent(m[1]);
        const table = foldIdent(m[4]);
        // CREATE OR REPLACE (PG14+) / re-run idempotency: same name+table replaces.
        const existingIdx = triggers.findIndex((t) => t.name === name && t.table === table);
        if (existingIdx !== -1) triggers.splice(existingIdx, 1);
        triggers.push({
          name,
          timing: m[2].replace(/\s+/g, " ").toLowerCase(),
          events: m[3].split(/\s+or\s+/i).map((e) => e.trim().replace(/\s+/g, " ").toLowerCase()),
          table,
          fn: foldIdent(m[5]),
        });
        continue;
      }

      // DROP TRIGGER name ON table
      if ((m = /^drop\s+trigger\s+(?:if\s+exists\s+)?([\w"]+)\s+on\s+([\w".]+)/i.exec(sql))) {
        const name = foldIdent(m[1]);
        const table = foldIdent(m[2]);
        for (let i = triggers.length - 1; i >= 0; i--) {
          if (triggers[i].name === name && triggers[i].table === table) triggers.splice(i, 1);
        }
        continue;
      }

      // INSERT INTO storage.buckets — positional literal extraction from the
      // first VALUES tuple; non-literal values are simply omitted from facts.
      if ((m = /^insert\s+into\s+storage\.buckets\s*\(([^)]*)\)\s*values\s*/i.exec(sql))) {
        const cols = m[1].split(",").map((c) => foldIdent(c));
        const tuple = parenBody(sql, m.index + m[0].length - 1);
        if (!tuple) {
          skipped.push({ file: file.name, statement: head });
          continue;
        }
        const values = splitTopLevel(tuple.body);
        const raw = {};
        cols.forEach((c, idx) => (raw[c] = values[idx]));
        const lit = (v) => {
          if (v === undefined) return undefined;
          const t = v.trim();
          if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
          if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
          if (/^\d+$/.test(t)) return Number(t);
          const arr = /^array\s*\[([\s\S]*)\]$/i.exec(t);
          if (arr) return splitTopLevel(arr[1]).map((x) => lit(x)).filter((x) => x !== undefined);
          return undefined;
        };
        const id = lit(raw.id) ?? lit(raw.name);
        if (!id) {
          skipped.push({ file: file.name, statement: head });
          continue;
        }
        const bucket = { id, resource: [file.name], description: commentsToDescription(leadingComments), facts: {} };
        const pub = lit(raw.public);
        const size = lit(raw.file_size_limit);
        const mimes = lit(raw.allowed_mime_types);
        if (pub !== undefined) bucket.facts.public = pub;
        if (size !== undefined) bucket.facts.fileSizeLimit = size;
        if (mimes !== undefined) bucket.facts.allowedMimeTypes = mimes;
        buckets.set(id, bucket);
        continue;
      }

      // Tripwire: unmatched statements that smell like schema changes.
      if (/^(create\s+table|alter\s+table|drop\s+)/i.test(sql)) {
        skipped.push({ file: file.name, statement: head });
      }
    }
  }

  return { tables, functions, buckets, triggers, skipped };
}

// Apply-order sort: numeric value of the leading digit run first, filename as
// tiebreak. Agrees with the Supabase CLI's lexicographic version ordering for
// this corpus (the timestamp-named 20260412000003_* file sorts last both
// ways), and stays correct if an unpadded prefix ever appears.
export function sortMigrations(names) {
  return [...names].sort((a, b) => {
    const na = Number(/^\d+/.exec(a)?.[0] ?? Infinity);
    const nb = Number(/^\d+/.exec(b)?.[0] ?? Infinity);
    if (na !== nb) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
