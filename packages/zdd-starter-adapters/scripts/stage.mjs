#!/usr/bin/env node
// Stage one version of the starter library for `npm publish` (decision 0048,
// As built slice 4). The library has a version line of its own, and two
// versions come from one tree:
//
//   0.1.0, the baseline: every starter as ZDD 0.13 ran it from the engine,
//          save `supabase` and `sqlalchemy`, which are baseline/'s copies
//          of commit 419293d, the readers that reproduce adopters' records.
//          "Upgrade ZDD" copies these first and proves the records unchanged.
//   the tree's own version (package.json): every starter as it is here,
//          with the fixes notes.json describes.
//
// A version after the tree's later ones is staged from the tree at its own
// commit; only the baseline needs the overlay, because its successor was
// built before it was ever published.
//
//   node scripts/stage.mjs <version> <empty out dir>
//
// Copies the package's published files (package.json "files") into the out
// dir; for the baseline, lays baseline/adapters/ over adapters/ (each
// starter folder there replaces the tree's whole; each _shared/ file there
// replaces the tree's one), writes the version into package.json, and keeps
// only the notes up to it. Refuses any other version, and an out dir that is
// not empty. Deterministic: the same tree gives the same bytes.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE = "0.1.0";

const walk = (dir) =>
  readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) throw new Error(`${relative(PKG, p)} is a link — the library publishes real files only`);
      return st.isDirectory() ? walk(p) : [p];
    });

const cmp = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

// The versions this tree can stage: the baseline and its own.
export function stageable() {
  const own = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version;
  return [BASELINE, own];
}

export function stage(version, out, { root = PKG } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`'${version}' is not a version (X.Y.Z)`);
  if (version !== BASELINE && version !== pkg.version) throw new Error(`this tree stages ${BASELINE} (the baseline) and ${pkg.version} (its own) — '${version}' is neither; a later version is staged from the tree at its own commit`);
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty`);
  mkdirSync(out, { recursive: true });
  for (const entry of pkg.files) {
    const from = join(root, entry);
    for (const f of lstatSync(from).isDirectory() ? walk(from) : [from]) {
      const to = join(out, relative(root, f));
      mkdirSync(dirname(to), { recursive: true });
      cpSync(f, to);
    }
  }
  const notes = JSON.parse(readFileSync(join(root, "notes.json"), "utf8"));
  if (!notes.versions.some((v) => v.version === version)) throw new Error(`notes.json has no entry for ${version} — every version says what it changed`);
  if (version === BASELINE && version !== pkg.version) {
    const over = join(root, "baseline", "adapters");
    for (const name of readdirSync(over).sort()) {
      if (name === "_shared") continue;
      rmSync(join(out, "adapters", name), { recursive: true, force: true });
    }
    for (const f of walk(over)) {
      const to = join(out, "adapters", relative(over, f));
      mkdirSync(dirname(to), { recursive: true });
      cpSync(f, to);
    }
  }
  writeFileSync(join(out, "package.json"), JSON.stringify({ ...pkg, version }, null, 2) + "\n");
  writeFileSync(join(out, "notes.json"), JSON.stringify({ ...notes, versions: notes.versions.filter((v) => cmp(v.version, version) <= 0) }, null, 2) + "\n");
  return { version, out, files: walk(out).map((f) => relative(out, f).split(sep).join("/")) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, out] = process.argv.slice(2);
  if (!version || !out) {
    console.error(`usage: node scripts/stage.mjs <version> <empty out dir> — this tree stages ${stageable().join(" and ")}`);
    process.exit(2);
  }
  try {
    const r = stage(version, resolve(out));
    console.log(`staged @rich-rees/zdd-starter-adapters@${r.version} in ${r.out} (${r.files.length} files)`);
  } catch (e) {
    console.error(`stage: ${e.message}`);
    process.exit(1);
  }
}
