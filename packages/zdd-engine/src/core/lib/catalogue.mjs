// The catalogue: the adapters that ship beside the core (decision 0036). The
// core never imports one by path and never names one. It knows only where
// the catalogue folder is, and finds an adapter there by name exactly as it
// finds a local one in `localExtractorDir`: `<name>/index.mjs`. A folder with
// no index.mjs is not an adapter (shared helpers live in such folders).
//
// `catalogue.json` beside the adapters carries what is data, not code:
//   aliases   a retired adapter name -> its current name, accepted for one
//             release (the engine prints the new name; "upgrade ZDD"
//             rewrites the config)
//   bundles   a pre-1.0 `adapter` value -> the adapters it was a bundle of:
//             `extractors`, `options` (adapter -> { optionKey: default }) for
//             the old option keys an adapter owns, and `rest`, the adapter
//             that takes every other key
//
// The catalogue is part of the installed package, so anything wrong with it
// is a packaging defect, and it fails loudly rather than letting a selection
// fall through to an adopter's local code (CR-002): an adapter folder or its
// index.mjs that is a symlink, or whose real path leaves the catalogue
// folder (CR-001); an adapter folder whose name is not a selectable name; an
// alias or bundle naming an adapter the folder does not hold. Read once per
// process.

import { readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../../adapters/", import.meta.url));
const NAME_RE = /^[a-z][a-z0-9-]*$/; // derive's NAME_RE: what config may select

let cached = null;

function broken(msg) {
  throw new Error(`ZDD's adapter catalogue is broken (a packaging defect, not your config): ${msg}`);
}

function lstat(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

export function catalogue() {
  cached ??= readCatalogue(DIR);
  return cached;
}

// The catalogue in `dir`, read and checked, uncached. catalogue() is this on
// the package's own folder; tests point it at a fixture folder.
export function readCatalogue(dir) {
  const real = realpathSync(dir);
  const names = new Map();
  for (const name of readdirSync(dir).sort()) {
    const folder = join(dir, name);
    const st = lstat(folder);
    if (!st) continue;
    if (st.isSymbolicLink()) broken(`adapters/${name} is a symlink`);
    if (!st.isDirectory()) continue;
    const entry = join(folder, "index.mjs");
    const est = lstat(entry);
    if (!est) continue; // not an adapter: a helpers folder
    if (est.isSymbolicLink() || !est.isFile()) broken(`adapters/${name}/index.mjs is not a regular file`);
    if (!NAME_RE.test(name)) broken(`adapters/${name} is not a selectable adapter name (lowercase letters, digits and hyphens, starting with a letter)`);
    if (!realpathSync(entry).startsWith(real + sep)) broken(`adapters/${name}/index.mjs resolves outside the catalogue`);
    names.set(name, entry);
  }
  let data;
  try {
    data = JSON.parse(readFileSync(join(dir, "catalogue.json"), "utf8"));
  } catch (e) {
    broken(`adapters/catalogue.json cannot be read (${e.message})`);
  }
  const aliases = data.aliases ?? {};
  const bundles = data.bundles ?? {};
  const known = (n, where) => {
    if (typeof n !== "string" || !names.has(n)) broken(`${where} names '${n}', which is not an adapter in the catalogue`);
  };
  for (const [old, now] of Object.entries(aliases)) {
    if (!NAME_RE.test(old)) broken(`alias '${old}' is not a selectable name`);
    if (names.has(old)) broken(`alias '${old}' is also an adapter folder`);
    known(now, `alias '${old}'`);
  }
  for (const [legacy, b] of Object.entries(bundles)) {
    if (!Array.isArray(b.extractors) || !b.extractors.length) broken(`bundle '${legacy}' lists no adapters`);
    for (const n of b.extractors) known(n, `bundle '${legacy}'`);
    for (const n of Object.keys(b.options ?? {})) known(n, `bundle '${legacy}' options`);
    if (b.rest !== undefined) known(b.rest, `bundle '${legacy}' rest`);
  }
  return { names, aliases, bundles };
}

// A bundle's old option object, split to the adapters that own its keys.
export function splitBundleOptions(bundle, options = {}) {
  const out = {};
  const owned = new Set();
  for (const [adapter, keys] of Object.entries(bundle.options ?? {})) {
    out[adapter] = {};
    for (const [key, fallback] of Object.entries(keys)) {
      // As a destructuring default: only `undefined` takes the fallback, and
      // the fallback is copied so no caller holds the cached catalogue's value.
      out[adapter][key] = options[key] !== undefined ? options[key] : structuredClone(fallback);
      owned.add(key);
    }
  }
  if (bundle.rest) out[bundle.rest] = Object.fromEntries(Object.entries(options).filter(([k]) => !owned.has(k)));
  return out;
}
