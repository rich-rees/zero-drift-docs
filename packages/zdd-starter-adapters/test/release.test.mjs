// The library's release workflow (decision 0048, As built slice 4): a tag of
// its own, `starter-adapters-vX.Y.Z`, publishes a freshly staged version
// through trusted publishing, runs no adapter code where it publishes, and
// touches nothing of the engine's. Read as text: nothing here publishes.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PKG } from "./starters.mjs";

const ROOT = join(PKG, "..", "..");
const wf = readFileSync(join(ROOT, ".github", "workflows", "release-starter-adapters.yml"), "utf8");
const engine = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
// The workflow's jobs, by name, as text.
const job = (name) => {
  const at = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(at > 0, `job ${name}`);
  const next = wf.slice(at + 1).search(/\n  [a-z-]+:\n/);
  return next < 0 ? wf.slice(at) : wf.slice(at, at + 1 + next);
};

test("a starter-adapters-v tag stages the version it names, and publishes only a fresh stage", () => {
  assert.match(wf, /tags:\n\s+- "starter-adapters-v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"/);
  const npm = wf.split(/\r?\n/).filter((l) => /\bnpm (view|publish|pack)\b|\bnpx\b/.test(l));
  assert.ok(npm.length >= 4, npm.join("\n"));
  for (const l of npm.filter((l) => /@rich-rees\//.test(l))) assert.match(l, /"@rich-rees\/zdd-starter-adapters@\$\{V\}"/, l);
  assert.deepEqual(npm.filter((l) => /npm publish/.test(l)).map((l) => l.trim()), ['run: cd "${GITHUB_WORKSPACE}/.starter-adapters-stage" && npm publish --access public --provenance'], "the staged folder, never the tree");
  assert.doesNotMatch(wf, /NPM_TOKEN|secrets\./, "trusted publishing: no secret");
  assert.match(wf, /merge-base --is-ancestor "\$\{GITHUB_SHA\}" origin\/main/, "only from main");
  assert.match(wf, /--latest=false/, "the engine's release stays the latest");
});

test("CR-290: the tests run in a job that cannot publish, on a stage it throws away; the publishing job runs nothing of the library's but the stager", () => {
  const prove = job("prove");
  const publish = job("publish");
  assert.match(prove, /permissions:\n\s+contents: read\n/);
  assert.doesNotMatch(prove, /id-token|contents: write/);
  assert.match(prove, /zdd-engine\.mjs test --adapters="\$\{RUNNER_TEMP\}\/proof-stage\/adapters"/, "the staged version's own tests run before anything publishes");
  assert.match(publish, /needs: prove/);
  assert.match(publish, /id-token: write/);
  assert.match(publish, /stage\.mjs "\$\{\{ needs\.prove\.outputs\.version \}\}" "\$\{GITHUB_WORKSPACE\}\/\.starter-adapters-stage"/, "staged fresh where it publishes");
  assert.doesNotMatch(publish, /node --test|zdd-engine\.mjs test|proof-stage/, "no test, and not the tested stage");
  assert.match(wf, /^permissions:\n\s+contents: read$/m, "the default is read-only");
});

test("CR-296: a rerun resumes only when npm holds these very bytes: the registry's integrity against the fresh stage packed", () => {
  const publish = job("publish");
  assert.match(publish, /npm view "@rich-rees\/zdd-starter-adapters@\$\{V\}" dist\.integrity/);
  assert.match(publish, /npm pack --dry-run --json/);
  assert.match(publish, /if \[ -n "\$\{HAVE\}" \] && \[ "\$\{HAVE\}" = "\$\{WANT\}" \]; then/);
  assert.doesNotMatch(publish, /gitHead/, "a commit claim is no proof of bytes");
});

test("the engine's tag never matches the library's, and the engine's release runs the library suite and the starters' own tests (its goldens live there)", () => {
  assert.match(engine, /tags:\n\s+- "v\[0-9\]/);
  assert.doesNotMatch(engine, /zdd-starter-adapters@/);
  assert.match(engine, /cd packages\/zdd-starter-adapters && node --test "test\/\*\.test\.mjs" && node \.\.\/zdd-engine\/bin\/zdd-engine\.mjs test --adapters=adapters/);
});
