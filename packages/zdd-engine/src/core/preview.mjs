#!/usr/bin/env node
// ZDD preview (decision 0039 point 4) — what a map will look like, for a
// greenfield repo that has no code yet. Each chosen adapter ships a small
// `example/` folder beside its index.mjs; this copies those folders into a
// temporary directory OUTSIDE the adopter's repo, writes a config naming the
// adapters with the options each example declares (DETECTION.example), and
// runs derive and render there. It prints where the human index landed.
// Nothing is written into the adopter's repo (0039 point 5).
//
//   zdd-engine preview --extractors=<a,b,…> [--out=<empty dir>] [--json]

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

export async function run(args) {
  const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const names = (arg("extractors") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!names.length) {
    console.error("preview: --extractors=<a,b,…> names the adapters to preview");
    process.exit(2);
  }
  let out = arg("out");
  if (out) {
    out = resolve(out);
    mkdirSync(out, { recursive: true });
    if (readdirSync(out).length) {
      console.error(`preview: ${out} is not empty — the preview writes only into an empty folder`);
      process.exit(2);
    }
  } else out = mkdtempSync(join(tmpdir(), "zdd-preview-"));
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
