// Every starter passes the standard suite (decision 0040 point 6: the
// starters run it in the library's own CI), exactly as an app that copied
// it runs it (decision 0048): each starter carries its own `fixture/` and
// `SUITE` export, and is copied into the scratch repos from the library's
// adapters/ with what it reaches, its companions beside it the same way.
// So a copy passes the app's `zdd-engine suite` from the day it arrives.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runSuite, SUITE_CHECKS } from "../../zdd-engine/src/core/lib/suite.mjs";
import { CONTRACT, judgeContract } from "../../zdd-engine/src/core/lib/contract.mjs";
import { ADAPTERS } from "./starters.mjs";

const starterNames = readdirSync(ADAPTERS).filter((n) => existsSync(join(ADAPTERS, n, "index.mjs"))).sort();
const at = (n) => ({ path: join(ADAPTERS, n), entry: join(ADAPTERS, n, "index.mjs") });
const load = (name) => import(new URL(`../adapters/${name}/index.mjs`, import.meta.url));

test("every starter declares this engine's CONTRACT, a COMMENT, and a SUITE with its own fixture/ and companions beside it", async () => {
  assert.ok(starterNames.length >= 20, "the starters are found");
  for (const name of starterNames) {
    const mod = await load(name);
    assert.equal(mod.CONTRACT, CONTRACT, `${name}: the library keeps every starter at the contract the engine speaks`);
    const judged = judgeContract(name, mod);
    assert.equal(judged.fail, null, name);
    assert.equal(judged.warning, null, name);
    assert.ok(mod.COMMENT && typeof mod.COMMENT === "object", `${name} exports COMMENT`);
    assert.ok(mod.SUITE && typeof mod.SUITE.options === "object", `${name} exports SUITE`);
    // A file in it, not just the folder: git keeps no empty folder, so a
    // clone (CI, an app's copy) would have none.
    assert.ok(existsSync(join(ADAPTERS, name, "fixture")) && readdirSync(join(ADAPTERS, name, "fixture")).length > 0, `${name} carries its fixture/, with a file in it`);
    for (const c of Object.keys(mod.SUITE.companions ?? {})) assert.ok(starterNames.includes(c) && c !== name, `${name}: companion ${c} is another starter`);
  }
});

for (const name of starterNames) {
  test(`the standard suite: ${name}`, async () => {
    const mod = await load(name);
    const { options = {}, companions = {}, allowEmpty = false } = mod.SUITE;
    const companionPaths = Object.fromEntries(Object.keys(companions).map((c) => [c, at(c)]));
    const r = runSuite({ name, fixtureDir: join(ADAPTERS, name, "fixture"), options, comment: mod.COMMENT, trapDir: join(ADAPTERS, name, "fixture-trap"), local: { path: at(name).path }, entry: at(name).entry, within: ADAPTERS, allowEmpty, companions, companionPaths });
    const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.n} ${SUITE_CHECKS[c.n - 1].id}: ${c.detail}`);
    assert.deepEqual(failed, [], `${name} fails the standard suite`);
    if (!allowEmpty) assert.ok(r.records > 0, `${name}: the fixture gives records`);
  });
}
