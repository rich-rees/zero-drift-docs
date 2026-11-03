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

import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { insideRepo, repoRelative } from "./paths.mjs";
import { moduleReach } from "./suite.mjs";

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
// preview ask (decision 0039), over whichever folder they are given. Each
// one's static imports are checked before it is imported (CR-295): they
// must stay in the folder and never pass through a link, or its top-level
// code would run from wherever the link points.
// With `only`, just the adapters named there are checked and loaded: one
// broken adapter beside them is not theirs to answer for.
export async function folderModules(dir, only = null) {
  const out = [];
  const abs = resolve(dir);
  for (const [name, entry] of readAdapterFolder(abs)) {
    if (only && !only.includes(name)) continue;
    const reach = moduleReach(entry, abs);
    const wrong = [...reach.outside, ...reach.missing.map((m) => `${m} is not there`), ...(reach.limit ? [reach.limit] : [])];
    if (wrong.length) throw new Error(`${name} in the adapter folder ${abs} reaches outside it, or through a link: ${wrong.slice(0, 3).join("; ")}`);
    out.push({ name, entry, mod: await import(pathToFileURL(entry).href) });
  }
  return out;
}

// The repo's own adapter folder, when its config names one: `{ rel, abs }`,
// or null when there is no config or no localExtractorDir. Only that key is
// read, bounded as the config load is. Lenient by default: a config that
// cannot be read names no folder, because detection runs before bootstrap
// has written one and bootstrap is what says what is wrong with it. With
// `strict`, a config that is there and cannot be read, or names a folder
// outside the repo or the repo itself, throws, saying so (CR-303).
// `configPath` is a config somewhere other than `<root>/zdd/config.json`.
export function ownAdapterFolder(root, { strict = false, configPath = null } = {}) {
  const p = configPath ? resolve(configPath) : join(root, "zdd", "config.json");
  let st;
  try {
    st = statSync(p);
  } catch (e) {
    // Only absence is no config; anything else (permissions, I/O) is a
    // config that cannot be read, which strict says (CR-314).
    const absent = e?.code === "ENOENT" || e?.code === "ENOTDIR";
    if (strict && (configPath || !absent)) throw new Error(absent ? `no config at ${p}` : `${p} cannot be read for its localExtractorDir: ${e.code ?? e.message}`);
    return null;
  }
  try {
    if (!st.isFile() || st.size > 1024 * 1024) throw new Error("it is not a file of at most 1 MiB");
    const dir = JSON.parse(readFileSync(p, "utf8"))?.localExtractorDir;
    if (dir === undefined) return null;
    const rel = repoRelative(dir, "localExtractorDir");
    if (rel === ".") throw new Error("localExtractorDir is the repo itself ('.'); the adapters are a folder of their own");
    return { rel, abs: insideRepo(root, resolve(root, rel), "localExtractorDir") };
  } catch (e) {
    if (strict) throw new Error(`${p} cannot be read for its localExtractorDir: ${e.message}`);
    return null;
  }
}

// The repo-relative folders under `root` that are adapters, never source,
// for a scan or an io (decision 0048): each folder given that lies inside
// the repo, on real paths. A folder of adapters that is the repo itself is
// refused: nothing would be source (CR-293).
export function toolingIn(root, folders) {
  let realRoot;
  try {
    realRoot = realpathSync.native(root);
  } catch {
    return [];
  }
  const out = new Set();
  for (const f of folders) {
    if (!f) continue;
    let real;
    try {
      real = realpathSync.native(resolve(f));
    } catch {
      continue;
    }
    const rel = relative(realRoot, real);
    if (rel === "") throw new Error(`the folder of adapters ${resolve(f)} is the repo itself — adapters are a folder of their own, never the app's source`);
    if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) out.add(rel.split(sep).join("/"));
  }
  return [...out].sort();
}
