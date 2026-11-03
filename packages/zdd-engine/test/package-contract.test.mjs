// The package is the new line's (decision 0042): `@rich-rees/zdd`, whose
// command line is its contract, with one entry beside it since 0.14: the
// adapter test kit, which an adapter's own tests import by the package's
// name (decision 0048, As built slice 4). The `exports` map opens
// package.json and the kit, and no other source file. And the upgrade's
// word for a new adapter (decision 0037): `upgradeAdds`, carried through
// `detect` for the plugin.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectRepo } from "../src/core/lib/detect-repo.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));

test("the engine publishes as @rich-rees/zdd with one bin, and its exports map opens the kit and package.json only (decisions 0042, 0048)", () => {
  assert.equal(manifest.name, "@rich-rees/zdd");
  assert.deepEqual(manifest.exports, { ".": "./src/core/kit.mjs", "./package.json": "./package.json" });
  assert.deepEqual(Object.keys(manifest.bin), ["zdd-engine"], "one bin: `npx -y @rich-rees/zdd@X.Y.Z <command>` runs it");
});

test("importing the package by name: package.json and the kit resolve, any other source file is refused by Node (decision 0042; slice 2b's CR-062–064)", (t) => {
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
      '  try { const m = await import(spec, spec.endsWith(".json") ? { with: { type: "json" } } : undefined); out[spec] = m.default?.name ?? Object.keys(m).sort().join(","); }',
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
  assert.equal(got["@rich-rees/zdd"], "ioFor,scanFor,trialRead", "the kit, and nothing else");
});

test("upgradeAdds: detect carries a release number an adapter declares to the plugin, and nothing else (decision 0037)", (t) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-upgradeadds-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const adapter = (name, upgradeAdds) => ({ name, mod: { DETECTION: { parts: ["queries"], order: 1, ...(upgradeAdds === undefined ? {} : { upgradeAdds }) }, detect: () => null } });
  const d = detectRepo(root, [adapter("a", "0.9.0"), adapter("b"), adapter("c", "soon")]);
  assert.equal(d.adapters.a.upgradeAdds, "0.9.0");
  assert.equal(d.adapters.b.upgradeAdds, undefined);
  assert.equal(d.adapters.c.upgradeAdds, undefined, "only a release number is carried: anything else is not the plugin's to read");
});
