// Extractor selection + path containment (src/lib/config.mjs, src/lib/paths.mjs).
// Review CR-001 / CR-006 / CR-019 (DIO-309 campaign).
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveExtractors } from "../src/lib/config.mjs";
import { repoRelative } from "../src/lib/paths.mjs";

test("extractors list: names + per-name options; missing options default to {}", () => {
  const r = resolveExtractors({ extractors: ["supabase", "generic"], extractorOptions: { supabase: { a: 1 } } });
  assert.deepEqual(r.extractors, [
    { name: "supabase", options: { a: 1 } },
    { name: "generic", options: {} },
  ]);
  assert.deepEqual(r.diagnostics, []);
});

test("legacy adapter expands to [supabase, nextjs] with options split by key and one deprecation note", () => {
  const r = resolveExtractors({ adapter: "nextjs-supabase", adapterOptions: { appDir: "src/app", migrationNamespaces: [{ name: "db", dir: "m" }], externalBuckets: [] } });
  assert.deepEqual(r.extractors.map((e) => e.name), ["supabase", "nextjs"]);
  assert.deepEqual(r.extractors[0].options, { migrationNamespaces: [{ name: "db", dir: "m" }], externalBuckets: [] });
  assert.deepEqual(r.extractors[1].options, { appDir: "src/app" });
  assert.equal(r.diagnostics.length, 1);
  assert.match(r.diagnostics[0], /deprecated/);
});

test("empty, duplicate and non-string extractor lists are errors (CR-001)", () => {
  assert.match(resolveExtractors({ extractors: [] }).error, /at least one extractor/);
  assert.match(resolveExtractors({ extractors: ["generic", "generic"] }).error, /listed twice/);
  assert.match(resolveExtractors({ extractors: [42] }).error, /must be strings/);
  assert.match(resolveExtractors({ extractors: "supabase" }).error, /must be an array/);
});

test("both adapter and extractors present is an error, never a silent precedence (CR-019)", () => {
  const r = resolveExtractors({ adapter: "nextjs-supabase", extractors: ["supabase", "nextjs"] });
  assert.match(r.error, /both 'adapter' and 'extractors'/);
});

test("no selection at all is an error", () => {
  assert.match(resolveExtractors({}).error, /names no extractors/);
});

test("repoRelative: accepts repo-relative POSIX, rejects absolute, traversal and backslashes (CR-005/CR-006)", () => {
  assert.equal(repoRelative("src/app", "appDir"), "src/app");
  assert.equal(repoRelative("./src/app/", "appDir"), "src/app");
  assert.equal(repoRelative(".", "root"), ".");
  for (const bad of ["../x", "a/../../x", "/abs", "C:/abs", "a\\b", "..", "\\\\share\\x"]) {
    assert.throws(() => repoRelative(bad, "p"), /p '.*' must be repo-relative/, bad);
  }
});
