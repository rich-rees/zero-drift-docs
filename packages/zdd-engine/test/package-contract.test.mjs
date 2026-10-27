// The package is the new line's (decision 0042): `@rich-rees/zdd`, whose
// command line is its whole contract — an `exports` map opens package.json
// and no source file. And the upgrade's word for the data-access adapters
// (decision 0037): `upgradeAdds`, carried through `detect` for the plugin.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectRepo } from "../src/core/lib/detect-repo.mjs";
import { catalogueModules } from "../src/core/derive.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));

test("the engine publishes as @rich-rees/zdd with one bin, and its exports map opens package.json only (decision 0042)", () => {
  assert.equal(manifest.name, "@rich-rees/zdd");
  assert.deepEqual(manifest.exports, { "./package.json": "./package.json" });
  assert.deepEqual(Object.keys(manifest.bin), ["zdd-engine"], "one bin: `npx -y @rich-rees/zdd@X.Y.Z <command>` runs it");
});

test("importing the package by name: package.json resolves, a source file and the bare name are refused by Node (decision 0042; slice 2b's CR-062–064)", (t) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-exports-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "node_modules", "@rich-rees"), { recursive: true });
  symlinkSync(PKG, join(root, "node_modules", "@rich-rees", "zdd"), "junction");
  const probe = join(root, "probe.mjs");
  writeFileSync(
    probe,
    [
      'const out = {};',
      'for (const spec of ["@rich-rees/zdd/package.json", "@rich-rees/zdd/src/core/derive.mjs", "@rich-rees/zdd"]) {',
      '  try { const m = await import(spec, spec.endsWith(".json") ? { with: { type: "json" } } : undefined); out[spec] = m.default?.name ?? "loaded"; }',
      '  catch (e) { out[spec] = e.code; }',
      '}',
      'process.stdout.write(JSON.stringify(out));',
    ].join("\n"),
  );
  const r = spawnSync(process.execPath, [probe], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.equal(got["@rich-rees/zdd/package.json"], "@rich-rees/zdd");
  assert.equal(got["@rich-rees/zdd/src/core/derive.mjs"], "ERR_PACKAGE_PATH_NOT_EXPORTED");
  assert.equal(got["@rich-rees/zdd"], "ERR_PACKAGE_PATH_NOT_EXPORTED");
});

test("upgradeAdds: the three data-access adapters say 0.9.0, no other adapter says anything, and detect carries the word to the plugin (decision 0037)", async (t) => {
  const modules = await catalogueModules();
  const says = Object.fromEntries(modules.filter(({ mod }) => mod.DETECTION?.upgradeAdds !== undefined).map(({ name, mod }) => [name, mod.DETECTION.upgradeAdds]));
  assert.deepEqual(says, { "supabase-js": "0.9.0", "supabase-py": "0.9.0", sqlalchemy: "0.9.0" });
  const root = mkdtempSync(join(tmpdir(), "zdd-upgradeadds-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const d = detectRepo(root, modules);
  for (const [n, v] of Object.entries(says)) assert.equal(d.adapters[n].upgradeAdds, v, n);
  assert.equal(d.adapters.nextjs.upgradeAdds, undefined);
  // Only a release number is carried: anything else is not the plugin's to read.
  const odd = modules.map((m) => (m.name === "supabase-js" ? { name: m.name, mod: { ...m.mod, DETECTION: { ...m.mod.DETECTION, upgradeAdds: "soon" } } } : m));
  assert.equal(detectRepo(root, odd).adapters["supabase-js"].upgradeAdds, undefined);
});
