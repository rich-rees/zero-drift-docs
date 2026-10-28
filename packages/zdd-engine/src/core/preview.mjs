#!/usr/bin/env node
// ZDD preview (decision 0039 point 4) — what a map will look like, for a
// greenfield repo that has no code yet. Each chosen adapter ships a small
// `example/` folder beside its index.mjs; this copies those folders into a
// temporary directory OUTSIDE the adopter's repo, writes a config naming the
// adapters with the options each example declares (DETECTION.example), and
// runs derive and render there. It prints where the human index landed.
// Nothing is written into the adopter's repo (0039 point 5): the output folder
// — a new temporary one, or `--out` — must be a real folder (never a link)
// outside `--root` (default: the current directory), checked on real paths
// (CR-098). A name the catalogue does not hold is refused, never reported as
// "no example" (CR-115).
//
//   zdd-engine preview --extractors=<a,b,…> [--root=<repo>] [--out=<empty dir>] [--json]

import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { catalogue } from "./lib/catalogue.mjs";
import { catalogueModules } from "./derive.mjs";

const BIN = fileURLToPath(new URL("../../bin/zdd-engine.mjs", import.meta.url));

export async function buildPreview(names, out) {
  const { names: entries } = catalogue();
  const modules = new Map((await catalogueModules()).map(({ name, mod }) => [name, mod]));
  const used = [];
  const skipped = [];
  const extractorOptions = {};
  for (const name of names) {
    const example = entries.has(name) ? join(dirname(entries.get(name)), "example") : null;
    const declared = modules.get(name)?.DETECTION?.example;
    if (!example || !existsSync(example) || !declared) {
      skipped.push(name);
      continue;
    }
    cpSync(example, out, { recursive: true });
    used.push(name);
    extractorOptions[name] = declared.options ?? {};
  }
  if (!used.length) return { out, used, skipped, humanIndex: null };
  mkdirSync(join(out, "zdd", "map"), { recursive: true });
  writeFileSync(join(out, "zdd", "config.json"), JSON.stringify({ name: "Preview", extractors: used, extractorOptions, render: { storeChanges: false } }, null, 2) + "\n");
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
  const unknown = names.filter((n) => !catalogue().names.has(n));
  if (unknown.length) {
    console.error(`preview: ${unknown.join(", ")} ${unknown.length === 1 ? "is not an adapter" : "are not adapters"} in the catalogue (known: ${[...catalogue().names.keys()].join(", ")})`);
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
    r = await buildPreview(names, out);
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
