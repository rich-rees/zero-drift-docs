// A folder of adapters (decision 0048 points 1 to 3): the repo's own
// `localExtractorDir`, or a folder it is given, such as the starter
// library's `adapters/` at bootstrap. The core holds no adapter of its own
// and names none; it reads whatever folder it is handed, the same way.
//
// An adapter here is `<name>/index.mjs`, where `<name>` is a selectable
// name (lowercase letters, digits and hyphens, starting with a letter). A
// folder whose name is not one is not an adapter, so `_shared/` (code the
// adapters share) and `example/` never are. A folder or entry that is a
// link, or whose real path leaves the folder, is refused (CR-001): a link
// would run code from somewhere the folder's owner never put it.

import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const NAME_RE = /^[a-z][a-z0-9-]*$/; // derive's NAME_RE: what config may select

function lstat(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

// The adapters in `dir`: a Map of name -> entry path, in name order. Throws,
// naming the folder, when it is not a folder or an adapter in it is a link.
export function readAdapterFolder(dir) {
  const abs = resolve(dir);
  const st = lstat(abs);
  if (!st) throw new Error(`the adapter folder ${abs} does not exist`);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`the adapter folder ${abs} is a link or not a folder`);
  const real = realpathSync(abs);
  const names = new Map();
  for (const name of readdirSync(abs).sort()) {
    if (!NAME_RE.test(name)) continue; // `_shared/`, dotfiles: never an adapter
    const folder = join(abs, name);
    const fst = lstat(folder);
    if (!fst) continue;
    if (fst.isSymbolicLink()) throw new Error(`${name} in the adapter folder ${abs} is a link — an adapter is a real folder`);
    if (!fst.isDirectory()) continue;
    const entry = join(folder, "index.mjs");
    const est = lstat(entry);
    if (!est) continue; // a folder with no index.mjs is not an adapter
    if (est.isSymbolicLink() || !est.isFile()) throw new Error(`${name}/index.mjs in the adapter folder ${abs} is not a regular file`);
    if (!realpathSync(entry).startsWith(real + sep)) throw new Error(`${name}/index.mjs in the adapter folder ${abs} resolves outside it`);
    names.set(name, entry);
  }
  return names;
}

// Every adapter's module in `dir`, in name order: what detection and the
// preview ask (decision 0039), over whichever folder they are given.
export async function folderModules(dir) {
  const out = [];
  for (const [name, entry] of readAdapterFolder(dir)) out.push({ name, entry, mod: await import(pathToFileURL(entry).href) });
  return out;
}
