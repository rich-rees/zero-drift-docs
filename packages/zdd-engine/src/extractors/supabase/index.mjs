// supabase extractor — tables, database functions and storage buckets from a
// directory of SQL migrations, replayed in order so the records describe the
// schema as it exists NOW (renames, drops and column changes applied). One
// convention: Supabase CLI migrations. Options (extractorOptions.supabase):
//   migrationNamespaces  [{ name, dir }]  one entry per database; `dir` is
//                        repo-relative, scanned non-recursively (a nested
//                        namespace dir is a different database)
//   externalBuckets      [{ name, namespace }]  buckets that exist but were
//                        never created by a migration here
// Refs are intra-extractor (FK columns, function bodies, trigger attachments)
// so they are emitted resolved. A namespace whose directory does not exist is
// "nothing to inventory" (greenfield), never an error.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { replayMigrations, sortMigrations, tableKey } from "./sql-replay.mjs";
import { repoRelative } from "../../lib/paths.mjs";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const FACTS_KEY_ORDER = {
  table: ["namespace", "columns", "createdIn", "renamedFrom"],
  function: ["namespace", "signature", "returns", "language", "triggers"],
  bucket: ["namespace", "origin", "public", "fileSizeLimit", "allowedMimeTypes"],
};

export function derive({ repoRoot, options }) {
  const diagnostics = [];
  const { migrationNamespaces = [], externalBuckets = [] } = options;
  if (!Array.isArray(migrationNamespaces)) throw new Error(`supabase: 'migrationNamespaces' must be an array of { name, dir }`);
  if (!Array.isArray(externalBuckets)) throw new Error(`supabase: 'externalBuckets' must be an array of { name, namespace }`);

  // ---- Schema replay (per namespace, independent) ----
  const schemas = new Map(); // ns -> { tables, functions, buckets, triggers }
  const nsDirs = new Map(); // ns -> dir, to name both sides of a duplicate
  for (const { name: ns, dir: dirOpt } of migrationNamespaces) {
    if (typeof ns !== "string" || !ns) throw new Error(`supabase: every migrationNamespaces entry needs a string 'name'`);
    const dir = repoRelative(dirOpt, `supabase.migrationNamespaces[${ns}].dir`);
    // Two entries with one name would replace each other in `schemas`: the
    // first namespace's tables vanish and their metadata is pruned as
    // orphaned (CR-064). Checked before the greenfield tolerance below so a
    // missing first dir cannot hide the duplicate.
    if (nsDirs.has(ns)) {
      throw new Error(`supabase: migrationNamespaces: name '${ns}' is used twice (${nsDirs.get(ns)} and ${dir}) — every namespace needs its own name`);
    }
    nsDirs.set(ns, dir);
    const abs = join(repoRoot, dir);
    if (!existsSync(abs)) {
      diagnostics.push(`${ns}: ${dir} not found — nothing to inventory`);
      continue;
    }
    // A .sql symlink pointing nowhere is skipped with a note, never thrown
    // (CR-062); a valid one is read like any migration.
    const isFile = (f) => {
      try {
        return statSync(join(abs, f)).isFile();
      } catch {
        diagnostics.push(`${ns}: ${dir}/${f} is a dangling symlink — skipped`);
        return false;
      }
    };
    const files = sortMigrations(readdirSync(abs).filter((f) => f.endsWith(".sql") && isFile(f))).map((f) => ({
      name: `${dir}/${f}`,
      text: readFileSync(join(abs, f), "utf8"),
    }));
    const replayed = replayMigrations(files);
    for (const s of replayed.skipped) {
      diagnostics.push(`${ns}: unrecognized schema-like statement in ${s.file}: ${s.statement}`);
    }
    schemas.set(ns, replayed);
  }

  // Name -> namespace lookups. A name in two namespaces (or in both a table
  // set and a bucket set) would make `.from('name')` unattributable —
  // hard-error rather than guess. Keyed by tableKey (`public.x` and `x` are
  // one table, CAS-99); a record's id uses the table's name as written.
  const tableNs = new Map();
  const bucketNs = new Map();
  for (const [ns, { tables, buckets }] of schemas) {
    for (const [key, t] of tables) {
      if (tableNs.has(key)) throw new Error(`Table '${t.name}' exists in namespaces '${tableNs.get(key)}' and '${ns}' — cannot attribute .from() calls`);
      tableNs.set(key, ns);
    }
    for (const name of buckets.keys()) bucketNs.set(name, ns);
  }
  for (const { name, namespace } of externalBuckets) bucketNs.set(name, namespace);
  for (const [name] of bucketNs) {
    if (tableNs.has(tableKey(name))) throw new Error(`Name '${name}' is both a table and a bucket — add config disambiguation`);
  }

  const records = [];
  for (const [ns, { tables, functions, buckets, triggers }] of schemas) {
    // A table's id, by any spelling of its name, in this namespace.
    const tableId = (n) => {
      const key = tableKey(n);
      return tableNs.get(key) === ns ? `table:${ns}/${tables.get(key).name}` : null;
    };
    for (const t of [...tables.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const name = t.name;
      const refs = new Set();
      for (const col of t.columns) {
        if (col.references) {
          const target = tableId(col.references.split("(")[0]);
          if (target && target !== `table:${ns}/${name}`) refs.add(target);
        }
      }
      const facts = { namespace: ns, columns: t.columns, createdIn: t.createdIn.split("/").pop() };
      if (t.renamedFrom.length) facts.renamedFrom = t.renamedFrom;
      records.push({
        kind: "table",
        id: `table:${ns}/${name}`,
        title: `${name} (${ns})`,
        description: t.description,
        resource: t.resources,
        refs: [...refs].sort(),
        facts,
        filename: `${ns}--${name}.json`,
      });
    }
    for (const name of [...functions.keys()].sort()) {
      const f = functions.get(name);
      // Function -> table edges: known table names appearing as whole words in
      // the (last) definition body. Textual, therefore honest. Trigger
      // functions never name their tables (`NEW.updated_at = now()`), so
      // CREATE TRIGGER attachments contribute edges + facts.triggers too.
      // A public table's key is its bare name, so `things` and
      // `public.things` in a body both match it (CAS-99).
      const refs = new Set();
      for (const [key, tNs] of tableNs) {
        if (tNs === ns && new RegExp(`\\b${escapeRegex(key)}\\b`).test(f.body)) refs.add(tableId(key));
      }
      const attached = triggers.filter((t) => t.fn === name && tableId(t.table));
      const facts = { namespace: ns, signature: f.signature, returns: f.returns, language: f.language };
      if (attached.length) {
        for (const t of attached) refs.add(tableId(t.table));
        facts.triggers = attached
          .map((t) => `${(t.timing + " " + t.events.join(" or ")).toUpperCase()} ON ${t.table}`)
          .sort();
      }
      records.push({
        kind: "function",
        id: `function:${ns}/${name}`,
        title: `${name}()`,
        description: f.description,
        resource: f.resources,
        refs: [...refs].sort(),
        facts,
        filename: `${ns}--${name}.json`,
      });
    }
    for (const name of [...buckets.keys()].sort()) {
      const b = buckets.get(name);
      records.push({
        kind: "bucket",
        id: `bucket:${ns}/${name}`,
        title: `${name} (${ns})`,
        description: b.description,
        resource: b.resource,
        refs: [],
        facts: { namespace: ns, origin: "migration", ...b.facts },
        filename: `${ns}--${name}.json`,
      });
    }
  }

  for (const { name, namespace } of [...externalBuckets].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    records.push({
      kind: "bucket",
      id: `bucket:${namespace}/${name}`,
      title: `${name} (${namespace})`,
      description: "",
      resource: [],
      refs: [],
      facts: { namespace, origin: "external" },
      filename: `${namespace}--${name}.json`,
    });
  }

  return { records, diagnostics };
}
