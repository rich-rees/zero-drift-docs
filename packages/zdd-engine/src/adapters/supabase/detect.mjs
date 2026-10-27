// Detection for the supabase adapter (decision 0039): SQL migrations, one
// namespace per migrations folder.

export const DETECTION = {
  parts: ["database access"],
  order: 10,
  optionShape: { objectLists: { migrationNamespaces: "dir" } },
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

export function detect({ scan }) {
  const sqlDirs = new Map(); // dir -> count
  for (const f of scan.files) if (f.name.endsWith(".sql") && /(^|\/)migrations\//.test(f.rel)) sqlDirs.set(f.dir, (sqlDirs.get(f.dir) ?? 0) + 1);
  if (!sqlDirs.size) return null;
  const dirs = [...sqlDirs.keys()].sort();
  const names = namespaceNames(dirs);
  return {
    proposal: {
      evidence: dirs.map((d) => `SQL migrations under \`${d}\` (${sqlDirs.get(d)} file${sqlDirs.get(d) === 1 ? "" : "s"})`),
      options: { migrationNamespaces: dirs.map((d, i) => ({ name: names[i], dir: d })) },
    },
  };
}
