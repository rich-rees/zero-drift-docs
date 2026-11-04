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
//   node scripts/stage.mjs 0.1.0 <empty out dir> --repin   (a narrated step, before 0.1.0 is published)
//
// Copies the package's published files (package.json "files") into the out
// dir; for the baseline, lays baseline/adapters/ over adapters/ (each
// starter folder there replaces the tree's whole; each _shared/ file there
// replaces the tree's one) and baseline/README.md, when there, over the
// README (0.2.1: the README lists each version, which 0.1.0's must not),
// writes the version into package.json, and keeps
// only the notes up to it. The baseline is frozen: every file it stages is
// pinned by baseline/manifest-0.1.0.json, so a later change to any starter
// makes staging 0.1.0 fail, never change what 0.1.0 is (CR-291). The notes
// are checked whole first (CR-297). Refuses any other version, and an out
// dir that is not empty. Deterministic: the same tree gives the same bytes.

import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE = "0.1.0";
export const MANIFEST = join("baseline", `manifest-${BASELINE}.json`);

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const NAME_RE = /^[a-z][a-z0-9-]*$/;

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

// Every staged file and the SHA-256 of its bytes: what the baseline's
// manifest pins and what a publish is compared against.
export function manifestOf(dir) {
  return Object.fromEntries(walk(dir).map((p) => [relative(dir, p).split(sep).join("/"), createHash("sha256").update(readFileSync(p)).digest("hex")]));
}

// notes.json as slice 5 reads it (decision 0048 point 7), checked whole:
// `notes: 1`; versions oldest first, unique, the baseline first with no
// starters and the tree's version last; each starter a folder of the tree;
// each fix three plain strings. Throws with the first thing wrong.
export function checkNotes(notes, { version, starters }) {
  const bad = (msg) => {
    throw new Error(`notes.json: ${msg}`);
  };
  const text = (v, where) => {
    if (typeof v !== "string" || !v.trim()) bad(`${where} must be a non-empty string`);
  };
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) bad("must be an object");
  if (notes.notes !== 1) bad(`"notes" must be 1, the shape this stager writes and slice 5 reads`);
  if (!Array.isArray(notes.versions) || !notes.versions.length) bad("versions must be a non-empty list");
  let prev = null;
  for (const [i, v] of notes.versions.entries()) {
    const where = `versions[${i}]`;
    if (!v || typeof v !== "object" || Array.isArray(v)) bad(`${where} must be an object`);
    if (typeof v.version !== "string" || !SEMVER.test(v.version)) bad(`${where}.version must be X.Y.Z`);
    if (prev && cmp(prev, v.version) >= 0) bad(`${where}.version ${v.version} must come after ${prev}: versions are oldest first, each once`);
    prev = v.version;
    text(v.summary, `${where}.summary`);
    if (!v.starters || typeof v.starters !== "object" || Array.isArray(v.starters)) bad(`${where}.starters must be an object`);
    for (const [name, s] of Object.entries(v.starters)) {
      if (!NAME_RE.test(name) || !starters.includes(name)) bad(`${where}.starters names '${name}', which is not a starter of this library`);
      if (!s || !Array.isArray(s.fixes) || !s.fixes.length) bad(`${where}.starters.${name}.fixes must be a non-empty list`);
      for (const [j, f] of s.fixes.entries()) for (const k of ["what", "who", "moves"]) text(f?.[k], `${where}.starters.${name}.fixes[${j}].${k}`);
    }
  }
  if (notes.versions[0].version !== BASELINE || Object.keys(notes.versions[0].starters).length) bad(`the first version is ${BASELINE}, the baseline, with no starters`);
  if (prev !== version) bad(`the last version is ${prev}, but package.json says ${version}: every version says what it changed`);
}

// The versions this tree can stage: the baseline and its own.
export function stageable() {
  const own = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version;
  return [BASELINE, own];
}

export function stage(version, out, { root = PKG, repin = false } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!SEMVER.test(version)) throw new Error(`'${version}' is not a version (X.Y.Z)`);
  if (version !== BASELINE && version !== pkg.version) throw new Error(`this tree stages ${BASELINE} (the baseline) and ${pkg.version} (its own) — '${version}' is neither; a later version is staged from the tree at its own commit`);
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty`);
  const notes = JSON.parse(readFileSync(join(root, "notes.json"), "utf8"));
  const starters = readdirSync(join(root, "adapters")).filter((n) => existsSync(join(root, "adapters", n, "index.mjs")));
  checkNotes(notes, { version: pkg.version, starters });
  mkdirSync(out, { recursive: true });
  for (const entry of pkg.files) {
    const from = join(root, entry);
    for (const f of lstatSync(from).isDirectory() ? walk(from) : [from]) {
      const to = join(out, relative(root, f));
      mkdirSync(dirname(to), { recursive: true });
      cpSync(f, to);
    }
  }
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
    if (existsSync(join(root, "baseline", "README.md"))) cpSync(join(root, "baseline", "README.md"), join(out, "README.md"));
  }
  writeFileSync(join(out, "package.json"), JSON.stringify({ ...pkg, version }, null, 2) + "\n");
  writeFileSync(join(out, "notes.json"), JSON.stringify({ ...notes, versions: notes.versions.filter((v) => cmp(v.version, version) <= 0) }, null, 2) + "\n");
  if (version === BASELINE && repin) writeFileSync(join(root, MANIFEST), JSON.stringify(manifestOf(out), null, 2) + "\n");
  else if (version === BASELINE) {
    const pinned = JSON.parse(readFileSync(join(root, MANIFEST), "utf8"));
    const got = manifestOf(out);
    const differ = [...new Set([...Object.keys(pinned), ...Object.keys(got)])].filter((f) => pinned[f] !== got[f]).sort();
    if (differ.length) {
      rmSync(out, { recursive: true, force: true });
      throw new Error(`${BASELINE} is frozen by ${MANIFEST.split(sep).join("/")}, and ${differ.length} staged file(s) differ from it: ${differ.slice(0, 5).join(", ")}${differ.length > 5 ? ", …" : ""} — a starter changed since the baseline was pinned; keep its 0.1.0 bytes in baseline/adapters/, or, before 0.1.0 is published and only as a narrated step, re-pin`);
    }
  }
  return { version, out, files: walk(out).map((f) => relative(out, f).split(sep).join("/")) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, out] = process.argv.slice(2).filter((a) => a !== "--repin");
  if (!version || !out) {
    console.error(`usage: node scripts/stage.mjs <version> <empty out dir> — this tree stages ${stageable().join(" and ")}`);
    process.exit(2);
  }
  try {
    const r = stage(version, resolve(out), { repin: process.argv.includes("--repin") });
    console.log(`staged @rich-rees/zdd-starter-adapters@${r.version} in ${r.out} (${r.files.length} files)`);
  } catch (e) {
    console.error(`stage: ${e.message}`);
    process.exit(1);
  }
}
