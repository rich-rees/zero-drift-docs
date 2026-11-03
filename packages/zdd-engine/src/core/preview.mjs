#!/usr/bin/env node
// ZDD preview (decision 0039 point 4) — what a map will look like, for a
// greenfield repo that has no code yet. Each chosen adapter, in the folder
// of adapters it is given (the starter library's `adapters/`), ships a small
// `example/` folder beside its index.mjs; this copies those folders into a
// temporary directory OUTSIDE the adopter's repo, with the adapters
// themselves and what they reach as its localExtractorDir, writes a config
// naming the adapters with the options each example declares
// (DETECTION.example), and runs derive and render there. It prints where the human index landed.
// Nothing is written into the adopter's repo (0039 point 5): the output folder
// — a new temporary one, or `--out` — must be a real folder (never a link)
// outside `--root` (default: the current directory), checked on real paths
// (CR-098). A name the folder does not hold is refused, never reported as
// "no example" (CR-115).
//
//   zdd-engine preview --adapters=<dir> --extractors=<a,b,…> [--root=<repo>] [--out=<empty dir>] [--json]

import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { folderModules, readAdapterFolder } from "./lib/adapter-folder.mjs";
import { moduleReach } from "./lib/suite.mjs";

const BIN = fileURLToPath(new URL("../../bin/zdd-engine.mjs", import.meta.url));

const LOCAL = "zdd/extractors"; // the preview repo's localExtractorDir

// What copying adapter `entry` out of `dir` brings: its folder (not its
// example/, fixture/ or test/) and every file of `dir` its modules reach.
function adapterCopy(dir, entry) {
  const own = dirname(entry);
  const files = new Set();
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        if (d === own && /^(?:example|fixture.*|test)$/.test(n)) continue;
        walk(p);
      } else if (st.isFile()) files.add(p);
    }
  };
  walk(own);
  for (const p of [...files].filter((f) => f.endsWith(".mjs"))) {
    const r = moduleReach(p, dir);
    if (r.outside.length || r.missing.length || r.limit) throw new Error(`${relative(dir, entry)} cannot be copied alone: ${[...r.outside, ...r.missing, r.limit].filter(Boolean).join("; ")}`);
    for (const f of r.files) files.add(f);
  }
  return [...files].sort();
}

export async function buildPreview(names, out, dir) {
  const modules = new Map((await folderModules(dir)).map(({ name, entry, mod }) => [name, { entry, mod }]));
  const used = [];
  const skipped = [];
  const extractorOptions = {};
  for (const name of names) {
    const found = modules.get(name);
    const example = found ? join(dirname(found.entry), "example") : null;
    const declared = found?.mod?.DETECTION?.example;
    if (!example || !existsSync(example) || !declared) {
      skipped.push(name);
      continue;
    }
    cpSync(example, out, { recursive: true });
    for (const f of adapterCopy(resolve(dir), found.entry)) {
      const to = join(out, ...LOCAL.split("/"), relative(resolve(dir), f));
      mkdirSync(dirname(to), { recursive: true });
      cpSync(f, to);
    }
    used.push(name);
    extractorOptions[name] = declared.options ?? {};
  }
  if (!used.length) return { out, used, skipped, humanIndex: null };
  mkdirSync(join(out, "zdd", "map"), { recursive: true });
  writeFileSync(join(out, "zdd", "config.json"), JSON.stringify({ name: "Preview", extractors: used, extractorOptions, localExtractorDir: LOCAL, render: { storeChanges: false } }, null, 2) + "\n");
  for (const cmd of ["derive", "render"]) execFileSync(process.execPath, [BIN, cmd, `--root=${out}`], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  return { out, used, skipped, humanIndex: join(out, "zdd", "human-index.html") };
}

// `inner` is `outer` or under it, on real paths.
const within = (outer, inner) => {
  const rel = relative(outer, inner);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

// The folder the preview writes into, checked: a real, empty folder whose real
// path is outside the repo. `out` absent: a new temporary folder. Throws with
// the reason; a temporary folder it made and refused is removed.
export function previewTarget(root, out) {
  const realRoot = realpathSync(resolve(root));
  let dir;
  let made = false;
  if (out) {
    dir = resolve(out);
    let st = null;
    try {
      st = lstatSync(dir);
    } catch {
      /* not there yet */
    }
    // lstat: a link (or a junction) is never a directory, so this refuses both.
    if (st && !st.isDirectory()) throw new Error(`${dir} is a link or not a folder — the preview writes only into a real, empty folder`);
    if (st && readdirSync(dir).length) throw new Error(`${dir} is not empty — the preview writes only into an empty folder`);
    if (!st) {
      // Check where it would land before making it: its nearest existing parent's real path.
      let parent = dirname(dir);
      while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
      if (within(realRoot, resolve(realpathSync(parent), relative(parent, dir)))) throw new Error(`${dir} is inside the repo (${realRoot}) — the preview writes only outside it`);
      mkdirSync(dir, { recursive: true });
    }
  } else {
    dir = mkdtempSync(join(tmpdir(), "zdd-preview-"));
    made = true;
  }
  if (within(realRoot, realpathSync(dir))) {
    if (made) rmSync(dir, { recursive: true, force: true });
    throw new Error(`${dir} is inside the repo (${realRoot}) — the preview writes only outside it${made ? "; the temporary folder is inside it too, so pass --out=<a folder outside the repo>" : ""}`);
  }
  return dir;
}

export async function run(args) {
  const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const names = (arg("extractors") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!names.length) {
    console.error("preview: --extractors=<a,b,…> names the adapters to preview");
    process.exit(2);
  }
  const dir = arg("adapters");
  if (!dir) {
    console.error("preview: --adapters=<dir> names the folder of adapters to preview from (the starter library's adapters/, npm @rich-rees/zdd-starter-adapters); the engine ships no adapter of its own");
    process.exit(2);
  }
  let held;
  try {
    held = readAdapterFolder(dir);
  } catch (e) {
    console.error(`preview: ${e.message}`);
    process.exit(2);
  }
  const unknown = names.filter((n) => !held.has(n));
  if (unknown.length) {
    console.error(`preview: ${unknown.join(", ")} ${unknown.length === 1 ? "is not an adapter" : "are not adapters"} in ${resolve(dir)} (it holds: ${[...held.keys()].join(", ") || "none"})`);
    process.exit(2);
  }
  let out;
  try {
    out = previewTarget(arg("root") ?? process.cwd(), arg("out"));
  } catch (e) {
    console.error(`preview: ${e.message}`);
    process.exit(2);
  }
  let r;
  try {
    r = await buildPreview(names, out, dir);
  } catch (e) {
    console.error(`preview: ${e.stderr || e.message}`);
    process.exit(1);
  }
  if (args.includes("--json")) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  else {
    if (r.humanIndex) console.log(`Preview of ${r.used.join(", ")}: ${r.humanIndex}`);
    if (r.skipped.length) console.log(`No example ships for: ${r.skipped.join(", ")}`);
  }
}
