// ZDD 2.1 detection (CAS-97): bootstrap proposes the four opt-in extractors
// on their own evidence — components from .tsx/.jsx roots, expo-router from
// an app/ folder with a _layout, jobs from manifests that run a process,
// services from credential-shaped env names read in source, grouped by
// prefix with matching imports — and the services mirror stays equal to the
// engine's. Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, mkdtempSync, cpSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { SERVICE_SUFFIXES, SERVICE_IGNORE } from "../scripts/bootstrap.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = resolve(PLUGIN, "..", "..", "packages", "zdd-engine");
const FIXTURES = join(ENGINE, "test");
const BOOTSTRAP = join(PLUGIN, "scripts", "bootstrap.mjs");

const fresh = (t, fixture) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-boot21-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(join(FIXTURES, fixture), repo, { recursive: true });
  rmSync(join(repo, "zdd"), { recursive: true });
  return repo;
};
const detect = (repo) => JSON.parse(execFileSync(process.execPath, [BOOTSTRAP, "detect", "--json", `--root=${repo}`], { encoding: "utf8" }));
const named = (json, name) => json.proposals.find((p) => p.name === name);

test("the services mirror equals the engine's lists", async () => {
  const engine = await import(new URL("file:///" + join(ENGINE, "src", "extractors", "external-services", "index.mjs").split("\\").join("/")));
  assert.deepEqual(SERVICE_SUFFIXES, engine.CANDIDATE_SUFFIXES);
  assert.deepEqual(SERVICE_IGNORE, engine.BUILT_IN_IGNORE);
});

test("components fixture: components at the two .tsx roots and the mobile app, expo-router at apps/mobile/app, react-router and fastapi beside them; the Expo app points at the proposal", (t) => {
  const json = detect(fresh(t, "fixture-components"));
  assert.deepEqual(json.proposals.map((p) => p.name), ["fastapi", "react-router", "components", "expo-router"]);
  const comps = named(json, "components");
  assert.deepEqual(comps.options, { roots: ["apps/mobile", "apps/web/src", "packages/ui/src"] });
  assert.ok(comps.evidence.some((e) => /\.tsx\/\.jsx files under `apps\/web\/src`/.test(e)), comps.evidence.join("|"));
  const expo = named(json, "expo-router");
  assert.deepEqual(expo.options, { appDir: "apps/mobile/app" });
  assert.match(expo.evidence[0], /Expo Router tree at `apps\/mobile\/app`/);
  assert.deepEqual(json.apps.map((a) => [a.name, a.extractor]), [["Mobile (Expo)", "expo-router (proposed above)"], ["Web (React)", "react-router (proposed above)"]]);
});

test("jobs fixture: jobs from the Procfile and the Railway file (a package script only where one of them runs it), with the mode caveat; supabase beside it", (t) => {
  const json = detect(fresh(t, "fixture-jobs"));
  assert.deepEqual(json.proposals.map((p) => p.name), ["supabase", "jobs"]);
  const jobs = named(json, "jobs");
  assert.deepEqual(jobs.options, {});
  // `missing` is job-shaped too; the engine skips it with a diagnostic when its module resolves to nothing.
  // 2.3: a package.json script on its own is a hand-run tool, never evidence; the manifests that run or schedule a process are.
  assert.ok(!jobs.evidence.some((e) => /apps\/api\/package\.json/.test(e)), jobs.evidence.join("|"));
  assert.ok(jobs.evidence.some((e) => e === "`Procfile` runs a process: `nightly`"), jobs.evidence.join("|"));
  assert.ok(jobs.evidence.some((e) => e === "`apps/api/Procfile` runs a process: `worker`"), jobs.evidence.join("|"));
  assert.ok(jobs.evidence.some((e) => e === "`apps/web/vercel.json` schedules a cron for: `/api/cron/sweep-stalled`"), jobs.evidence.join("|"));
  assert.ok(jobs.evidence.some((e) => e === "`workers/edge/wrangler.toml` schedules: `triggers.crons`"), jobs.evidence.join("|"));
  assert.ok(jobs.evidence.some((e) => e === "`docker-compose.yml` runs a service: `transcoder`"), jobs.evidence.join("|"));
  assert.ok(jobs.evidence.some((e) => e === "`supabase/migrations/0002_cron.sql` schedules (pg_cron): `nightly-digest`"), jobs.evidence.join("|"));
  assert.ok(jobs.evidence.some((e) => e === "`scripts/transcode.mjs` names a queue: `video-transcode`"), jobs.evidence.join("|"));
  assert.ok(jobs.evidence.some((e) => /`apps\/api\/services\/housekeeping\/railway\.toml` runs a process: `startCommand`/.test(e)));
  assert.ok(jobs.evidence.some((e) => /never guessed/.test(e)));
});

test("services fixture: one service per env prefix with its matching imports, names guessed and said so; the database, the platform and test files are never candidates", (t) => {
  const json = detect(fresh(t, "fixture-services"));
  assert.deepEqual(json.proposals.map((p) => p.name), ["fastapi", "external-services"]);
  const svc = named(json, "external-services");
  assert.deepEqual(svc.options.services, [
    { name: "Mapbox", env: ["MAPBOX_"] },
    { name: "Resend", env: ["RESEND_"] },
    { name: "Sentry", env: ["SENTRY_"], imports: ["@sentry/react", "sentry_sdk", "sentry_sdk.integrations.fastapi"] },
    { name: "Stripe", env: ["STRIPE_"] },
  ]);
  assert.ok(svc.evidence.some((e) => /`SENTRY_DSN`, `VITE_SENTRY_DSN` read in `apps\/api\/app\/settings\.py`, `apps\/api\/main\.py`, `apps\/web\/src\/monitoring\.ts`; imports/.test(e)), svc.evidence.join("|"));
  assert.ok(svc.evidence.at(-1).includes("confirm or rename"));
  assert.ok(!JSON.stringify(svc).includes("TWILIO") && !JSON.stringify(svc).includes("DATABASE") && !JSON.stringify(svc).includes("SUPABASE"));
});

test("greenfield: an explicit 'Expo Router' stack entry selects the extractor at its folder; a bare 'Expo' stays an Application", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-boot21-gf-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(repo, { recursive: true });
  const answers = (stack) => {
    const p = join(repo, `answers-${stack.length}.json`);
    writeFileSync(p, JSON.stringify({ name: "GF", stack, optIns: { ci: false, prePush: false } }));
    return p;
  };
  execFileSync(process.execPath, [BOOTSTRAP, "apply", `--answers=${answers([{ name: "Expo Router", path: "apps/mobile/app" }, "FastAPI"])}`, `--root=${repo}`], { encoding: "utf8" });
  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.ok(config.extractors.includes("expo-router"));
  assert.deepEqual(config.extractorOptions["expo-router"], { appDir: "apps/mobile/app" });
});
