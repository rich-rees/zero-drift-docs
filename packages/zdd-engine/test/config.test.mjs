// Extractor selection + path containment (src/core/lib/config.mjs, src/core/lib/paths.mjs).
// Review CR-001 / CR-006 / CR-019 (0.3.0 campaign).
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveExtractors, validateRepoBase, validatePathLayout, DEFAULT_PATHS } from "../src/core/lib/config.mjs";
import { repoRelative, insideRepo, overlaps } from "../src/core/lib/paths.mjs";

test("extractors list: names + per-name options; missing options default to {}", () => {
  const r = resolveExtractors({ extractors: ["supabase", "generic"], extractorOptions: { supabase: { a: 1 } } });
  assert.deepEqual(r.extractors, [
    { name: "supabase", options: { a: 1 } },
    { name: "generic", options: {} },
  ]);
  assert.deepEqual(r.diagnostics, []);
});

test("the pre-1.0 adapter key is refused since 0.14, with the route across, whatever its options (decision 0048)", () => {
  for (const config of [{ adapter: "nextjs-supabase", adapterOptions: { appDir: "src/app" } }, { adapter: "nextjs-supabase" }, { adapter: "anything" }, { adapter: 5 }]) {
    const r = resolveExtractors(config);
    assert.equal(r.extractors, undefined, JSON.stringify(config));
    assert.match(r.error, /names 'adapter' \(.*\), a bundle of adapters the engine shipped before 1\.0\. Since ZDD 0\.14 a repo owns every adapter it runs/);
    assert.match(r.error, /"upgrade ZDD" does both: it rewrites the config and copies the adapters in from the starter library \(npm @rich-rees\/zdd-starter-adapters\)/);
  }
});

test("a name is what it says: no alias reads another name's options, and options under a name not listed are said, never a failure (CR-424)", () => {
  const r = resolveExtractors({ extractors: ["a"], extractorOptions: { a: { x: 1 }, b: { y: 2 } } });
  assert.deepEqual(r.extractors, [{ name: "a", options: { x: 1 } }]);
  assert.deepEqual(r.diagnostics, [`[config] extractorOptions has 'b', which no adapter in "extractors" is called — those options are read by nobody; move them under the adapter's name, or delete them`]);
  assert.deepEqual(resolveExtractors({ extractors: ["services"], extractorOptions: { "external-services": {} } }).extractors, [{ name: "services", options: {} }], "a pre-0.14 alias is just a name");
  assert.deepEqual(resolveExtractors({ extractors: ["a"] }).diagnostics, []);
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
  // Legacy pair: `adapterOptions: null` used to destructure null (TypeError);
  // since 0.14 the pair is refused before its options are read.
  for (const bad of [null, [], "x"]) {
    const r = resolveExtractors({ adapter: "nextjs-supabase", adapterOptions: bad });
    assert.match(r.error ?? "", /names 'adapter'/, JSON.stringify(bad));
  }
  assert.ok(!resolveExtractors({ extractors: ["supabase"] }).error);
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
  // Another drive than the root's — the GitHub Windows runner works on D:, so
  // the letter is chosen, not assumed: relative() answers an absolute path.
  if (process.platform === "win32") outside(`${root[0].toUpperCase() === "D" ? "E" : "D"}:\\srv\\Repo\\x`);
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
