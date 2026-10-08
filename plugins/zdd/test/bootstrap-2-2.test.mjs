// ZDD 2.2 adoption prompts (CAS-101): detection asks about a Realtime wrapper
// when Supabase sits beside a web app (the client's own .on("postgres_changes")
// needs nothing; a wrapper is invisible until named in subscribeCalls), and the
// services proposal says what its `usedBy` can and cannot see.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync, mkdtempSync, cpSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "test");
const BOOTSTRAP = join(PLUGIN, "scripts", "bootstrap.mjs");

const scratch = (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-boot22-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  return repo;
};
const detect = (repo, json = true) => execFileSync(process.execPath, [BOOTSTRAP, "detect", ...(json ? ["--json"] : []), `--root=${repo}`], { encoding: "utf8" });

test("Supabase beside a Next.js app: detection asks the Realtime-wrapper question, in JSON and in the narration", (t) => {
  const repo = scratch(t);
  mkdirSync(join(repo, "supabase", "migrations"), { recursive: true });
  writeFileSync(join(repo, "supabase", "migrations", "001_init.sql"), "create table things (id int);\n");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ dependencies: { next: "14.0.0" } }));
  const json = JSON.parse(detect(repo));
  assert.deepEqual(json.proposals.map((p) => p.name), ["supabase", "nextjs"]);
  const q = json.questions.find((x) => x.topic === "realtime");
  assert.ok(q, JSON.stringify(json.questions));
  assert.match(q.ask, /wrapper of its own/);
  assert.match(q.ask, /\.on\("postgres_changes"/);
  assert.deepEqual(q.records, "extractorOptions.nextjs.refs.subscribeCalls");
  assert.match(detect(repo, false), /^ {2}ask: Does the Next.js app subscribe to Supabase Realtime through a wrapper of its own/m);
});

test("Supabase alone, or a web app alone: no Realtime question", (t) => {
  const repo = scratch(t);
  mkdirSync(join(repo, "supabase", "migrations"), { recursive: true });
  writeFileSync(join(repo, "supabase", "migrations", "001_init.sql"), "create table things (id int);\n");
  assert.deepEqual(JSON.parse(detect(repo)).questions, []);
});

test("the services proposal says what usedBy sees: files carrying the marker, never a provider reached through a settings object", (t) => {
  const repo = scratch(t);
  cpSync(join(FIXTURES, "fixture-services"), repo, { recursive: true });
  rmSync(join(repo, "zdd"), { recursive: true });
  const services = JSON.parse(detect(repo)).proposals.find((p) => p.name === "services");
  assert.ok(services);
  assert.ok(services.evidence.some((e) => /usedBy lists the files carrying a service's marker.*never .*settings object/.test(e)), services.evidence.join("\n"));
});

// CAS-101 smoke: the upgrade skill records a confirmed opt-in extractor, and a
// named Realtime wrapper, with a repair apply — which wrote nothing when a
// config existed. A repair answer naming `extractors` sets the list;
// `extractorOptions` merge into each extractor's options (objects deep,
// arrays replaced); the hooks block and every other key are kept.
test("a repair apply records explicit extractors and merges extractorOptions, keeping everything else", (t) => {
  const repo = scratch(t);
  mkdirSync(join(repo, "zdd"), { recursive: true });
  const before = {
    name: "X",
    engine: "2.2.0",
    extractors: ["supabase", "nextjs"],
    extractorOptions: { supabase: { migrationNamespaces: [{ name: "db", dir: "migrations" }] }, nextjs: { appDir: "src/app", apiPrefix: "/api" } },
    hooks: { autoLoad: true, fence: true, stop: true },
    localExtractorDir: "zdd/extractors",
  };
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(before, null, 2) + "\n");
  const answers = join(repo, "answers.json");
  writeFileSync(answers, JSON.stringify({ extractors: ["supabase", "nextjs", "components"], extractorOptions: { components: { roots: ["src"] }, nextjs: { refs: { subscribeCalls: ["live.onInsert"] } } } }));
  const run = () => JSON.parse(execFileSync(process.execPath, [BOOTSTRAP, "apply", `--answers=${answers}`, "--json", `--root=${repo}`, "--date=2026-10-08"], { encoding: "utf8" }));
  const r = run();
  assert.ok(r.wrote.includes("zdd/config.json"), r.wrote.join("\n"));
  const after = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual(after.extractors, ["supabase", "nextjs", "components"]);
  assert.deepEqual(after.extractorOptions, {
    supabase: before.extractorOptions.supabase,
    nextjs: { appDir: "src/app", apiPrefix: "/api", refs: { subscribeCalls: ["live.onInsert"] } },
    components: { roots: ["src"] },
  });
  assert.deepEqual(after.hooks, before.hooks);
  assert.equal(after.localExtractorDir, "zdd/extractors");
  assert.deepEqual(Object.keys(after), Object.keys(before), "key order kept");
  assert.ok(r.notes.some((n) => /zdd\/config\.json: extractors supabase, nextjs → supabase, nextjs, components/.test(n)), r.notes.join("\n"));
  assert.ok(r.notes.some((n) => /zdd\/config\.json: extractorOptions updated for components, nextjs/.test(n)), r.notes.join("\n"));
  const again = run();
  assert.ok(!again.wrote.includes("zdd/config.json"), "the same answers again: nothing to write");
});

// ---- CAS-101 review fixes ------------------------------------------------
const applyIn = (repo, answers, extra = []) => {
  const file = join(repo, "answers.json");
  writeFileSync(file, JSON.stringify(answers));
  return execFileSync(process.execPath, [BOOTSTRAP, "apply", `--answers=${file}`, "--json", `--root=${repo}`, "--date=2026-10-08", ...extra], { encoding: "utf8" });
};
const applyFails = (repo, answers) => {
  const file = join(repo, "answers.json");
  writeFileSync(file, JSON.stringify(answers));
  try {
    execFileSync(process.execPath, [BOOTSTRAP, "apply", `--answers=${file}`, `--root=${repo}`, "--date=2026-10-08"], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    return String(e.stderr);
  }
  assert.fail("expected apply to fail");
};

test("Supabase beside BOTH a Next.js and a React Router app: one Realtime question per web extractor (CR-009)", (t) => {
  const repo = scratch(t);
  mkdirSync(join(repo, "supabase", "migrations"), { recursive: true });
  writeFileSync(join(repo, "supabase", "migrations", "001_init.sql"), "create table things (id int);\n");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ dependencies: { next: "14.0.0", "react-router-dom": "6.0.0" } }));
  mkdirSync(join(repo, "apps", "admin", "src"), { recursive: true });
  writeFileSync(join(repo, "apps", "admin", "src", "routes.tsx"), 'import { createBrowserRouter } from "react-router-dom";\nexport const router = createBrowserRouter([]);\n');
  const json = JSON.parse(detect(repo));
  assert.deepEqual(json.questions.filter((q) => q.topic === "realtime").map((q) => q.records).sort(), ["extractorOptions.nextjs.refs.subscribeCalls", "extractorOptions.react-router.subscribeCalls"]);
});

test("Supabase beside a web app with no Supabase: no Realtime question; a web app alone: none either", (t) => {
  const repo = scratch(t);
  writeFileSync(join(repo, "package.json"), JSON.stringify({ dependencies: { next: "14.0.0" } }));
  assert.deepEqual(JSON.parse(detect(repo)).questions, []);
});

test("a repair apply on a pre-1.0 `adapter` config refuses an extractors answer before writing — the engine refuses the mixed shape (CR-010)", (t) => {
  const repo = scratch(t);
  mkdirSync(join(repo, "zdd"), { recursive: true });
  const legacy = JSON.stringify({ adapter: "nextjs-supabase", adapterOptions: {} }, null, 2) + "\n";
  writeFileSync(join(repo, "zdd", "config.json"), legacy);
  assert.match(applyFails(repo, { extractors: ["supabase", "nextjs", "components"] }), /legacy "adapter".*run upgrade first/);
  assert.equal(readFileSync(join(repo, "zdd", "config.json"), "utf8"), legacy);
});

test("subscribeCalls must be an array of strings, in both places, before anything is written (CR-011)", (t) => {
  const repo = scratch(t);
  mkdirSync(join(repo, "zdd"), { recursive: true });
  const config = JSON.stringify({ extractors: ["supabase", "nextjs"], extractorOptions: { nextjs: { appDir: "src/app" } }, engine: "2.2.0" }, null, 2) + "\n";
  writeFileSync(join(repo, "zdd", "config.json"), config);
  assert.match(applyFails(repo, { extractorOptions: { nextjs: { refs: { subscribeCalls: "live.onInsert" } } } }), /nextjs\.refs\.subscribeCalls must be an array of call names/);
  assert.match(applyFails(repo, { extractorOptions: { "react-router": { subscribeCalls: ["ok", 3] } } }), /react-router\.subscribeCalls must be an array of call names/);
  assert.equal(readFileSync(join(repo, "zdd", "config.json"), "utf8"), config);
  applyIn(repo, { extractorOptions: { nextjs: { refs: { subscribeCalls: ["live.onInsert"] } } } });
});
