// Detection for the supabase adapter (decision 0039): SQL migrations, one
// namespace per migrations folder. A claim is a trial read (decision 0048
// point 6): detect replays the files as derive would, judges the result, and
// declines when it does not make sense. The judging looks at the read, never
// at which tool wrote the files.

import { appliedMigrations, replayMigrations } from "./sql-replay.mjs";

export const DETECTION = {
  parts: ["schema"],
  order: 10,
  optionShape: { objectLists: { migrationNamespaces: { required: ["dir"] } } },
  exampleClaims: ["a table: `../../metadata/table/db--things.json`"],
  stack: [{ rank: 20, match: "supabase|postgres", options: { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] }, path: ["migrationNamespaces", 0, "dir"] }],
  example: { options: { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] } },
};

// Namespace names for several migration dirs: the path above `migrations`,
// minus the conventional `supabase` segment, made unique (CR-012).
export function namespaceNames(dirs) {
  if (dirs.length === 1) return ["db"];
  const names = dirs.map((d) => {
    const segs = d.split("/").filter((s) => s && s !== "migrations" && s !== "supabase");
    return segs.length ? segs.join("-") : "db";
  });
  return dedupe(names);
}
// Unique names, checked against the whole set: a raw `foo-2` sitting next to
// two `foo`s cannot be collided into (review CR-047).
export function dedupe(names) {
  const taken = new Set(names); // every raw name is reserved before any suffix is minted
  const seen = new Set();
  return names.map((n) => {
    if (!seen.has(n)) {
      seen.add(n);
      return n;
    }
    let candidate;
    for (let i = 2; taken.has((candidate = `${n}-${i}`)); i++);
    taken.add(candidate);
    return candidate;
  });
}

const SAMPLES = 3;
const quote = (items) => items.slice(0, SAMPLES).map((s) => `\`${s.statement.slice(0, 80)}\``).join(", ") + (items.length > SAMPLES ? ` and ${items.length - SAMPLES} more` : "");

// Why the replay of one folder cannot be trusted, in plain words, or nothing.
function judge(dir, names, scan) {
  const files = [];
  for (const name of names) {
    const text = scan.read(`${dir}/${name}`);
    if (text === null) return { reasons: [`\`${dir}/${name}\`: could not read it`] };
    files.push({ name, text });
  }
  const replay = replayMigrations(files);
  const unseen = replay.skipped.filter((s) => s.unseen);
  const unreadable = replay.skipped.filter((s) => !s.unseen);
  const reasons = [];
  if (unseen.length) reasons.push(`\`${dir}\`: statements change a table they never create (${quote(unseen)})`);
  if (unreadable.length) reasons.push(`\`${dir}\`: statements it cannot read (${quote(unreadable)})`);
  if (replay.undone.length) reasons.push(`\`${dir}\`: files undo themselves, so they hold undo steps a replay would apply (${quote(replay.undone)})`);
  if (replay.created && !replay.tables.size) reasons.push(`\`${dir}\`: files create tables and end with none`);
  return { reasons, tables: [...replay.tables.keys()] };
}

export function detect({ scan }) {
  const sqlDirs = new Map(); // dir -> file names
  for (const f of scan.files) {
    if (!f.name.endsWith(".sql") || !/(^|\/)migrations\//.test(f.rel)) continue;
    if (!sqlDirs.has(f.dir)) sqlDirs.set(f.dir, []);
    sqlDirs.get(f.dir).push(f.name);
  }
  for (const [dir, names] of sqlDirs) {
    const applied = appliedMigrations(names);
    if (applied.length) sqlDirs.set(dir, applied);
    else sqlDirs.delete(dir);
  }
  if (!sqlDirs.size) return null;
  const dirs = [...sqlDirs.keys()].sort();

  const reasons = [];
  const owner = new Map(); // table key -> dir, for a table two folders make
  for (const dir of dirs) {
    // One folder is one history. A lone file in a folder below `migrations`,
    // with nothing beside that folder, is a history spread over folders: each
    // later migration would be a folder nobody listed.
    const parent = dir.slice(0, dir.lastIndexOf("/"));
    if (/(^|\/)migrations(\/|$)/.test(parent) && sqlDirs.get(dir).length === 1 && !sqlDirs.has(parent)) {
      reasons.push(`\`${dir}\`: a folder per migration, and the replay reads the files of one folder`);
      continue;
    }
    const judged = judge(dir, sqlDirs.get(dir), scan);
    reasons.push(...judged.reasons);
    for (const key of judged.tables ?? []) {
      if (owner.has(key)) reasons.push(`two folders make the table \`${key}\` (\`${owner.get(key)}\` and \`${dir}\`), and a name must say which`);
      else owner.set(key, dir);
    }
  }
  if (reasons.length) return { declined: reasons };

  const names = namespaceNames(dirs);
  const count = (d) => sqlDirs.get(d).length;
  return {
    proposal: {
      evidence: dirs.map((d) => `SQL migrations under \`${d}\` (${count(d)} file${count(d) === 1 ? "" : "s"})`),
      options: { migrationNamespaces: dirs.map((d, i) => ({ name: names[i], dir: d })) },
    },
  };
}
