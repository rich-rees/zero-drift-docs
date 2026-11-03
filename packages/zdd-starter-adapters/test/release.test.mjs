// The library's release workflow (decision 0048, As built slice 4): a tag of
// its own, `starter-adapters-vX.Y.Z`, publishes the staged version through trusted
// publishing, and touches nothing of the engine's. Read as text: nothing
// here publishes.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PKG } from "./starters.mjs";

const ROOT = join(PKG, "..", "..");
const wf = readFileSync(join(ROOT, ".github", "workflows", "release-starter-adapters.yml"), "utf8");
const engine = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");

test("a starter-adapters-v tag stages the version it names, proves both suites, and publishes the staged folder only", () => {
  assert.match(wf, /tags:\n\s+- "starter-adapters-v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"/);
  assert.match(wf, /node packages\/zdd-starter-adapters\/scripts\/stage\.mjs "\$\{V\}" "\$\{GITHUB_WORKSPACE\}\/\.starter-adapters-stage"/);
  const npm = wf.split(/\r?\n/).filter((l) => /\bnpm (view|publish)\b|\bnpx\b/.test(l));
  assert.ok(npm.length >= 4, npm.join("\n"));
  for (const l of npm.filter((l) => /@rich-rees\//.test(l))) assert.match(l, /"@rich-rees\/zdd-starter-adapters@\$\{V\}"/, l);
  assert.deepEqual(npm.filter((l) => /npm publish/.test(l)).map((l) => l.trim()), ['cd "${GITHUB_WORKSPACE}/.starter-adapters-stage" && npm publish --access public --provenance'], "the staged folder, never the tree");
  assert.doesNotMatch(wf, /NPM_TOKEN|secrets\./, "trusted publishing: no secret");
  assert.match(wf, /id-token: write/);
  assert.match(wf, /merge-base --is-ancestor "\$\{GITHUB_SHA\}" origin\/main/, "only from main");
  assert.match(wf, /--latest=false/, "the engine's release stays the latest");
  assert.match(wf, /zdd-engine\.mjs test --adapters="\$\{GITHUB_WORKSPACE\}\/\.starter-adapters-stage\/adapters"/, "the staged version's own tests run before it publishes");
});

test("the engine's tag never matches the library's, and the engine's release runs the library suite (its goldens live there)", () => {
  assert.match(engine, /tags:\n\s+- "v\[0-9\]/);
  assert.doesNotMatch(engine, /zdd-starter-adapters@/);
  assert.match(engine, /cd packages\/zdd-starter-adapters && node --test "test\/\*\.test\.mjs"/);
});
