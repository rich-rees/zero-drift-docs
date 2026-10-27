// The catalogue: the adapters that ship beside the core (decision 0036). The
// core never imports one by path and never names one. It knows only where
// the catalogue folder is, and finds an adapter there by name exactly as it
// finds a local one in `localExtractorDir`: `<name>/index.mjs`.
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
// Read once per process; the folder and the file are part of the installed
// package, so they cannot change under a running derive.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../../adapters/", import.meta.url));

let cached = null;

export function catalogue() {
  if (cached) return cached;
  const names = new Map();
  for (const name of readdirSync(DIR).sort()) {
    const entry = join(DIR, name, "index.mjs");
    if (statSync(join(DIR, name)).isDirectory() && existsSync(entry)) names.set(name, entry);
  }
  const data = JSON.parse(readFileSync(join(DIR, "catalogue.json"), "utf8"));
  cached = { names, aliases: data.aliases ?? {}, bundles: data.bundles ?? {} };
  return cached;
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
