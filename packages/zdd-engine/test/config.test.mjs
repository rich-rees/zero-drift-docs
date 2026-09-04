// Extractor selection + path containment (src/lib/config.mjs, src/lib/paths.mjs).
// Review CR-001 / CR-006 / CR-019 (DIO-309 campaign).
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveExtractors, validateRepoBase, validatePathLayout, DEFAULT_PATHS } from "../src/lib/config.mjs";
import { repoRelative, insideRepo, overlaps } from "../src/lib/paths.mjs";

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

test("CR-117: mixed tiers are refused — extractorOptions beside adapter, adapterOptions beside extractors — never silently ignored", () => {
  const a = resolveExtractors({ adapter: "nextjs-supabase", extractorOptions: { nextjs: { appDir: "src/app" } } });
  assert.match(a.error ?? "", /both 'adapter' and 'extractorOptions'.*keep one tier/, JSON.stringify(a));
  const b = resolveExtractors({ extractors: ["supabase", "nextjs"], adapterOptions: { appDir: "src/app" } });
  assert.match(b.error ?? "", /both 'extractors' and 'adapterOptions'.*keep one tier/, JSON.stringify(b));
  // The options-only cross (no adapter, no extractors) is still "names no extractors".
  assert.match(resolveExtractors({ extractorOptions: {} }).error, /names no extractors/);
});

test("no selection at all is an error", () => {
  assert.match(resolveExtractors({}).error, /names no extractors/);
});

test("CR-107: extractorOptions / adapterOptions and each per-extractor entry must be plain objects — a clean error, never a TypeError or a pass-through", () => {
  for (const bad of [null, [], "supabase", 5]) {
    const r = resolveExtractors({ extractors: ["supabase"], extractorOptions: bad });
    assert.match(r.error ?? "", /'extractorOptions' must be an object keyed by extractor name/, JSON.stringify(bad));
  }
  for (const bad of [null, [], "x", 5]) {
    const r = resolveExtractors({ extractors: ["nextjs"], extractorOptions: { nextjs: bad } });
    assert.match(r.error ?? "", /'extractorOptions\.nextjs' must be an object/, JSON.stringify(bad));
  }
  // Legacy pair: `adapterOptions: null` used to destructure null (TypeError).
  for (const bad of [null, [], "x"]) {
    const r = resolveExtractors({ adapter: "nextjs-supabase", adapterOptions: bad });
    assert.match(r.error ?? "", /'adapterOptions' must be an object/, JSON.stringify(bad));
  }
  // Absent is fine on both forms.
  assert.ok(!resolveExtractors({ extractors: ["supabase"] }).error);
  assert.ok(!resolveExtractors({ adapter: "nextjs-supabase" }).error);
});

test("CR-103: validateRepoBase accepts empty or an http(s) URL with no whitespace; refuses a bare scheme, other schemes, non-strings", () => {
  for (const ok of [undefined, "", "https://github.com/example/repo/tree/main/", "http://localhost:3000/x", "HTTPS://Example.test/"]) {
    assert.equal(validateRepoBase(ok), null, JSON.stringify(ok));
  }
  // The plugin's bootstrap once accepted `https://` and a URL with an inner
  // space (CR-078); the engine's rule — `^https?:\/\/\S+$` — is the contract.
  for (const bad of ["https://", "https://example.test/ bad", " https://example.test", "https://example.test\n", "ftp://x", "javascript:alert(1)", "example.test", 42, null, {}]) {
    assert.match(validateRepoBase(bad) ?? "", /'repoBase' must be empty or an http\(s\) URL/, JSON.stringify(bad));
  }
});

test("repoRelative: accepts repo-relative POSIX, rejects absolute, traversal and backslashes (CR-005/CR-006)", () => {
  assert.equal(repoRelative("src/app", "appDir"), "src/app");
  assert.equal(repoRelative("./src/app/", "appDir"), "src/app");
  assert.equal(repoRelative(".", "root"), ".");
  for (const bad of ["../x", "a/../../x", "/abs", "C:/abs", "a\\b", "..", "\\\\share\\x"]) {
    assert.throws(() => repoRelative(bad, "p"), /p '.*' must be repo-relative/, bad);
  }
});

test("CR-067: insideRepo compares by path segments and folds case only where the filesystem does", () => {
  const root = resolve("/srv/Repo"); // drive-qualified on Windows, as-is elsewhere
  const inside = (p) => assert.equal(insideRepo(root, p, "x"), p, `${p} is inside ${root}`);
  const outside = (p) => assert.throws(() => insideRepo(root, p, "x"), /x resolves outside the repo/, `${p} is outside ${root}`);
  inside(root);
  inside(`${root}/`);
  inside(resolve(root, "zdd", "metadata"));
  inside(resolve(root, "..foo")); // a segment that merely starts with `..`
  outside(resolve("/srv/Repo2/x")); // string prefix, different directory
  outside(resolve("/srv"));
  outside(resolve(root, "..", "other"));
  if (process.platform === "win32") outside("D:\\srv\\Repo\\x"); // another drive: relative() answers an absolute path
  // The case rule: `/srv/repo` is the same directory as `/srv/Repo` on Windows
  // and macOS, and a DIFFERENT one on Linux — where the old lowercase-everywhere
  // compare let a case-variant sibling checkout pass as "inside" (CR-067).
  const variant = resolve("/srv/repo/zdd/graph.json");
  if (process.platform === "win32" || process.platform === "darwin") inside(variant);
  else outside(variant);
});

test("CR-059/CR-061: overlaps() folds case exactly where insideRepo does — a case-variant metadataDir cannot slip past the layout rule on Windows/macOS", () => {
  assert.ok(overlaps("zdd/metadata", "zdd/metadata"));
  assert.ok(overlaps("zdd", "zdd/metadata/x.json"));
  assert.ok(!overlaps("zdd/metadata", "zdd/metadata2"));
  // `zdd/Metadata` IS `zdd/metadata` on a case-folding filesystem: derive
  // would prune the real folder while the layout rule saw two distinct names.
  // On Linux they are different directories and stay distinct.
  const folds = process.platform === "win32" || process.platform === "darwin";
  assert.equal(overlaps("zdd/Metadata", "zdd/metadata"), folds);
  assert.equal(overlaps("ZDD", "zdd/map/x.md"), folds);
  const layout = validatePathLayout({ ...DEFAULT_PATHS, metadataDir: "zdd/Map" }, "zdd/config.json");
  if (folds) assert.match(layout ?? "", /paths\.metadataDir 'zdd\/Map' overlaps paths\.mapDir/);
  else assert.equal(layout, null);
  const outputs = validatePathLayout({ ...DEFAULT_PATHS, agentIndex: "zdd/Graph.json" }, "zdd/config.json");
  if (folds) assert.match(outputs ?? "", /paths\.graph 'zdd\/graph\.json' overlaps paths\.agentIndex 'zdd\/Graph\.json'/);
  else assert.equal(outputs, null);
});
