// external-services extractor (2.1.0, decision 0020; renamed from `services` in 2.3, 2.3.0, pick 3): declared markers, names only;
// one record per declared service whose resource is the declaring file;
// usedBy edges to the records in the files that hit a marker; an env name
// with a credential-shaped suffix that no service covers is a warning on
// every derive. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { scanEnvReads, scanImports, derive, CANDIDATE_SUFFIXES, BUILT_IN_IGNORE } from "../adapters/external-services/index.mjs";
import { derive as fastapi } from "../adapters/fastapi/index.mjs";
import { resolveRefs } from "../../zdd-engine/src/core/lib/resolve-refs.mjs";
import { makeExtractorIo } from "../../zdd-engine/src/core/lib/extractor-io.mjs";
import { copyFixture } from "./starters.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "..", "zdd-engine", "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture-services");

test("scanEnvReads: every read shape, Python and JS, names only; scanImports: Python and JS forms", () => {
  const text = `
    os.environ["A_KEY"]; os.environ.get("B_DSN", ""); os.getenv("C_SECRET")
    e.get("D_TOKEN", ""); settings.get("lowercase_ignored")
    process.env.E_URL; process.env["F_API_KEY"]; import.meta.env.VITE_G_DSN; Deno.env.get("H_KEY")
    const value = "sk_live_not_a_name";
  `;
  assert.deepEqual([...scanEnvReads(text)].sort(), ["A_KEY", "B_DSN", "C_SECRET", "D_TOKEN", "E_URL", "F_API_KEY", "H_KEY", "VITE_G_DSN"]);
  const py = `import os, sentry_sdk\nfrom sentry_sdk.integrations.fastapi import FastApiIntegration\nimport httpx\n`;
  assert.deepEqual([...scanImports(py)].sort(), ["httpx", "os", "sentry_sdk", "sentry_sdk.integrations.fastapi"]);
  const js = `import * as Sentry from "@sentry/react";\nimport x from './x';\nconst s = require("stripe");\nimport "./side-effect";\n`;
  assert.deepEqual([...scanImports(js)].sort(), ["./side-effect", "./x", "@sentry/react", "stripe"]);
  assert.ok(CANDIDATE_SUFFIXES.includes("_API_KEY") && BUILT_IN_IGNORE.includes("DATABASE") && BUILT_IN_IGNORE.includes("SUPABASE"));
});

test("fixture: Sentry from an import and an env prefix across Python and TS, resource = the import site; Resend from an env prefix alone, resource = the reading file; an unused declaration is no record; test files are skipped; STRIPE_ is a warning, MAPBOX is ignored", () => {
  const out = derive({ repoRoot: FIXTURE, options: JSON.parse(readFileSync(join(FIXTURE, "zdd", "config.json"), "utf8")).extractorOptions["external-services"], io: makeExtractorIo(FIXTURE, "external-services") });
  assert.deepEqual(out.records.map((r) => r.id), ["external-service:resend", "external-service:sentry"]);
  const sentry = out.records.find((r) => r.id === "external-service:sentry");
  assert.deepEqual(sentry.resource, ["apps/api/app/monitoring.py"]);
  assert.deepEqual(sentry.facts.markers, ["env SENTRY_", "import @sentry/react", "import sentry_sdk"]);
  assert.deepEqual(sentry.facts.usedBy, ["apps/api/app/monitoring.py", "apps/api/app/settings.py", "apps/api/main.py", "apps/web/src/monitoring.ts"]);
  assert.deepEqual(sentry.facts.edges.usedBy, sentry.facts.usedBy.map((f) => `?at:${f}`));
  const resend = out.records.find((r) => r.id === "external-service:resend");
  assert.deepEqual(resend.resource, ["apps/api/app/settings.py"]);
  assert.deepEqual(resend.facts.markers, ["env RESEND_"]);
  assert.ok(!out.records.some((r) => r.title === "Unused"));
  assert.ok(out.diagnostics.some((d) => /service 'Unused' is declared but nothing imports nothing_imports_this/.test(d)), out.diagnostics.join("\n"));
  assert.deepEqual(out.warnings, [
    'STRIPE_SECRET, STRIPE_WEBHOOK_SECRET read in apps/api/app/settings.py matches no declared service — add { "name": "…", "env": ["STRIPE_"] } to extractorOptions["external-services"].services, or "STRIPE" to its ignore list',
  ]);
  assert.ok(!out.warnings.some((w) => /TWILIO|MAPBOX|DATABASE|SUPABASE|PORT|EMAIL/.test(w)), "test files, ignored prefixes, the database and non-credential names are never candidates");
});

test("after the merge: usedBy resolves to the route in main.py and never to another service; a file that is nobody's resource is a quiet drop", () => {
  const api = fastapi({ repoRoot: FIXTURE, options: { roots: ["apps/api"] }, io: makeExtractorIo(FIXTURE, "fastapi") });
  const svc = derive({ repoRoot: FIXTURE, options: { services: [{ name: "Sentry", imports: ["sentry_sdk"], env: ["SENTRY_"] }, { name: "Resend", env: ["RESEND_"] }] }, io: makeExtractorIo(FIXTURE, "external-services") });
  const { records, diagnostics } = resolveRefs([...api.records, ...svc.records]);
  const sentry = records.find((r) => r.id === "external-service:sentry");
  assert.deepEqual(sentry.refs, ["route:/health"]);
  assert.deepEqual(sentry.facts.edges, { usedBy: ["route:/health"] });
  assert.deepEqual(records.find((r) => r.id === "external-service:resend").refs, []);
  assert.ok(diagnostics.some((d) => /'apps\/api\/app\/settings\.py' is no record's resource — dropped/.test(d)));
});

test("config shapes are refused by name; the extractor runs with no declarations and still reports candidates", () => {
  const io = () => makeExtractorIo(FIXTURE, "external-services");
  assert.throws(() => derive({ repoRoot: FIXTURE, options: { services: [{ name: "X" }] }, io: io() }), /external-services\.services\[0\] \(X\): declare at least one import or env marker/);
  assert.throws(() => derive({ repoRoot: FIXTURE, options: { services: [{ imports: ["a"] }] }, io: io() }), /external-services\.services\[0\] must have a name/);
  assert.throws(() => derive({ repoRoot: FIXTURE, options: { services: [{ name: "A", env: ["A_"] }, { name: "a", env: ["B_"] }] }, io: io() }), /'a' is declared twice/);
  assert.throws(() => derive({ repoRoot: FIXTURE, options: { services: "Sentry" }, io: io() }), /external-services\.services must be an array/);
  const none = derive({ repoRoot: FIXTURE, options: {}, io: io() });
  assert.deepEqual(none.records, []);
  assert.ok(none.warnings.some((w) => /RESEND_API_KEY/.test(w)) && none.warnings.some((w) => /SENTRY_DSN/.test(w)) && none.warnings.some((w) => /STRIPE_/.test(w)));
});

test("CLI: the warning prints on a plain derive (no --verbose); derive and render are byte-stable; the graph types the service and draws usedBy; the map's External Service page links the record", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-svc-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  copyFixture(FIXTURE, repo);
  const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
  const d = run(["derive"]);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /Wrote 3 records \(2 external-services, 1 routes\)/);
  assert.match(d.stderr, /^WARNING \[external-services\]: STRIPE_SECRET, STRIPE_WEBHOOK_SECRET read in apps\/api\/app\/settings\.py matches no declared service/m);
  assert.doesNotMatch(d.stderr, /\[refs\]/, "diagnostics stay verbose-only");
  assert.equal(run(["derive", "--check"]).status, 0);
  assert.equal(run(["render"]).status, 0);
  assert.equal(run(["render", "--check"]).status, 0);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  const sentry = graph.nodes.find((n) => n.id === "metadata/external-service/sentry");
  assert.equal(sentry.type, "External Service");
  assert.equal(sentry.resource, "apps/api/app/monitoring.py");
  assert.ok(graph.edges.some((e) => e.source === sentry.id && e.target === "metadata/route/health" && e.verb === "usedBy"));
  assert.ok(graph.edges.some((e) => e.source === "map/external-services/sentry" && e.target === sentry.id));
  // Declaring Stripe silences the warning.
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  cfg.extractorOptions["external-services"].services.push({ name: "Stripe", env: ["STRIPE_"] });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(cfg));
  const d2 = run(["derive"]);
  assert.equal(d2.status, 0);
  assert.doesNotMatch(d2.stderr, /WARNING/);
  assert.match(d2.stdout, /3 external-services/);
});

// The 2.3 alias, since 0.14: the engine held the rename while it shipped
// the adapter; a repo now holds its adapters by the names its config says
// (decision 0048), and "upgrade ZDD" renames the key as it always did.
test("2.3 alias, since 0.14: a config that still says `services` is a name the repo does not hold, pointed at \"upgrade ZDD\"", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-svc-alias-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  copyFixture(FIXTURE, repo);
  const cfgPath = join(repo, "zdd", "config.json");
  const fresh = JSON.parse(readFileSync(cfgPath, "utf8"));
  writeFileSync(cfgPath, JSON.stringify({ ...fresh, extractors: ["fastapi", "services"], extractorOptions: { fastapi: fresh.extractorOptions.fastapi, services: fresh.extractorOptions["external-services"] } }));
  const d = spawnSync(process.execPath, [BIN, "derive"], { cwd: repo, encoding: "utf8" });
  assert.equal(d.status, 1);
  assert.match(d.stderr, /Extractor 'services' is not one of this repo's adapters: localExtractorDir \(zdd\/extractors\) holds .*external-services.*say "upgrade ZDD"/);
  assert.ok(!existsSync(join(repo, "zdd", "metadata")), "nothing written");
});

test("CR-424/CR-425: options under a key no listed adapter has are said on every derive, never dropped in silence; the old `service` kind renders — legacy map links resolve, the node type is External Service, no service-to-service edge", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-svc-alias2-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  copyFixture(FIXTURE, repo);
  const cfgPath = join(repo, "zdd", "config.json");
  const fresh = JSON.parse(readFileSync(cfgPath, "utf8"));
  const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
  // New name in the list, options still under the old key: since 0.14 no
  // alias reads them for the adapter, so derive says the key is read by nobody.
  writeFileSync(cfgPath, JSON.stringify({ ...fresh, extractors: ["fastapi", "external-services"], extractorOptions: { fastapi: fresh.extractorOptions.fastapi, services: fresh.extractorOptions["external-services"] } }));
  const d = run(["derive"]);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stderr, /\[config\] extractorOptions has "services", which no adapter in "extractors" is called — those options are read by nobody/);
  // The old kind end to end: a repo's adapter that still writes `service`
  // records (as the 2.3 alias did), its map links, rendered.
  writeFileSync(join(repo, "zdd", "extractors", "services.mjs"), 'import * as m from "./external-services/index.mjs";\nexport const { CONTRACT, COMMENT, FACTS_KEY_ORDER } = m;\nexport const derive = (a) => m.derive({ ...a, legacyName: "services" });\n');
  // The alias end to end: old records, old map links, rendered.
  writeFileSync(cfgPath, JSON.stringify({ ...fresh, extractors: ["fastapi", "services"], extractorOptions: { fastapi: fresh.extractorOptions.fastapi, services: fresh.extractorOptions["external-services"] } }));
  const page = join(repo, "zdd", "map", "external-services", "sentry.md");
  writeFileSync(page, readFileSync(page, "utf8").replace("metadata/external-service/sentry.json", "metadata/service/sentry.json"));
  assert.equal(run(["derive"]).status, 0);
  assert.ok(existsSync(join(repo, "zdd", "metadata", "service", "sentry.json")));
  const r = run(["render"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(run(["render", "--check"]).status, 0);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  const sentry = graph.nodes.find((n) => n.id === "metadata/service/sentry");
  assert.equal(sentry.type, "External Service");
  assert.ok(graph.edges.some((e) => e.source === "map/external-services/sentry" && e.target === sentry.id), "the legacy map link resolves");
  assert.ok(!graph.edges.some((e) => e.source.startsWith("metadata/service/") && e.target.startsWith("metadata/service/")), "no service-to-service edge");
  assert.match(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), /\(metadata\/service\/sentry\.json\)/, "the index links the old folder");
});
