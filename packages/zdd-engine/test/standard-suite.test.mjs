// Every catalogue adapter passes the standard suite (decision 0040 point 6:
// catalogue adapters run it in ZDD's own CI). Each one is named here with the
// fixture it runs on and the options it reads it with; a catalogue adapter
// missing from this table fails the first test, so a new adapter cannot ship
// without passing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuite, SUITE_CHECKS } from "../src/core/lib/suite.mjs";
import { CONTRACT, judgeContract } from "../src/core/lib/contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTERS = join(HERE, "..", "src", "adapters");
const fx = (name) => join(HERE, name);
const DB = { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] };

export const CATALOGUE_SUITE = {
  supabase: { fixture: fx("fixture-jobs"), options: DB },
  // A data-access adapter links the routes or screens that reach its code to
  // the tables a schema adapter mints: both run beside it as companions.
  "supabase-js": { fixture: fx("fixture"), options: { roots: ["src"] }, companions: { supabase: { migrationNamespaces: [{ name: "db", dir: "migrations" }] }, nextjs: { appDir: "src/app" } } },
  "supabase-py": { fixture: fx("fixture-fastapi"), options: { roots: ["main.py", "api"] }, companions: { supabase: DB, fastapi: { roots: ["main.py", "api"] } } },
  sqlalchemy: { fixture: fx("fixture-sqlalchemy"), options: { roots: ["app"] }, companions: { supabase: DB, fastapi: { roots: ["app"] } } },
  fastapi: { fixture: fx("fixture-fastapi"), options: { roots: ["main.py", "api"] } },
  nextjs: {
    fixture: fx("fixture"),
    options: { appDir: "src/app", apiPrefix: "/api", middlewarePath: "src/middleware.ts", authPatterns: [{ includes: "verifySignature", auth: "hmac" }], refs: { roots: ["src"], extensions: [".ts", ".tsx"], excludeDirs: ["node_modules"], excludeSuffixes: [".test.ts"] } },
  },
  "react-router": { fixture: fx("fixture-react-router"), options: { routesFile: "apps/web/src/routes.tsx" } },
  "expo-router": { fixture: fx("fixture-components"), options: { appDir: "apps/mobile/app" } },
  components: { fixture: fx("fixture-components"), options: { roots: ["apps/web/src", "apps/mobile", "packages/ui/src"] } },
  "external-services": {
    fixture: fx("fixture-services"),
    options: { services: [{ name: "Sentry", imports: ["sentry_sdk", "@sentry/react"], env: ["SENTRY_"] }, { name: "Resend", env: ["RESEND_"] }], ignore: ["MAPBOX"] },
  },
  "background-railway": { fixture: fx("fixture-jobs"), options: {} },
  "background-procfile": { fixture: fx("fixture-jobs"), options: { modes: { worker: "worker" } } },
  "background-vercel": { fixture: fx("fixture-jobs"), options: {} },
  "background-cloudflare": { fixture: fx("fixture-jobs"), options: {} },
  "background-pg-cron": { fixture: fx("fixture-jobs"), options: {} },
  "background-compose": { fixture: fx("fixture-jobs"), options: {} },
  "background-bullmq": { fixture: fx("fixture-jobs"), options: {} },
  "background-github-actions": { fixture: fx("fixture-jobs"), options: {} },
  "background-inngest": { fixture: fx("fixture-queues"), options: {} },
  "background-trigger-dev": { fixture: fx("fixture-queues"), options: {} },
  "background-sqs": { fixture: fx("fixture-queues"), options: {} },
  "background-declared": { fixture: fx("fixture-jobs"), options: { entries: [{ name: "sweeper", module: "app.housekeeping", cwd: "apps/api", mode: "scheduled", schedule: "0 2 * * *" }] } },
  // Emits nothing, by design: the suite still holds it to the rest.
  generic: { fixture: fx("fixture-greenfield"), options: {}, allowEmpty: true },
};

const catalogueNames = readdirSync(ADAPTERS).filter((n) => existsSync(join(ADAPTERS, n, "index.mjs"))).sort();

test("every catalogue adapter is in the suite's table, declares this engine's CONTRACT and a COMMENT", async () => {
  assert.deepEqual(Object.keys(CATALOGUE_SUITE).sort(), catalogueNames);
  for (const name of catalogueNames) {
    const mod = await import(new URL(`../src/adapters/${name}/index.mjs`, import.meta.url));
    assert.equal(mod.CONTRACT, CONTRACT, `${name}: the release updates every catalogue adapter to the contract it speaks`);
    const judged = judgeContract(name, mod);
    assert.equal(judged.fail, null, name);
    assert.equal(judged.warning, null, name);
    assert.ok(mod.COMMENT && typeof mod.COMMENT === "object", `${name} exports COMMENT`);
  }
});

for (const name of Object.keys(CATALOGUE_SUITE)) {
  test(`the standard suite: ${name}`, async () => {
    const { fixture, options, allowEmpty = false, companions = {} } = CATALOGUE_SUITE[name];
    const mod = await import(new URL(`../src/adapters/${name}/index.mjs`, import.meta.url));
    const r = runSuite({ name, fixtureDir: fixture, options, comment: mod.COMMENT, entry: join(ADAPTERS, name, "index.mjs"), within: ADAPTERS, allowEmpty, companions });
    const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.n} ${SUITE_CHECKS[c.n - 1].id}: ${c.detail}`);
    assert.deepEqual(failed, [], `${name} fails the standard suite`);
    if (!allowEmpty) assert.ok(r.records > 0, `${name}: the fixture gives records`);
  });
}
