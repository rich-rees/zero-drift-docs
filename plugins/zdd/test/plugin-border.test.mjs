// The plugin's border (decision 0039): the plugin names no stack. What a
// stack looks like — its evidence, its options, its greenfield rules, the
// records an example can link — is each adapter's own data, read through the
// engine's detection. A new adapter is one folder in the engine; the plugin's
// scripts are not edited.
//
// The exceptions are fenced, each with its reason. Mostly the upgrade's
// migrations from earlier releases: they rewrite configs a past release
// wrote, so they spell the names that release used (a renamed adapter, the
// retired `jobs`, the pre-1.0 bundle) and the notes each release printed.
// Besides those: the git hosts the CI offer reads, the interpreters the fence
// recognises, and the scaffold's mirror of the catalogue (a test holds it
// equal). Such code sits between a `// border: names a stack (<why>)` line and
// a `// border: end` line, and nowhere else may a stack word appear in the
// plugin's scripts, in code or in comments. The words are the engine's tripwire list
// (packages/zdd-engine/test/stack-words.mjs) — a tripwire, not a proof.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WORD_RE } from "../../../packages/zdd-engine/test/stack-words.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = join(PLUGIN, "scripts");

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(mjs|cjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

// Every stack word outside a fence, as `file:line: word`;
// and every fence that does not open with a reason or is left unclosed.
export function borderOffenders(name, text) {
  const out = [];
  let fence = null;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*\/\/ border: names a stack\b/.test(line)) {
      if (fence !== null) out.push(`${name}:${i + 1}: a fence opened inside another (line ${fence})`);
      if (!/^\s*\/\/ border: names a stack \(.+\)/.test(line)) out.push(`${name}:${i + 1}: a fence must say why, in brackets`);
      fence = i + 1;
      return;
    }
    if (/^\s*\/\/ border: end\b/.test(line)) {
      if (fence === null) out.push(`${name}:${i + 1}: a fence closed that was never opened`);
      fence = null;
      return;
    }
    if (fence !== null) return;
    for (const m of line.matchAll(WORD_RE())) out.push(`${name}:${i + 1}: ${m[2]}`);
  });
  if (fence !== null) out.push(`${name}:${fence}: a fence is never closed`);
  return out;
}

test("no plugin script names a stack outside a fence that says why (decision 0039)", () => {
  const offenders = [];
  for (const p of files(SCRIPTS)) offenders.push(...borderOffenders(relative(PLUGIN, p).split(sep).join("/"), readFileSync(p, "utf8")));
  assert.deepEqual(offenders, []);
});

test("the border check catches a stack word, an unexplained fence and an unclosed one", () => {
  assert.deepEqual(borderOffenders("a.mjs", 'const x = "fastapi";\n'), ["a.mjs:1: fastapi"]);
  assert.deepEqual(borderOffenders("a.mjs", "// adapter-react helper\n"), ["a.mjs:1: react"]);
  assert.deepEqual(borderOffenders("a.mjs", '// border: names a stack (2.3 renamed it)\nconst y = "supabase";\n// border: end\n'), []);
  assert.deepEqual(borderOffenders("a.mjs", '// border: names a stack\nconst y = "supabase";\n// border: end\n'), ["a.mjs:1: a fence must say why, in brackets"]);
  assert.deepEqual(borderOffenders("a.mjs", '// border: names a stack (x)\nconst y = "supabase";\n'), ["a.mjs:1: a fence is never closed"]);
  assert.deepEqual(borderOffenders("a.mjs", "// border: end\n"), ["a.mjs:1: a fence closed that was never opened"]);
});
