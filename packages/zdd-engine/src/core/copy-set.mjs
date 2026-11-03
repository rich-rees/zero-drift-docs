#!/usr/bin/env node
// What a copy of each adapter in a folder holds (decision 0048 points 3 and
// 4): bootstrap asks this of the starter library before it brings a starter
// into an app, and the upgrade before it moves a copy to a later version.
// It writes nothing; bootstrap is the one writer of the copy.
//
//   zdd-engine copy-set --adapters=<dir> [--extractors=<a,b>] [--files-only]   one JSON object on stdout
//
// `--files-only` reads no module (the files come from the imports as text),
// so no adapter code runs and `suite` is null: what bootstrap asks of an
// app's own folder, where an adapter may be half-written.
//
// A copy is the adapter's folder without its `example/` (the library's own,
// read only by the preview), and every `_shared/` file that any of its
// modules reach by their static imports, its tests' included: they travel
// with it (As built, slice 3). A fixture's or an example's modules are
// sample repos, never code, so their imports are not followed. Each
// adapter's `SUITE` comes with it, as plain data, so bootstrap can copy the
// companions it names too (a companion must be an adapter beside it,
// lib/suite.mjs). Only the adapters asked for are loaded.
//
// `{ adapters: { <name>: { files: [<path in the folder>…], suite } },
//    missing: [<name asked for that the folder does not hold>] }`, names in
// order, files sorted. An adapter whose reach leaves the folder, passes
// through a link or hits a bound stops the command, naming it, as does a
// SUITE that is not plain data. Bounded as the suite's copies are: 20,000
// entries (files and folders) and 64 MiB in all, each file counted once,
// 1 MiB a file, 32 folders deep.

import { lstatSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { folderModules, readAdapterFolder, NAME_RE } from "./lib/adapter-folder.mjs";
import { moduleReach } from "./lib/suite.mjs";

const MAX_FILES = 20_000;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_FILE = 1024 * 1024;
const LIBRARY_ONLY = /^example$/; // never copied
const SAMPLE = /^(?:example|fixture.*)$/; // copied (fixture), never code

const posix = (p) => p.split(sep).join("/");

// Plain data only, as the suite reads SUITE: what JSON carries, no more.
function plain(v, depth = 0) {
  if (depth > 32) return false;
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => plain(x, depth + 1));
  if (typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(v)).every((d) => "value" in d && plain(d.value, depth + 1));
}

export async function copySet(dir, only = null, { filesOnly = false } = {}) {
  const abs = resolve(dir);
  const held = readAdapterFolder(abs);
  const names = only ?? [...held.keys()];
  const adapters = {};
  const missing = [];
  const budget = { entries: 0, bytes: 0 };
  const counted = new Set();
  // SUITE comes from the module, loaded as detection loads it (its imports
  // checked to stay in the folder first), and only for the names asked.
  const mods = filesOnly ? new Map() : new Map((await folderModules(abs, names.filter((n) => held.has(n)))).map((m) => [m.name, m.mod]));
  const entry = (name) => {
    if (++budget.entries > MAX_FILES) throw new Error(`${name}: the copy is over ${MAX_FILES} files and folders`);
  };
  const count = (p, st, name) => {
    if (counted.has(p)) return;
    counted.add(p);
    entry(name);
    if ((budget.bytes += st.size) > MAX_BYTES) throw new Error(`${name}: the copy is over ${MAX_BYTES / 1024 / 1024} MiB`);
    if (st.size > MAX_FILE) throw new Error(`${name}: ${posix(relative(abs, p))} is over 1 MiB`);
  };
  for (const name of names) {
    if (!NAME_RE.test(name) || !held.has(name)) {
      missing.push(name);
      continue;
    }
    const own = join(abs, name);
    const files = [];
    const code = [];
    const walk = (d, depth = 0) => {
      if (depth > MAX_DEPTH) throw new Error(`${name}: ${posix(relative(abs, d))} is more than ${MAX_DEPTH} folders deep`);
      for (const n of readdirSync(d).sort()) {
        const p = join(d, n);
        const st = lstatSync(p);
        if (st.isSymbolicLink()) throw new Error(`${name}: ${posix(relative(abs, p))} is a link — a copy holds real files only`);
        if (st.isDirectory()) {
          if (d === own && LIBRARY_ONLY.test(n)) continue;
          entry(name);
          walk(p, depth + 1);
          continue;
        }
        if (!st.isFile()) continue;
        count(p, st, name);
        files.push(p);
        const top = posix(relative(own, p)).split("/")[0];
        if (n.endsWith(".mjs") && !(top !== n && SAMPLE.test(top))) code.push(p);
      }
    };
    walk(own);
    const shared = new Set();
    for (const p of code) {
      const r = moduleReach(p, abs);
      const wrong = [...r.outside, ...r.missing.map((m) => `${m} is not there`), ...(r.limit ? [r.limit] : [])];
      if (wrong.length) throw new Error(`${name}: ${posix(relative(abs, p))} reaches outside the folder, or through a link: ${wrong.slice(0, 3).join("; ")}`);
      for (const f of r.files) {
        const rel = posix(relative(abs, f));
        if (rel.startsWith("_shared/")) shared.add(f);
        else if (!rel.startsWith(`${name}/`)) throw new Error(`${name}: ${posix(relative(abs, p))} reaches ${rel}, another adapter's file — a starter reaches only its own folder and _shared/`);
      }
    }
    for (const f of [...shared].sort()) count(f, lstatSync(f), name);
    const mod = mods.get(name) ?? {};
    if (mod.SUITE !== undefined && !plain(mod.SUITE)) throw new Error(`${name}: SUITE is not plain data (strings, numbers, booleans, null, arrays and plain objects), so its companions cannot be read`);
    const suite = mod.SUITE === undefined ? null : JSON.parse(JSON.stringify(mod.SUITE));
    adapters[name] = { files: [...files, ...shared].map((f) => posix(relative(abs, f))).sort(), suite };
  }
  return { adapters, missing };
}

export async function run(args) {
  const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const dir = arg("adapters");
  let out;
  try {
    if (!dir) throw new Error("pass --adapters=<folder of adapters> (the starter library's adapters/)");
    const only = arg("extractors") ? arg("extractors").split(",").map((s) => s.trim()).filter(Boolean) : null;
    out = await copySet(dir, only, { filesOnly: args.includes("--files-only") });
  } catch (e) {
    console.error(`copy-set: ${e.message}`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
