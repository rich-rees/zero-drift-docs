// The engine's `copy-set` over the starter library (decision 0048 points 3
// and 4): what bootstrap copies into an app is each starter's folder
// without its `example/`, plus the `_shared/` files its code and its tests
// reach — the rule reachedShared states. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { ADAPTERS, ENGINE_BIN, reachedShared } from "./starters.mjs";

const copySet = (dir, extra = []) => spawnSync(process.execPath, [ENGINE_BIN, "copy-set", `--adapters=${dir}`, ...extra], { encoding: "utf8" });
const tmp = (t) => {
  const d = mkdtempSync(join(tmpdir(), "zdd-copyset-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const posix = (p) => p.split(sep).join("/");
const ownFiles = (name) => {
  const own = join(ADAPTERS, name);
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (lstatSync(p).isDirectory()) {
        if (!(d === own && n === "example")) walk(p);
      } else out.push(posix(relative(ADAPTERS, p)));
    }
  };
  walk(own);
  return out;
};

test("copy-set: every starter's copy is its folder without example/, and the _shared/ files its code and tests reach", () => {
  const r = copySet(ADAPTERS);
  assert.equal(r.status, 0, r.stderr);
  const { adapters, missing } = JSON.parse(r.stdout);
  assert.deepEqual(missing, []);
  const starters = readdirSync(ADAPTERS).filter((n) => /^[a-z]/.test(n)).sort();
  assert.deepEqual(Object.keys(adapters), starters);
  for (const name of starters) {
    const want = [...ownFiles(name), ...reachedShared(name).map((f) => posix(relative(ADAPTERS, f)))].sort();
    assert.deepEqual(adapters[name].files, want, name);
    assert.ok(!adapters[name].files.some((f) => f.startsWith(`${name}/example/`)), `${name}: the preview's example stays in the library`);
  }
  // SUITE comes as plain data, companions and all: bootstrap copies a companion too.
  assert.deepEqual(Object.keys(adapters["supabase-js"].suite.companions).sort(), ["nextjs", "supabase"]);
});

test("copy-set: names it is asked for only, an unknown one listed as missing", () => {
  const r = copySet(ADAPTERS, ["--extractors=generic,nope"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out.adapters), ["generic"]);
  assert.deepEqual(out.missing, ["nope"]);
});

test("copy-set: a starter that reaches another adapter's file, or holds a link, stops the command, naming it", (t) => {
  const dir = tmp(t);
  mkdirSync(join(dir, "a"), { recursive: true });
  mkdirSync(join(dir, "b"), { recursive: true });
  writeFileSync(join(dir, "b", "index.mjs"), "export const x = 1;\n");
  writeFileSync(join(dir, "a", "index.mjs"), 'import { x } from "../b/index.mjs";\nexport const y = x;\n');
  const r = copySet(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a: a\/index\.mjs reaches b\/index\.mjs, another adapter's file/);
  const linked = tmp(t);
  cpSync(join(ADAPTERS, "generic"), join(linked, "generic"), { recursive: true });
  try {
    spawnSync(process.execPath, ["-e", `require("fs").symlinkSync(${JSON.stringify(join(ADAPTERS, "generic", "index.mjs"))}, ${JSON.stringify(join(linked, "generic", "extra.mjs"))})`]);
  } catch {
    /* no links on this machine */
  }
  let isLink = false;
  try {
    isLink = lstatSync(join(linked, "generic", "extra.mjs")).isSymbolicLink();
  } catch {
    isLink = false;
  }
  if (!isLink) return t.diagnostic("this machine cannot make a link: the link half is skipped");
  const l = copySet(linked);
  assert.equal(l.status, 1);
  assert.match(l.stderr, /generic: generic\/extra\.mjs is a link/);
});
