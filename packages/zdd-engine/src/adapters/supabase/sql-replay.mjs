// Migration replay engine for the supabase ZDD extractor.
//
// Replays a directory of SQL migrations IN ORDER into a mutable schema model
// (tables, functions, buckets), so the derived layer reflects the schema as it
// exists NOW — not the union of everything ever created. A naive CREATE TABLE
// grep is materially wrong for this repo: 00009 renames five survey_* tables,
// 00024 drops member_questions, 00012 drops columns. See zdd/spec.md §3.
//
// Deliberately NOT modeled (their truth is one grep away in the latest
// migration, and modeling them buys parser surface, not orientation):
// constraints other than foreign keys (the node_type CHECK churns across 7
// migrations), indexes, RLS, grants, policies, seed/backfill DML. What is in a
// DO block is judged, and only its foreign keys are ever applied (judgeDo
// below). What LOOKS like a change to the model and was not applied is
// reported, never dropped (decision 0048 point 5).
// Triggers ARE modeled: trigger functions' bodies never name their
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

  // Postgres reads a comment as whitespace: two words it stood between stay two.
  const endComment = (at) => {
    if (/\w$/.test(stmt) && /\w/.test(text[at] ?? "")) stmt += " ";
  };

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
        endComment(i + 1);
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
        endComment(i);
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

// An identifier and a qualified name, as regex source: quoted (spaces and
// all) or plain, where $ and any letter past ASCII are as good as \w. A name
// with a dot inside its quotes is not one here: every name is held as one
// string with its schema before the first dot, so that table could not be told
// from a qualified one. Its statement matches nothing and reports.
const IDENT = '(?:"(?:[^".]|"")+"|[\\w$\\u0080-\\uffff]+)';
const QNAME = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`;
const QUOTED_COLUMN = /^"(?:[^"]|"")+"/;
const REFERENCES = new RegExp(`\\breferences\\s+(${QNAME})\\s*(?:\\(\\s*(${IDENT})\\s*\\))?`, "i");
const NAMED_REFERENCE = new RegExp(`\\bconstraint\\s+(${IDENT})\\s+references\\b`, "i");
const FOREIGN_KEY = new RegExp(`^(?:constraint\\s+(${IDENT})\\s+)?foreign\\s+key\\s*\\(([^)]*)\\)\\s*references\\s+(${QNAME})\\s*(?:\\(([^)]*)\\))?`, "i");
// Another engine's quoting at the start of a column definition.
const QUOTED_ELSEWHERE = /^\s*[`[]/;

// Postgres folds unquoted identifiers to lowercase; quoted stay verbatim, each
// part of a qualified name on its own.
function foldIdent(raw) {
  return (raw.match(/"(?:[^"]|"")+"|[^."\s]+/g) ?? [raw.trim()])
    .map((part) => (part.startsWith('"') ? part.slice(1, -1).replace(/""/g, '"') : part.toLowerCase()))
    .join(".");
}

// Column-constraint keywords that terminate a type expression. Multi-word
// types ("timestamp with time zone", "double precision") survive because none
// of their words appear here.
const TYPE_TERMINATORS = new Set([
  "primary", "not", "null", "default", "check", "references", "unique",
  "generated", "constraint", "collate",
]);

function parseColumnDef(def) {
  const text = def.trim();
  // The first word; only a quoted name may hold a space, and a table constraint
  // may meet its bracket with none: `UNIQUE(a, b)`.
  const written = QUOTED_COLUMN.exec(text)?.[0] ?? text.split(/\s+/)[0];
  if (!written) return null;
  const first = written.split("(")[0].toLowerCase();
  if (
    ["primary", "unique", "check", "constraint", "foreign", "exclude", "like"].includes(first)
  ) {
    return null; // table-level constraint, not a column
  }
  const name = foldIdent(written);
  const tokens = text.slice(written.length).trim().split(/\s+/);
  const typeTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase();
    if (TYPE_TERMINATORS.has(lower)) break;
    typeTokens.push(tokens[i]);
  }
  const col = { name, type: typeTokens.join(" ").toLowerCase() };
  // With no column named, a reference is to the target's primary key.
  const ref = REFERENCES.exec(blankStrings(text.slice(written.length)));
  if (ref) col.references = refTo(foldIdent(ref[1]), ref[2] && foldIdent(ref[2]));
  return col;
}

// A string is text, in either way of writing one.
function blankStrings(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''");
}

// The name Postgres gives an unnamed constraint: at most 63 characters, the
// longer of the two parts giving way first.
function constraintName(name1, name2, label) {
  let [n1, n2] = [name1.length, name2.length];
  const room = 63 - label.length - 2;
  while (n1 + n2 > room) {
    if (n1 > n2) n1--;
    else n2--;
  }
  return `${name1.slice(0, n1)}_${name2.slice(0, n2)}_${label}`;
}

const refTo = (table, column) => (column ? `${table}(${column})` : table);

// `[CONSTRAINT name] FOREIGN KEY (a, b) REFERENCES t (x, y)`, or null.
function readForeignKey(text) {
  const m = FOREIGN_KEY.exec(text.trim());
  if (!m) return null;
  const list = (s) => splitTopLevel(s).map(foldIdent);
  return { name: m[1] ? foldIdent(m[1]) : null, columns: list(m[2]), target: foldIdent(m[3]), targetColumns: m[4] ? list(m[4]) : [] };
}

// A literal in a bucket's statement; undefined when it is anything else. An
// array of arrays is not one, and an element that is not one spoils the array.
function literal(v, nested = false) {
  if (v === undefined) return undefined;
  const t = v.trim().replace(/::[\w\s[\]]+$/, "");
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (/^\d+$/.test(t)) return Number(t);
  const arr = nested ? null : /^array\s*\[([\s\S]*)\]$/i.exec(t);
  if (!arr) return undefined;
  const items = splitTopLevel(arr[1]).map((x) => literal(x, true));
  return items.includes(undefined) ? undefined : items;
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
// One table, two spellings: Postgres resolves a bare name through
// search_path, `public` by default, so `things` and `public.things` are the
// same table and a migration may use either (the first adopter does, 2.1.1). The
// tables map is keyed by tableKey(); a table's `name` stays as first
// written (as renamed), so record ids never change with the spelling of a
// later statement. Any other schema is another table.
export const tableKey = (name) => (name.startsWith("public.") ? name.slice("public.".length) : name);
const sameTable = (a, b) => tableKey(a) === tableKey(b);
const schemaOf = (name) => (name.includes(".") ? name.slice(0, name.indexOf(".")) : null);
const bareName = (name) => (name.includes(".") ? name.slice(name.indexOf(".") + 1) : name);

// Schemas Postgres and the platform own. A migration may reach into them
// (`alter table storage.objects …`, a trigger on `auth.users`) and they are
// never created here, so a table in one that the history never made is not a
// gap in the read.
const PLATFORM_SCHEMAS = new Set([
  "auth", "storage", "realtime", "vault", "pgsodium", "pgsodium_masks", "extensions", "graphql", "graphql_public",
  "net", "cron", "pgmq", "pgbouncer", "supabase_functions", "supabase_migrations", "_realtime", "_analytics",
  "pg_catalog", "information_schema",
]);
const notOurs = (name) => PLATFORM_SCHEMAS.has(schemaOf(name));

// A `drop` of something the model does not hold (indexes, policies and the
// rest are deliberately outside it, see the top of this file) changes no
// table. Everything else a `drop` can name stays on the tripwire.
const QUIET_DROP = /^drop\s+(index|policy|view|materialized\s+view|sequence|type|domain|extension|role|user|group|publication|subscription|event\s+trigger|aggregate|operator|cast|collation|rule|statistics|server|foreign\s+data\s+wrapper|text\s+search|language|tablespace|transform)\b/i;
const DROPS_COLUMNS = /^drop\s+(type|domain)\b[\s\S]*\bcascade\b/i; // takes the columns of that type with it
const TRIPWIRE = /^(create\s+(?:(?:global|local)\s+)?(?:unlogged\s+|foreign\s+)?table|alter\s+(?:foreign\s+)?table|alter\s+(?:function|procedure|routine|schema)|rename\s+table|create\s+(?:or\s+replace\s+)?(?:function|procedure)\s|create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger|(?:exec(?:ute)?\s+)?\S*sp_rename\b|drop\s)/i;

// One action of an ALTER TABLE: what it does to the model, or "ignored" when
// the model holds nothing it changes, or "unknown". `unknown` is what the
// tripwire is for: an action nobody listed may well be a schema change.
const IGNORED_ACTION = /^(enable|disable|force|no\s+force|validate|owner\s+to|replica\s+identity|cluster\s+on|set\s+without|set\s*\(|reset\s*\(|set\s+tablespace|set\s+access|set\s+logged|set\s+unlogged|inherit|no\s+inherit|attach\s+partition|detach\s+partition|of\b|not\s+of\b)/i;
const ALTER_COLUMN_IGNORED = new RegExp(`^alter\\s+(?:column\\s+)?(${IDENT})\\s+(?:set|drop|add|reset|restart)\\b`, "i");
const RENAME_TO = new RegExp(`^rename\\s+to\\s+(${QNAME})$`, "i");
const RENAME_COLUMN = new RegExp(`^rename\\s+(?:column\\s+)?(${IDENT})\\s+to\\s+(${IDENT})$`, "i");
const SET_SCHEMA = new RegExp(`^set\\s+schema\\s+(${IDENT})$`, "i");
const DROP_COLUMN = new RegExp(`^drop\\s+(?:column\\s+)?(if\\s+exists\\s+)?(${IDENT})(?:\\s+(?:cascade|restrict))?$`, "i");
const ALTER_TYPE = new RegExp(`^alter\\s+(?:column\\s+)?(${IDENT})\\s+(?:set\\s+data\\s+)?type\\s+([\\s\\S]+)$`, "i");
const RENAME_CONSTRAINT = new RegExp(`^rename\\s+constraint\\s+(${IDENT})\\s+to\\s+(${IDENT})$`, "i");
const DROP_CONSTRAINT = new RegExp(`^drop\\s+constraint\\s+(?:if\\s+exists\\s+)?(${IDENT})`, "i");
function readAction(action) {
  let a;
  if ((a = RENAME_TO.exec(action))) return { kind: "rename-table", to: foldIdent(a[1]) };
  if ((a = SET_SCHEMA.exec(action))) return { kind: "set-schema", schema: foldIdent(a[1]) };
  if ((a = RENAME_CONSTRAINT.exec(action))) return { kind: "rename-constraint", from: foldIdent(a[1]), to: foldIdent(a[2]) };
  if (IGNORED_ACTION.test(action)) return { kind: "ignored" };
  if ((a = RENAME_COLUMN.exec(action))) return { kind: "rename-column", from: foldIdent(a[1]), to: foldIdent(a[2]) };
  if (/^add\s+(index|key|fulltext|spatial)\b/i.test(action)) return { kind: "unknown" };
  if ((a = /^add\s+(?:column\s+)?(if\s+not\s+exists\s+)?([\s\S]+)$/i.exec(action))) {
    if (QUOTED_ELSEWHERE.test(a[2])) return { kind: "unknown" };
    const fk = readForeignKey(a[2]);
    if (fk) return { kind: "add-foreign-key", fk };
    const col = parseColumnDef(a[2]);
    return col ? { kind: "add-column", col, def: a[2], guarded: Boolean(a[1]) } : { kind: "ignored" };
  }
  if ((a = DROP_CONSTRAINT.exec(action))) return { kind: "drop-constraint", name: foldIdent(a[1]) };
  if (/^drop\s+(index|key|primary\s+key|foreign\s+key|check)\b/i.test(action)) return { kind: "ignored" };
  if ((a = DROP_COLUMN.exec(action))) return { kind: "drop-column", name: foldIdent(a[2]), guarded: Boolean(a[1]) };
  if ((a = ALTER_TYPE.exec(action))) return { kind: "alter-type", name: foldIdent(a[1]), type: a[2].replace(/\s+(?:using|collate)\b[\s\S]*$/i, "").replace(/\s+/g, " ").trim().toLowerCase() };
  if ((a = ALTER_COLUMN_IGNORED.exec(action))) return { kind: "ignored", column: foldIdent(a[1]) };
  return { kind: "unknown" };
}

// ALTER TABLE [IF EXISTS] [ONLY] name [*] …; the two the other way round is
// what this reader has always taken, so it still does.
const ALTER_TABLE = new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:if\\s+exists\\s+)?(${QNAME})\\s*\\*?\\s+([\\s\\S]+)$`, "i");
const CREATE_TABLE = new RegExp(`^create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(${QNAME})`, "i");
const CREATE_ROUTINE = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?(?:function|procedure)\\s+(${QNAME})`, "i");
const ALTER_ROUTINE = new RegExp(`^alter\\s+(?:function|procedure|routine)\\s+(${QNAME})\\s*`, "i");
const CREATE_TRIGGER = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+(${IDENT})[\\s\\S]*?\\b(before|after|instead\\s+of)\\s+([\\s\\S]*?)\\s+on\\s+(${QNAME})[\\s\\S]*?\\bexecute\\s+(?:function|procedure)\\s+(${QNAME})`, "i");
const DROP_TRIGGER = new RegExp(`^drop\\s+trigger\\s+(if\\s+exists\\s+)?(${IDENT})\\s+on\\s+(${QNAME})`, "i");
const LEADING_NAME = new RegExp(`^${QNAME}`);
const WHOLE_NAME = new RegExp(`^${QNAME}$`);

// A DO block runs what it holds, conditionally: the replay applies nothing in
// one, so each statement in it is judged, not read. Constraints and the like
// change nothing the model holds. A CREATE TABLE or CREATE TRIGGER is answered
// if it is in the replay at the end, by a plain statement elsewhere. Anything
// else that would change the model (a rename above all) cannot be followed
// safely, and an EXECUTE of text the reader cannot see is the same. A string
// is text, so it is blanked first: only an EXECUTE gives one effect. Foreign
// keys are the exception that is applied, where the condition is known: they
// are what such a block is usually for, and the model holds them.
const DO_GUARD = /^if\s+(not\s+)?exists\s*\([\s\S]*\)\s*then$/i;
const FOLLOWED_IN_DO = new Set(["ignored", "add-foreign-key", "drop-constraint", "rename-constraint"]);
const DO_DDL = /\b(?:alter\s+(?:foreign\s+)?table|alter\s+(?:function|procedure|routine|schema)|create\s+table|create\s+(?:(?:global|local)\s+)?(?:unlogged\s+|foreign\s+)table|create\s+(?:or\s+replace\s+)?(?:function|procedure)|create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger|drop\s+(?:foreign\s+)?table|drop\s+(?:function|procedure|routine|schema|trigger)|drop\s+(?:type|domain)\b(?=[\s\S]*\bcascade\b)|rename\s+table|sp_rename)\b[\s\S]*/i;
const DO_EXECUTE = /(?<!\bgrant\s+)(?<!\brevoke\s+)(?<!\ball\s+)\bexecute\b(?!\s+(?:function|procedure)\b)/i;
function judgeDo(sql) {
  const quoted = /\$[A-Za-z_]*\$([\s\S]*)\$[A-Za-z_]*\$/.exec(sql)?.[1] ?? /'((?:[^']|'')*)'/.exec(sql)?.[1].replace(/''/g, "'");
  if (quoted === undefined) return { unread: true };
  const needs = [];
  const keys = []; // { table, action, ifTable } of the foreign keys it adds or drops
  let open = false; // inside an IF, past the statement that opened it
  for (const { sql: written } of tokenizeSql(quoted)) {
    const inner = blankStrings(written);
    const ddl = DO_DDL.exec(inner)?.[0];
    if (!ddl) {
      if (DO_EXECUTE.test(inner)) return { unread: true };
      if (/^\s*end\s+(?:if|loop|case)\s*$/i.test(inner)) open = false;
      else if (/\b(?:then|else|loop)\b/i.test(inner)) open = true;
      continue;
    }
    const created = CREATE_TABLE.exec(ddl);
    if (created) {
      needs.push({ table: foldIdent(created[2]) });
      continue;
    }
    const trigger = CREATE_TRIGGER.exec(ddl);
    if (trigger) {
      needs.push({ trigger: foldIdent(trigger[1]), table: foldIdent(trigger[4]) });
      continue;
    }
    const altered = ALTER_TABLE.exec(ddl);
    const actions = altered ? splitTopLevel(altered[2]).map(readAction) : [];
    if (!altered || !actions.every((a) => FOLLOWED_IN_DO.has(a.kind))) return { unread: true };
    const followed = actions.filter((a) => a.kind !== "ignored");
    if (!followed.length) continue;
    // A key is followed only where what decides it is known. The block runs
    // it outright; or a guard asks whether this very constraint exists, which
    // the guard makes a no-op on a re-run; or whether this table exists, which
    // the replay can answer. Any other condition reports.
    const table = foldIdent(altered[1]);
    const guard = inner.slice(0, inner.length - ddl.length).trim().replace(/^begin\b\s*/i, "");
    if (guard === "") {
      if (open) return { unread: true };
      for (const action of followed) keys.push({ table, action, ifTable: false });
      continue;
    }
    const asked = DO_GUARD.exec(guard);
    if (!asked || followed.length !== 1 || open) return { unread: true };
    const constraint = /\bconname\s*=\s*'([^']*)'/i.exec(written)?.[1];
    const named = /\btable_name\s*=\s*'([^']*)'/i.exec(written)?.[1];
    const wanted = followed[0].fk?.name ?? followed[0].name ?? followed[0].from;
    if (constraint !== undefined ? constraint !== wanted || Boolean(asked[1]) !== (followed[0].kind === "add-foreign-key") : !(named === bareName(table) && !asked[1])) return { unread: true };
    keys.push({ table, action: followed[0], ifTable: constraint === undefined });
    open = true;
  }
  return { unread: false, needs, keys };
}

// The bucket table however it is quoted, and what follows an INSERT's tuples.
const BUCKET_TABLE = '(?:"storage"|storage)\\s*\\.\\s*(?:"buckets"|buckets)';
const BUCKET_WHERE = "where\\s+(id|name)\\s*=\\s*('(?:[^']|'')*')\\s*$";
const INSERT_BUCKETS = new RegExp(`^insert\\s+into\\s+${BUCKET_TABLE}\\s*\\(([^)]*)\\)\\s*values\\s*`, "i");
const UPDATE_BUCKET = new RegExp(`^update\\s+${BUCKET_TABLE}\\s+set\\s+([\\s\\S]+?)\\s+${BUCKET_WHERE}`, "i");
const DELETE_BUCKET = new RegExp(`^delete\\s+from\\s+${BUCKET_TABLE}\\s+${BUCKET_WHERE}`, "i");
const ANY_BUCKET_CHANGE = new RegExp(`^(?:update|delete\\s+from|insert\\s+into)\\s+${BUCKET_TABLE}`, "i");
const CONFLICT = new RegExp(`^(?:(?:on\\s+conflict\\s*(?:\\(\\s*(${IDENT})\\s*\\))?\\s*(do\\s+nothing|do\\s+update\\s+set\\s+([\\s\\S]+?)))?)\\s*$`, "i");
const EXCLUDED = new RegExp(`^\\s*excluded\\s*\\.\\s*(${IDENT})\\s*$`, "i");
const ASSIGNMENT = new RegExp(`^(${IDENT})\\s*=([\\s\\S]*)$`);

// `a = 1, b = 2` as { a: "1", b: "2" }, or null for any other shape.
function assignments(text) {
  const out = {};
  for (const set of splitTopLevel(text)) {
    const m = ASSIGNMENT.exec(set);
    if (!m) return null;
    out[foldIdent(m[1])] = m[2];
  }
  return out;
}

// A bucket's columns the model holds. A `null` clears the fact.
const BUCKET_FACTS = { public: "public", file_size_limit: "fileSizeLimit", allowed_mime_types: "allowedMimeTypes" };
function setBucketFacts(bucket, raw) {
  for (const [column, fact] of Object.entries(BUCKET_FACTS)) {
    if (raw[column] === undefined) continue;
    const value = literal(raw[column]);
    if (value !== undefined) bucket.facts[fact] = value;
    else if (/^\s*null\s*$/i.test(raw[column])) delete bucket.facts[fact];
  }
}
// An update, or false when it cannot be followed: a value that is no literal
// in a column the model holds, or a new id. The id is the record's.
function setBucket(bucket, set) {
  if (set.id !== undefined) return false;
  const opaque = (v) => literal(v) === undefined && !/^\s*null\s*$/i.test(v ?? "");
  if (Object.keys(BUCKET_FACTS).some((column) => set[column] !== undefined && opaque(set[column]))) return false;
  if (set.name !== undefined && typeof literal(set.name) !== "string") return false;
  if (set.name !== undefined) bucket.name = literal(set.name);
  setBucketFacts(bucket, set);
  return true;
}

// Returns { tables: Map (key -> table, key = tableKey(name)), functions: Map
// (keyed the same way), buckets: Map, triggers: [], skipped: [], created,
// undone: [] }.
// `skipped` lists statements that LOOK like schema changes but that the replay
// did not apply: the tripwire against silently missing a schema mutation.
// `statement` is an excerpt; `text` is the whole statement, so a change anywhere
// in it is a new unread item; `unseen` says the statement changes a table or
// function the history never made, which `detect` reads apart.
// `created` counts the tables the history made. `undone` lists what a file
// made and took away again in itself: `detect` reads that as undo steps
// replayed as if they were forward ones.
export function replayMigrations(files) {
  const tables = new Map();
  const functions = new Map();
  const buckets = new Map();
  const triggers = []; // { name, timing, events, table, fn }
  const skipped = [];
  const undone = [];
  const waiting = []; // DO blocks answered, or not, by the end of the replay
  let created = 0;

  // A table moved to a new name: whatever points at it follows, or the FK
  // graph silently rots (00009 renames surveys -> journeys while journey_edges
  // still points at surveys).
  const moveTable = (table, newName) => {
    const oldName = table.name;
    table.renamedFrom.push(oldName);
    table.name = newName;
    tables.delete(tableKey(oldName));
    tables.set(tableKey(newName), table);
    rewriteRefs((ref) => {
      const target = ref.split("(")[0];
      return sameTable(target, oldName) ? `${newName}${ref.slice(target.length)}` : ref;
    });
    for (const t of triggers) if (sameTable(t.table, oldName)) t.table = newName;
  };
  // Functions are keyed as tables are: `f` and `public.f` are one function, and
  // its `name` stays as first written.
  const moveFunction = (key, newName, fileName) => {
    const f = functions.get(key);
    functions.delete(key);
    const newKey = tableKey(newName);
    const clash = functions.get(newKey); // an overload of the new name: one record per name, and this is the newer
    const oldName = f.name;
    f.renamedFrom = [...(f.renamedFrom ?? []), oldName];
    f.name = newName;
    f.resources = [...new Set([...(clash?.resources ?? []), ...f.resources, fileName])];
    functions.set(newKey, f);
    for (const t of triggers) if (sameTable(t.fn, oldName)) t.fn = newName;
  };

  const findBucket = (column, value) => (column === "id" ? buckets.get(value) : [...buckets.values()].find((b) => b.name === value));

  // Every reference a column holds. `references` is the first; a column may be
  // in further keys, and they go in `alsoReferences`.
  const refsOf = (col) => [...(col.references ? [col.references] : []), ...(col.alsoReferences ?? [])];
  const setRefs = (col, refs) => {
    delete col.references;
    delete col.alsoReferences;
    if (refs.length) col.references = refs[0];
    if (refs.length > 1) col.alsoReferences = refs.slice(1);
  };
  // Every reference in the model through `fn`: a rename reaches the columns and
  // what the keys remember giving them.
  const rewriteRefs = (fn) => {
    for (const table of tables.values()) {
      for (const col of table.columns) if (col.references) setRefs(col, refsOf(col).map(fn));
      for (const key of table.keys.values()) for (const g of key.gave) g.ref = fn(g.ref);
    }
  };

  // table.keys: constraint name -> { columns, gave: [{ column, ref }] }.
  // Postgres names an unnamed key after the table it was made on, and a later
  // rename of the table leaves that name alone, so this is decided once.
  const defaultKey = (table, columns) => {
    for (let n = 0; ; n++) {
      const name = constraintName(bareName(table.name), columns.join("_"), n ? `fkey${n}` : "fkey");
      if (!table.keys.has(name)) return name;
    }
  };
  const noteInlineKey = (table, col, def) => {
    if (!col.references) return;
    const named = NAMED_REFERENCE.exec(def);
    table.keys.set(named ? foldIdent(named[1]) : defaultKey(table, [col.name]), { columns: [col.name], gave: [{ column: col.name, ref: col.references }] });
  };
  // False when a column it names is not in the table, or the two lists disagree.
  const addForeignKey = (table, fk) => {
    const columns = fk.columns.map((name) => table.columns.find((c) => c.name === name));
    if (!columns.length || columns.some((c) => !c)) return false;
    if (fk.targetColumns.length && fk.targetColumns.length !== columns.length) return false;
    const gave = [];
    columns.forEach((col, i) => {
      const ref = refTo(fk.target, fk.targetColumns[i]);
      if (refsOf(col).includes(ref)) return;
      setRefs(col, [...refsOf(col), ref]);
      gave.push({ column: col.name, ref });
    });
    table.keys.set(fk.name ?? defaultKey(table, fk.columns), { columns: fk.columns, gave });
    return true;
  };
  const dropConstraint = (table, name) => {
    const key = table.keys.get(name);
    if (!key) return false;
    for (const { column, ref } of key.gave) {
      const col = table.columns.find((c) => c.name === column);
      if (col) setRefs(col, refsOf(col).filter((r) => r !== ref));
    }
    table.keys.delete(name);
    return true;
  };
  const renameConstraint = (table, from, to) => {
    if (!table.keys.has(from)) return;
    table.keys.set(to, table.keys.get(from));
    table.keys.delete(from);
  };

  for (const file of files) {
    // What this file made, and what it changed from, to tell an undo step from
    // a later migration's change.
    const here = { tables: new Set(), columns: new Set(), functions: new Set(), triggers: new Set(), was: new Map() };
    for (const { sql, leadingComments } of tokenizeSql(file.text)) {
      const head = sql.replace(/\s+/g, " ").slice(0, 200);
      const unread = (extra = {}) => skipped.push({ file: file.name, statement: head, text: sql, ...extra });
      const selfUndone = () => undone.push({ file: file.name, statement: head });
      // A thing this file changed and now changes back. By the thing itself,
      // so a table is the same table under whatever name it went through.
      const follow = (set, from, to) => {
        if (set.delete(from)) set.add(to);
      };
      const changed = (thing, field, before, after) => {
        if (!here.was.has(thing)) here.was.set(thing, new Map());
        const was = here.was.get(thing);
        if (was.get(field) === after) selfUndone();
        if (!was.has(field)) was.set(field, before);
      };

      // A batch separator: the statements either side of it reach here as one.
      if (/^\s*go\s*$/im.test(sql)) {
        unread();
        continue;
      }

      let m;
      // CREATE TABLE
      if ((m = CREATE_TABLE.exec(sql))) {
        const name = foldIdent(m[2]);
        // IF NOT EXISTS over a table that exists, in either spelling, is a
        // no-op in Postgres: the first table and its name stay (CR-001). With
        // no guard Postgres would refuse it, so the read has gone wrong.
        if (tables.has(tableKey(name))) {
          if (!m[1]) unread();
          continue;
        }
        const rest = sql.slice(m[0].length);
        const paren = /^\s*\(/.test(rest) ? parenBody(sql, m[0].length) : null;
        const defs = paren ? splitTopLevel(paren.body) : [];
        if (defs.some((def) => QUOTED_ELSEWHERE.test(def)) || (!paren && !/^\s+(as|partition\s+of)\s/i.test(rest))) {
          unread();
          continue;
        }
        // No column list, or one that takes another table's columns: the
        // table is in the replay and the read of its columns is not whole.
        if (!paren || defs.some((def) => /^like\s/i.test(def)) || /\binherits\s*\(/i.test(sql.slice(paren.end))) unread();
        const table = {
          name,
          columns: [],
          keys: new Map(),
          renamedFrom: [],
          createdIn: file.name,
          resources: [file.name],
          description: commentsToDescription(leadingComments),
        };
        for (const def of defs) {
          const col = parseColumnDef(def);
          if (col) {
            table.columns.push(col);
            noteInlineKey(table, col, def);
          }
        }
        // After every column: a table's FOREIGN KEY may name one defined below it.
        for (const fk of defs.map(readForeignKey)) if (fk && !addForeignKey(table, fk)) unread();
        tables.set(tableKey(name), table);
        created++;
        here.tables.add(tableKey(name));
        continue;
      }

      // ALTER TABLE
      if ((m = ALTER_TABLE.exec(sql))) {
        const name = foldIdent(m[1]);
        const table = tables.get(tableKey(name));
        if (!table) {
          if (!notOurs(name)) unread({ unseen: true });
          continue;
        }
        let touched = false;
        let missed = false;
        for (const action of splitTopLevel(m[2])) {
          const a = readAction(action);
          const at = tableKey(table.name);
          if (a.kind === "rename-table") {
            const schema = schemaOf(table.name);
            const to = schema && !schemaOf(a.to) ? `${schema}.${a.to}` : a.to;
            if (!sameTable(to, table.name) && tables.has(tableKey(to))) {
              missed = true;
              continue;
            }
            changed(table, "name", at, tableKey(to));
            follow(here.tables, at, tableKey(to));
            for (const c of table.columns) follow(here.columns, `${at} ${c.name}`, `${tableKey(to)} ${c.name}`);
            moveTable(table, to);
            touched = true;
          } else if (a.kind === "set-schema") {
            const to = `${a.schema}.${bareName(table.name)}`;
            if (sameTable(to, table.name)) continue;
            if (tables.has(tableKey(to))) {
              missed = true;
              continue;
            }
            changed(table, "name", at, tableKey(to));
            follow(here.tables, at, tableKey(to));
            for (const c of table.columns) follow(here.columns, `${at} ${c.name}`, `${tableKey(to)} ${c.name}`);
            moveTable(table, to);
            touched = true;
          } else if (a.kind === "rename-column") {
            const col = table.columns.find((c) => c.name === a.from);
            if (col && table.columns.some((c) => c !== col && c.name === a.to)) {
              missed = true;
            } else if (col) {
              changed(col, "name", a.from, a.to);
              follow(here.columns, `${at} ${a.from}`, `${at} ${a.to}`);
              col.name = a.to;
              for (const key of table.keys.values()) {
                key.columns = key.columns.map((c) => (c === a.from ? a.to : c));
                for (const g of key.gave) if (g.column === a.from) g.column = a.to;
              }
              // A foreign key names its target column: it follows too.
              rewriteRefs((text) => {
                const ref = /^(.*)\((.*)\)$/.exec(text);
                return ref && ref[2] === a.from && sameTable(ref[1], table.name) ? `${ref[1]}(${a.to})` : text;
              });
            } else missed = true;
            touched = true;
          } else if (a.kind === "add-column") {
            if (!table.columns.some((c) => c.name === a.col.name)) {
              table.columns.push(a.col);
              noteInlineKey(table, a.col, a.def);
              here.columns.add(`${at} ${a.col.name}`);
              touched = true;
            } else if (!a.guarded) missed = true;
          } else if (a.kind === "drop-column") {
            if (here.columns.has(`${at} ${a.name}`)) selfUndone();
            if (!a.guarded && !table.columns.some((c) => c.name === a.name)) missed = true;
            // A key goes whole with any column of it, its other columns' references too.
            for (const [key, { columns }] of [...table.keys]) if (columns.includes(a.name)) dropConstraint(table, key);
            table.columns = table.columns.filter((c) => c.name !== a.name);
            touched = true;
          } else if (a.kind === "add-foreign-key") {
            if (addForeignKey(table, a.fk)) touched = true;
            else missed = true;
          } else if (a.kind === "drop-constraint") {
            if (dropConstraint(table, a.name)) touched = true;
          } else if (a.kind === "rename-constraint") {
            renameConstraint(table, a.from, a.to);
          } else if (a.kind === "alter-type") {
            const col = table.columns.find((c) => c.name === a.name);
            if (col) {
              changed(col, "type", col.type, a.type);
              col.type = a.type;
            } else missed = true;
            touched = true;
          } else if (a.kind === "unknown" || (a.column !== undefined && !table.columns.some((c) => c.name === a.column))) {
            missed = true;
          }
          // Other constraints, SET DEFAULT, ENABLE/DISABLE ROW LEVEL SECURITY,
          // VALIDATE, ... are deliberately ignored.
        }
        if (touched) {
          const current = tables.get(tableKey(table.name));
          if (current && !current.resources.includes(file.name)) current.resources.push(file.name);
        }
        if (missed) unread();
        continue;
      }

      // DROP TABLE
      if ((m = /^drop\s+table\s+(if\s+exists\s+)?([\s\S]+)$/i.exec(sql))) {
        let missed = null;
        for (const rawName of splitTopLevel(m[2])) {
          const written = rawName.replace(/\s+(cascade|restrict)\s*$/i, "");
          const name = foldIdent(written);
          const key = tableKey(name);
          if (!WHOLE_NAME.test(written)) missed ??= {};
          // A guarded drop of a table the history never made is a no-op, and
          // the replay is right to do nothing.
          else if (!tables.has(key) && !m[1] && !notOurs(name)) missed = { unseen: true };
          if (here.tables.has(key)) selfUndone();
          tables.delete(key);
          for (let i = triggers.length - 1; i >= 0; i--) if (sameTable(triggers[i].table, name)) triggers.splice(i, 1);
        }
        if (missed) unread(missed);
        continue;
      }

      // CREATE [OR REPLACE] FUNCTION or PROCEDURE — upsert by NAME (last
      // definition wins; save_journey_graph is redefined across 6+ migrations).
      // Overload coexistence would be invisible here; acceptable for orientation.
      if ((m = CREATE_ROUTINE.exec(sql))) {
        const name = foldIdent(m[1]);
        const key = tableKey(name);
        const paren = parenBody(sql, m[0].length);
        const args = paren ? paren.body.replace(/\s+/g, " ").trim() : "";
        const returns = /returns\s+((?:setof\s+)?[\w".\[\]]+)/i.exec(sql);
        const language = /language\s+([\w"]+)/i.exec(sql);
        here.functions.add(key);
        const existing = functions.get(key);
        const resources = existing ? existing.resources : [];
        if (!resources.includes(file.name)) resources.push(file.name);
        functions.set(key, {
          name: existing?.name ?? name,
          signature: args,
          returns: returns ? returns[1].toLowerCase() : "",
          language: language ? foldIdent(language[1]) : "",
          resources,
          description: commentsToDescription(leadingComments),
          // Raw statement text (kept for the function->table ref scan; the
          // last definition's body is the one that matters).
          body: sql,
          ...(existing?.renamedFrom ? { renamedFrom: existing.renamedFrom } : {}),
        });
        continue;
      }

      // ALTER FUNCTION / PROCEDURE / ROUTINE — a rename or a new schema moves
      // the record, its triggers and its id. By name, signature ignored, as
      // DROP is: one record per name. All else (OWNER, SET search_path,
      // SECURITY DEFINER) changes nothing the model holds.
      if ((m = ALTER_ROUTINE.exec(sql))) {
        const name = foldIdent(m[1]);
        let rest = sql.slice(m[0].length);
        if (rest.startsWith("(")) {
          const args = parenBody(rest);
          rest = args ? rest.slice(args.end + 1).trim() : "";
        }
        const renamed = RENAME_TO.exec(rest);
        const moved = SET_SCHEMA.exec(rest);
        if (!renamed && !moved) continue;
        const key = tableKey(name);
        const f = functions.get(key);
        if (!f) {
          if (!notOurs(name)) unread({ unseen: true });
          continue;
        }
        const schema = moved ? foldIdent(moved[1]) : schemaOf(f.name);
        const bare = bareName(renamed ? foldIdent(renamed[1]) : f.name);
        const to = schema ? `${schema}.${bare}` : bare;
        changed(f, "name", key, tableKey(to));
        follow(here.functions, key, tableKey(to));
        moveFunction(key, to, file.name);
        continue;
      }

      // DROP FUNCTION / PROCEDURE — by name, signature ignored (00009 drops
      // both save_survey_graph overloads this way). Its triggers die with it
      // (Postgres would have required CASCADE or a prior DROP TRIGGER anyway).
      if ((m = /^drop\s+(?:function|procedure|routine)\s+(?:if\s+exists\s+)?([\s\S]+)$/i.exec(sql))) {
        for (const part of splitTopLevel(m[1])) {
          const written = LEADING_NAME.exec(part)?.[0];
          if (!written) {
            unread();
            continue;
          }
          const name = foldIdent(written);
          const key = tableKey(name);
          if (here.functions.has(key)) selfUndone();
          functions.delete(key);
          for (let i = triggers.length - 1; i >= 0; i--) if (sameTable(triggers[i].fn, name)) triggers.splice(i, 1);
        }
        continue;
      }

      // CREATE TRIGGER — trigger statements span lines, so this recognizer
      // works statement-wise (the tokenizer already joined them). Only the
      // orientation facts are kept: timing, events, table, function.
      if ((m = CREATE_TRIGGER.exec(sql))) {
        const name = foldIdent(m[1]);
        const table = foldIdent(m[4]);
        // CREATE OR REPLACE (PG14+) / re-run idempotency: same name+table replaces.
        const existingIdx = triggers.findIndex((t) => t.name === name && sameTable(t.table, table));
        if (existingIdx !== -1) triggers.splice(existingIdx, 1);
        here.triggers.add(`${name} ${tableKey(table)}`);
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
      if ((m = DROP_TRIGGER.exec(sql))) {
        const name = foldIdent(m[2]);
        const table = foldIdent(m[3]);
        if (!m[1] && !tables.has(tableKey(table)) && !notOurs(table)) unread({ unseen: true });
        if (here.triggers.has(`${name} ${tableKey(table)}`)) selfUndone();
        for (let i = triggers.length - 1; i >= 0; i--) {
          if (triggers[i].name === name && sameTable(triggers[i].table, table)) triggers.splice(i, 1);
        }
        continue;
      }

      // DO blocks: judged, never applied (judgeDo above).
      if (/^do\b/i.test(sql)) {
        const judged = judgeDo(sql);
        if (judged.unread) unread();
        else {
          if (judged.needs.length) waiting.push({ needs: judged.needs, item: { file: file.name, statement: head, text: sql } });
          for (const { table: name, action, ifTable } of judged.keys) {
            const table = tables.get(tableKey(name));
            if (!table) {
              if (!ifTable && !notOurs(name)) unread({ unseen: true });
              continue;
            }
            if (action.kind === "add-foreign-key" && !addForeignKey(table, action.fk)) {
              unread();
              continue;
            }
            const did = action.kind === "add-foreign-key" ? true : action.kind === "drop-constraint" ? dropConstraint(table, action.name) : renameConstraint(table, action.from, action.to);
            if (did && !table.resources.includes(file.name)) table.resources.push(file.name);
          }
        }
        continue;
      }

      // INSERT INTO storage.buckets — positional literal extraction from each
      // VALUES tuple; non-literal values are simply omitted from facts. What
      // follows the tuples decides what a bucket already there does.
      if ((m = INSERT_BUCKETS.exec(sql))) {
        const cols = splitTopLevel(m[1]).map(foldIdent);
        const rows = [];
        let from = m[0].length - 1;
        let tail = null;
        while (tail === null) {
          const tuple = parenBody(sql, from);
          if (!tuple) break;
          const values = splitTopLevel(tuple.body);
          const raw = {};
          cols.forEach((c, idx) => (raw[c] = values[idx]));
          rows.push(raw);
          const more = /^\s*,/.exec(sql.slice(tuple.end + 1));
          if (more) from = tuple.end + 1 + more[0].length;
          else tail = sql.slice(tuple.end + 1).trim();
        }
        const conflict = tail === null ? null : CONFLICT.exec(tail);
        const update = conflict?.[3] ? assignments(conflict[3]) : null;
        if (!conflict || (conflict[3] && !update) || rows.some((raw) => !(literal(raw.id) ?? literal(raw.name)))) {
          unread();
          continue;
        }
        const onTarget = conflict[1] ? foldIdent(conflict[1]) : null;
        for (const raw of rows) {
          const id = literal(raw.id) ?? literal(raw.name);
          const named = literal(raw.name) ?? id;
          const there = onTarget === "name" ? findBucket("name", named) : buckets.get(id);
          // Over a bucket that is there with no ON CONFLICT, Postgres refuses.
          if (there && !conflict[2]) {
            unread();
          } else if (there && update) {
            const set = {};
            for (const [column, value] of Object.entries(update)) set[column] = EXCLUDED.exec(value) ? raw[foldIdent(EXCLUDED.exec(value)[1])] : value;
            if (!setBucket(there, set)) unread();
            else if (!there.resource.includes(file.name)) there.resource.push(file.name);
          } else if (!there) {
            const bucket = { id, name: named, resource: [file.name], description: commentsToDescription(leadingComments), facts: {} };
            setBucketFacts(bucket, raw);
            buckets.set(id, bucket);
          }
        }
        continue;
      }

      // UPDATE and DELETE on storage.buckets, one bucket by its id or name. On
      // a bucket no migration made there is nothing to apply. Anything wider
      // cannot be followed, so it reports.
      if ((m = UPDATE_BUCKET.exec(sql))) {
        const set = assignments(m[1]);
        const bucket = findBucket(m[2].toLowerCase(), literal(m[3]));
        if (!set) unread();
        else if (bucket) {
          if (!setBucket(bucket, set)) unread();
          else if (!bucket.resource.includes(file.name)) bucket.resource.push(file.name);
        }
        continue;
      }
      if ((m = DELETE_BUCKET.exec(sql))) {
        const bucket = findBucket(m[1].toLowerCase(), literal(m[2]));
        if (bucket) buckets.delete(bucket.id);
        continue;
      }
      if (ANY_BUCKET_CHANGE.test(sql)) {
        unread();
        continue;
      }

      // Tripwire: unmatched statements that smell like schema changes.
      if (TRIPWIRE.test(sql) && (!QUIET_DROP.test(sql) || DROPS_COLUMNS.test(sql))) unread();
    }
  }

  const answered = ({ table, trigger }) => (trigger ? triggers.some((t) => t.name === trigger && sameTable(t.table, table)) : tables.has(tableKey(table)));
  for (const { needs, item } of waiting) if (!needs.every(answered)) skipped.push(item);

  return { tables, functions, buckets, triggers, skipped, created, undone };
}

// A record's file name, from a name a quoted identifier may have put anything
// in: what the store refuses goes as ~<hex>, and a plain name stays as it is.
// Two names can meet here, or differ only by case: detect declines those.
export const fileNamed = (ns, name) => `${ns}--${name}.json`.replace(/[^A-Za-z0-9._~()[\]-]/g, (c) => `~${c.codePointAt(0).toString(16)}`);

// Apply-order sort: numeric value of the leading digit run first, filename as
// tiebreak. Agrees with the Supabase CLI's lexicographic version ordering for
// this corpus (the timestamp-named 20260412000003_* file sorts last both
// ways), and stays correct if an unpadded prefix ever appears. A `V<version>__`
// file sorts by its version, part by part, so `V10` comes after `V9` and
// `V1.2` after `V1.1`; a file with no version (`R__…`) comes after them all.
const VERSIONED = /^V(\d+(?:[._]\d+)*)__/;
function sortKey(name) {
  const v = VERSIONED.exec(name);
  return v ? v[1].split(/[._]/).map(Number) : [Number(/^\d+/.exec(name)?.[0] ?? Infinity)];
}
export function sortMigrations(names) {
  return [...names].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const x = ka[i] ?? 0;
      const y = kb[i] ?? 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// The files a forward replay applies, in order: an undo step in a file of its
// own (`x.down.sql`, `down.sql`, `U2__x.sql`) is never one.
export const appliedMigrations = (names) => sortMigrations(names.filter((n) => !/(^|\.)down\.sql$/i.test(n) && !/^U\d[\d._]*__/.test(n)));
