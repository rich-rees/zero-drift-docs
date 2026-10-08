// expo-router extractor (CAS-97 item 3, early): screens from an Expo Router
// tree — groups stripped, index folded, [id] dynamic, _layout files as
// layouts carried on every screen beneath them, + files skipped, a platform
// pair as one screen; ids namespaced so a native /jobs and a web /jobs are
// two surfaces calling the same endpoint. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { derive } from "../src/extractors/expo-router/index.mjs";
import { derive as fastapi } from "../src/extractors/fastapi/index.mjs";
import { derive as reactRouter } from "../src/extractors/react-router/index.mjs";
import { resolveRefs } from "../src/lib/resolve-refs.mjs";
import { makeExtractorIo } from "../src/lib/extractor-io.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(PKG, "test", "fixture-components");

test("fixture: one surface per screen and per layout, namespaced and titled '(native)'; groups stripped from the URL but kept as a fact; index folds; [id] is dynamic; layouts listed root first; a platform pair is one record; +not-found is not a screen", () => {
  const out = derive({ repoRoot: FIXTURE, options: { appDir: "apps/mobile/app" }, io: makeExtractorIo(FIXTURE, "expo-router") });
  assert.deepEqual(
    out.records.map((r) => r.id),
    ["surface:native:/", "surface:native:/(tabs)/_layout", "surface:native:/_layout", "surface:native:/jobs", "surface:native:/jobs/[id]", "surface:native:/settings"],
  );
  const by = (id) => out.records.find((r) => r.id === id);
  const jobs = by("surface:native:/jobs");
  assert.equal(jobs.title, "/jobs (native)");
  assert.equal(jobs.description, "The job list, the same endpoint the web page reads.");
  assert.deepEqual(jobs.resource, ["apps/mobile/app/(tabs)/jobs/index.tsx"]);
  assert.deepEqual(jobs.refs, ["?route:/jobs"]);
  assert.deepEqual(jobs.facts, { file: "screen", routeGroups: ["(tabs)"], dynamicSegments: [], layouts: ["apps/mobile/app/_layout.tsx", "apps/mobile/app/(tabs)/_layout.tsx"], edges: { calls: ["?route:/jobs"] } });
  assert.equal(jobs.filename, "native--jobs.json");
  const job = by("surface:native:/jobs/[id]");
  assert.deepEqual(job.facts.dynamicSegments, ["id"]);
  assert.deepEqual(job.refs, ["?route:/jobs/*/route"], "the template hole is a parameter, expanded by decision 0019's rule");
  const settings = by("surface:native:/settings");
  assert.deepEqual(settings.resource, ["apps/mobile/app/settings.android.tsx", "apps/mobile/app/settings.ios.tsx"]);
  assert.deepEqual(settings.facts.platforms, ["android", "ios"]);
  assert.deepEqual(settings.facts.layouts, ["apps/mobile/app/_layout.tsx"]);
  const root = by("surface:native:/_layout");
  assert.equal(root.facts.file, "layout");
  assert.deepEqual(root.facts.layouts, []);
  assert.deepEqual(by("surface:native:/(tabs)/_layout").facts.layouts, ["apps/mobile/app/_layout.tsx"]);
  assert.deepEqual(out.diagnostics, []);
});

test("after the merge: the native /jobs and the web /jobs both call route:/jobs, as two surfaces", () => {
  const api = fastapi({ repoRoot: FIXTURE, options: { roots: ["apps/api"] } });
  const web = reactRouter({ repoRoot: FIXTURE, options: { routesFile: "apps/web/src/routes.tsx" } });
  const native = derive({ repoRoot: FIXTURE, options: { appDir: "apps/mobile/app" }, io: makeExtractorIo(FIXTURE, "expo-router") });
  const { records } = resolveRefs([...api.records, ...web.records, ...native.records]);
  const callers = records.filter((r) => r.kind === "surface" && r.refs.includes("route:/jobs")).map((r) => r.id).sort();
  assert.deepEqual(callers, ["surface:/jobs", "surface:native:/jobs"]);
  assert.deepEqual(records.find((r) => r.id === "surface:native:/jobs/[id]").refs, ["route:/jobs/{job_id}/route"]);
});

test("a missing appDir is nothing to inventory; a tree with only plumbing says so; a bad option is refused", (t) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-expo-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const io = () => makeExtractorIo(root, "expo-router");
  const none = derive({ repoRoot: root, options: {}, io: io() });
  assert.deepEqual(none.records, []);
  assert.deepEqual(none.diagnostics, ["app not found — nothing to inventory"]);
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "app", "+html.tsx"), "export default function Html() { return null; }\n");
  writeFileSync(join(root, "app", "_private.ts"), "export const x = 1;\n");
  const plumbing = derive({ repoRoot: root, options: {}, io: io() });
  assert.deepEqual(plumbing.records, []);
  assert.deepEqual(plumbing.diagnostics, ["no screens under app — nothing to inventory"]);
  assert.throws(() => derive({ repoRoot: root, options: { appDir: "../elsewhere" }, io: io() }), /expo-router\.appDir '\.\.\/elsewhere' must be repo-relative/);
});
