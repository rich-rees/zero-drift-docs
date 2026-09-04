// Graph artifact + viewer registry (DIO-310): `render` emits the map+metadata
// join as zdd/graph.json and produces the human index through a viewer
// selected by config. The Cytoscape viewer is viewer #1, isolated under its
// Apache-2.0 notice; `minimal` is the forker's worked example. The goldens
// under test/golden/ were captured from v0.3.1 (engine 0.3.0) before this
// refactor — the BUNDLE the Cytoscape viewer embeds must still equal them.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, existsSync, readdirSync, statSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");
const FIXTURE_FASTAPI = join(PKG, "test", "fixture-fastapi");
const FIXTURE_GREENFIELD = join(PKG, "test", "fixture-greenfield");
const GOLDEN = join(PKG, "test", "golden");

const mkRepo = (fixture) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-view-"));
  cpSync(fixture, repo, { recursive: true });
  return repo;
};
const run = (repo, args) =>
  execFileSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const readConfig = (repo) => JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
const writeConfig = (repo, config) => writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(config, null, 2));
const readBundleRaw = (repo) => {
  const html = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  const m = /window\.BUNDLE = (.*);\n/.exec(html);
  assert.ok(m, "human-index.html embeds window.BUNDLE");
  return m[1];
};
const readBundle = (repo) => JSON.parse(readBundleRaw(repo));
const tree = (dir, base = dir, out = new Map()) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tree(p, base, out);
    else out.set(relative(base, p).split(/[\\/]/).join("/"), readFileSync(p, "utf8"));
  }
  return out;
};

test("default viewer: BUNDLE (byte for byte) and agent index equal the v0.3.1 goldens on the Next.js fixture", () => {
  const repo = mkRepo(FIXTURE);
  run(repo, ["derive"]);
  run(repo, ["render"]);
  // The golden is the raw `window.BUNDLE = …` literal captured from engine
  // 0.3.0 — a string compare, so serialisation order counts too (CR-021).
  assert.equal(readBundleRaw(repo) + "\n", readFileSync(join(GOLDEN, "human-index-bundle-v0.3.1-nextjs-supabase.json"), "utf8"));
  assert.equal(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), readFileSync(join(GOLDEN, "agent-index-v0.3.1-nextjs-supabase.md"), "utf8"));
  rmSync(repo, { recursive: true, force: true });
});

// CR-096: the BUNDLE golden proves the data; nothing proved the PAGE. This is
// the whole human-index.html with the two vendored library bodies swapped
// back for their placeholders (they are checked against the vendor files
// byte-for-byte), so a change to viz.html / viz.css / viz.js / safe-marked.js
// or the embed shows up as a golden diff without committing 400 KB of
// cytoscape. Regenerate only deliberately (test/golden/README.md).
const VENDOR = [
  ["/*__CYTOSCAPE_JS__*/", join(PKG, "src", "viewers", "cytoscape", "vendor", "cytoscape.min.js")],
  ["/*__MARKED_JS__*/", join(PKG, "src", "viewers", "cytoscape", "vendor", "marked.min.js")],
];
const withoutVendor = (html) => {
  for (const [marker, file] of VENDOR) {
    const body = readFileSync(file, "utf8");
    const at = html.indexOf(body);
    assert.ok(at !== -1, `${file} is inlined verbatim`);
    assert.equal(html.indexOf(body, at + 1), -1, `${file} is inlined once`);
    html = html.slice(0, at) + marker + html.slice(at + body.length);
  }
  return html;
};

test("CR-096: the whole human-index.html (vendor bodies elided) equals its golden on the Next.js fixture", () => {
  const repo = mkRepo(FIXTURE);
  run(repo, ["derive"]);
  run(repo, ["render"]);
  const html = withoutVendor(readFileSync(join(repo, "zdd", "human-index.html"), "utf8"));
  assert.equal(html, readFileSync(join(GOLDEN, "human-index-v1.0-nextjs-supabase.html"), "utf8"));
  rmSync(repo, { recursive: true, force: true });
});

test("graph artifact: every record and map concept is a node with a resource; every ref and map link is an edge", () => {
  const repo = mkRepo(FIXTURE);
  run(repo, ["derive"]);
  run(repo, ["render"]);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  assert.equal(graph.schema, "zdd-graph/1");
  const records = [...tree(join(repo, "zdd", "metadata")).values()].map((s) => JSON.parse(s));
  const mapFiles = [...tree(join(repo, "zdd", "map")).keys()];
  assert.equal(graph.nodes.length, records.length + mapFiles.length);
  for (const n of graph.nodes) {
    assert.ok(typeof n.resource === "string", `${n.id} carries resource`);
    assert.ok(["map", "metadata"].includes(n.layer), `${n.id} has a layer`);
  }
  // Resolved refs → edges (node ids are bundle-relative paths minus extension).
  const idOf = new Map(graph.nodes.filter((n) => n.layer === "metadata").map((n) => [n.recordId, n.id]));
  const edgeKeys = new Set(graph.edges.map((e) => `${e.source}→${e.target}`));
  for (const r of records) for (const ref of r.refs) assert.ok(edgeKeys.has(`${idOf.get(r.id)}→${idOf.get(ref)}`), `${r.id} -> ${ref}`);
  assert.ok(edgeKeys.has("map/features/things→metadata/table/db--things"));
  assert.ok(edgeKeys.has("map/apps/fixture-app→map/features/things"));
  // Viewer-derived fields stay out of the artifact.
  for (const n of graph.nodes) for (const k of ["color", "size"]) assert.ok(!(k in n), `${k} is a viewer concern`);
  assert.ok(!("docs" in graph) && !("palette" in graph));
  // --check covers it.
  assert.match(run(repo, ["render", "--check"]), /in sync/);
  writeFileSync(join(repo, "zdd", "graph.json"), "{}\n");
  const { status, stderr } = spawnSync(process.execPath, [BIN, "render", "--check"], { cwd: repo, encoding: "utf8" });
  assert.notEqual(status, 0);
  assert.match(stderr, /graph\.json/);
  rmSync(repo, { recursive: true, force: true });
});

test("viewer 'minimal': graph.json byte-identical to the default run; only human-index.html differs", () => {
  const a = mkRepo(FIXTURE);
  const b = mkRepo(FIXTURE);
  writeConfig(b, { ...readConfig(b), viewer: "minimal" });
  for (const r of [a, b]) {
    run(r, ["derive"]);
    run(r, ["render"]);
  }
  const ta = tree(join(a, "zdd"));
  const tb = tree(join(b, "zdd"));
  assert.deepEqual([...ta.keys()], [...tb.keys()]);
  for (const [rel, content] of ta) {
    if (rel === "human-index.html") assert.notEqual(content, tb.get(rel));
    else if (rel === "config.json") continue;
    else assert.equal(content, tb.get(rel), rel);
  }
  const html = tb.get("human-index.html");
  assert.ok(!html.includes("cytoscape"), "minimal viewer vendors nothing");
  assert.ok(html.includes("metadata/table/db--things"));
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
});

test("viewer selection: string or object form; unknown name exits non-zero listing the registry", () => {
  const repo = mkRepo(FIXTURE);
  run(repo, ["derive"]);
  writeConfig(repo, { ...readConfig(repo), viewer: { name: "cytoscape", defaultFocus: "map/features/things" } });
  run(repo, ["render"]);
  assert.deepEqual(readBundle(repo).viewer, { defaultFocus: "map/features/things" });
  writeConfig(repo, { ...readConfig(repo), viewer: "nope" });
  const { status, stderr } = spawnSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" });
  assert.notEqual(status, 0);
  assert.match(stderr, /Unknown viewer "nope"/);
  assert.match(stderr, /cytoscape/);
  assert.match(stderr, /minimal/);
  // Pre-registry shape: an options object with no name is cytoscape with
  // every option preserved (CR-019).
  writeConfig(repo, { ...readConfig(repo), viewer: { defaultFocus: "map/features/things", authHubs: ["map/features/things"], nonAreaTags: ["things"] } });
  const legacy = spawnSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" });
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.match(legacy.stdout, /viewer cytoscape/);
  assert.deepEqual(readBundle(repo).viewer, { defaultFocus: "map/features/things", authHubs: ["map/features/things"], nonAreaTags: ["things"] });
  assert.match(legacy.stderr, /viewer\.nonAreaTags.*top-level "nonAreaTags"/);
  // Malformed option shapes are refused up front, not mid-render (CR-012).
  writeConfig(repo, { ...readConfig(repo), viewer: { nonAreaTags: {} } });
  assert.match(spawnSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" }).stderr, /viewer\.nonAreaTags.*array of strings/);
  rmSync(repo, { recursive: true, force: true });
});

test("graph.json is viewer-independent: nonAreaTags shapes it from the top level, whichever viewer is selected (CR-003)", () => {
  const repo = mkRepo(FIXTURE);
  writeFileSync(
    join(repo, "zdd", "map", "features", "things.md"),
    readFileSync(join(repo, "zdd", "map", "features", "things.md"), "utf8").replace("tags: [things]", "tags: [react-flow, things]"),
  );
  run(repo, ["derive"]);
  const base = readConfig(repo);
  const graphWith = (config) => {
    writeConfig(repo, config);
    run(repo, ["render"]);
    return readFileSync(join(repo, "zdd", "graph.json"), "utf8");
  };
  const tagOf = (json, id) => JSON.parse(json).nodes.find((n) => n.id === id).tags;
  // Without the exclusion the derived record inherits the first tag, react-flow.
  assert.deepEqual(tagOf(graphWith(base), "metadata/table/db--things"), ["react-flow"]);
  const excluded = graphWith({ ...base, nonAreaTags: ["react-flow"] });
  assert.deepEqual(tagOf(excluded, "metadata/table/db--things"), ["things"]);
  // Same bytes whichever viewer renders it.
  assert.equal(graphWith({ ...base, nonAreaTags: ["react-flow"], viewer: "minimal" }), excluded);
  assert.equal(graphWith({ ...base, nonAreaTags: ["react-flow"], viewer: { name: "cytoscape", defaultFocus: "map/features/things" } }), excluded);
  // …and the cytoscape viewer receives the same list for its own area model
  // (verification CR-026), whether it came from the top level or the legacy key.
  assert.deepEqual(readBundle(repo).viewer, { defaultFocus: "map/features/things", nonAreaTags: ["react-flow"] });
  graphWith({ ...base, viewer: { nonAreaTags: ["react-flow"] } });
  assert.deepEqual(readBundle(repo).viewer, { nonAreaTags: ["react-flow"] });
  rmSync(repo, { recursive: true, force: true });
});

test("bucketing guards: a shared route family keeps its area, and a dynamic segment is never the area (CR-004)", () => {
  const routes = (ids) =>
    `export function derive() { return { records: [${ids.map((id) => `{ kind: "route", id: ${JSON.stringify("route:" + id)}, title: ${JSON.stringify(id)}, description: "", resource: ["api.py"], refs: [], facts: { methods: ["GET"] }, filename: ${JSON.stringify(id.replace(/[^a-z]+/g, "-") + ".json")} }`).join(",")}], diagnostics: [] }; }`;
  const cases = [
    [["/v1/jobs", "/v1/jobs/{id}"], { "/v1/jobs": "jobs", "/v1/jobs/{id}": "jobs" }],
    [["/jobs/{id}"], { "/jobs/{id}": "jobs" }],
    [["/api/things", "/api/things/[id]", "/api/hooks/status"], { "/api/things": "things", "/api/things/[id]": "things", "/api/hooks/status": "hooks" }],
    [["/{id}"], { "/{id}": "root" }],
  ];
  for (const [ids, expected] of cases) {
    const repo = mkRepo(FIXTURE_GREENFIELD);
    mkdirSync(join(repo, "zdd", "extractors"), { recursive: true });
    writeFileSync(join(repo, "zdd", "extractors", "routes.mjs"), routes(ids));
    writeConfig(repo, { ...readConfig(repo), localExtractorDir: "zdd/extractors", extractors: ["routes"] });
    run(repo, ["derive"]);
    run(repo, ["render"]);
    const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
    for (const [id, area] of Object.entries(expected)) {
      assert.deepEqual(graph.nodes.find((n) => n.recordId === `route:${id}`).tags, [area], `${ids.join(" ")} → ${id}`);
    }
    rmSync(repo, { recursive: true, force: true });
  }
});

test("edges: every fixture map link and ref is an edge, exactly once, and self-links are dropped (CR-020)", () => {
  const repo = mkRepo(FIXTURE);
  // Duplicate a link and add a self-link to the feature's own file.
  const things = join(repo, "zdd", "map", "features", "things.md");
  writeFileSync(things, readFileSync(things, "utf8") + "\n- [things table again](../../metadata/table/db--things.json)\n- [itself](things.md)\n");
  run(repo, ["derive"]);
  run(repo, ["render"]);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  const records = [...tree(join(repo, "zdd", "metadata")).values()].map((s) => JSON.parse(s));
  const idOf = new Map(graph.nodes.filter((n) => n.layer === "metadata").map((n) => [n.recordId, n.id]));
  const expected = new Set();
  for (const r of records) for (const ref of r.refs) expected.add(`${idOf.get(r.id)}→${idOf.get(ref)}`);
  for (const link of ["map/apps/fixture-app→map/features/things", "map/features/things→metadata/table/db--things", "map/features/things→metadata/route/things", "map/features/things→metadata/route/things--_id", "map/features/things→metadata/function/db--save_thing"]) expected.add(link);
  const actual = graph.edges.map((e) => `${e.source}→${e.target}`);
  assert.equal(new Set(actual).size, actual.length, "no duplicate edges");
  assert.deepEqual(new Set(actual), expected);
  rmSync(repo, { recursive: true, force: true });
});

test("hostile inputs: the renderer refuses scheme-shaped resource and repoBase; the minimal viewer escapes every field (CR-002, CR-017)", async () => {
  const repo = mkRepo(FIXTURE);
  run(repo, ["derive"]);
  const things = join(repo, "zdd", "map", "features", "things.md");
  const original = readFileSync(things, "utf8");
  // Scheme, and scheme hidden behind whitespace/control characters that a
  // browser would strip (verification of CR-002).
  for (const bad of ["javascript:alert(1)", "\"\\tjavascript:alert(1)\"", "\"java\\nscript:alert(1)\"", "\" javascript:alert(1)\""]) {
    writeFileSync(things, original.replace("resource: src/components", `resource: ${bad}`));
    const out = spawnSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" });
    assert.notEqual(out.status, 0, bad);
    assert.match(out.stderr, /map\/features\/things: resource .* must be repo-relative/, bad);
  }
  writeFileSync(things, original);
  let out;
  writeConfig(repo, { ...readConfig(repo), repoBase: "javascript:alert(1)//" });
  out = spawnSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /'repoBase' must be empty or an http\(s\) URL/);
  rmSync(repo, { recursive: true, force: true });

  // Viewer belt: a graph the renderer would never emit still comes out inert.
  const { render } = await import("../src/viewers/minimal/index.mjs");
  const html = render({
    graph: { schema: "zdd-graph/1", nodes: [
      { id: "map/x", layer: "map", type: "<b>T</b>", title: "<img src=x onerror=alert(1)>", description: "\"><script>alert(2)</script>", resource: "javascript:alert(3)", tags: [], body: "" },
      { id: "map/y", layer: "map", type: "Feature", title: "ok", description: "", resource: "src/a.ts", tags: [], body: "" },
      { id: "map/z", layer: "map", type: "Feature", title: "ws", description: "", resource: "\tjavascript:alert(6)", tags: [], body: "" },
    ], edges: [{ source: "map/x", target: "map/y" }] },
    docs: { glossary: "", adrs: [] }, changed: { adrs: [], glossaryTerms: [] }, options: {},
    bundleName: "<svg onload=alert(4)>", repoBase: "javascript:alert(5)//",
  });
  assert.ok(!/<(img|script|svg)\b/i.test(html), html);
  assert.ok(!/<[^>]*\son(error|load)=/i.test(html), "no handler attribute inside a real tag");
  assert.ok(!/href="javascript/i.test(html), html);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  // Under a bad repoBase no source link is emitted at all; in-page edge
  // anchors (#id) are the only hrefs left.
  for (const m of html.matchAll(/href="([^"]*)"/g)) assert.ok(m[1].startsWith("#"), `unexpected href ${m[1]}`);
});

test("symlinks are never followed on read or write (CR-014/015/016)", (t) => {
  const repo = mkRepo(FIXTURE);
  run(repo, ["derive"]);
  const secret = join(repo, "secret.txt");
  writeFileSync(secret, "TOKEN=hunter2\n");
  try {
    symlinkSync(secret, join(repo, "zdd", "adr", "0009-leak.md"), "file");
    symlinkSync(".", join(repo, "zdd", "map", "loop"), "dir");
  } catch (e) {
    if (e.code === "EPERM") {
      // Windows without Developer Mode: cannot create symlinks; the guard is
      // still exercised on Linux CI. Narrated, not silent.
      t.skip("symlink creation needs privileges on this machine (EPERM)");
      rmSync(repo, { recursive: true, force: true });
      return;
    }
    throw e;
  }
  run(repo, ["render"]);
  const html = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  assert.ok(!html.includes("hunter2"), "symlinked ADR not embedded");
  // A symlinked output path is refused.
  rmSync(join(repo, "zdd", "graph.json"));
  symlinkSync(secret, join(repo, "zdd", "graph.json"), "file");
  const out = spawnSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /refusing to write through symlink/);
  assert.equal(readFileSync(secret, "utf8"), "TOKEN=hunter2\n");
  rmSync(repo, { recursive: true, force: true });
});

test("stack-neutral bucketing: FastAPI routes group by their own first segment, and the map's feature section lists them", () => {
  const repo = mkRepo(FIXTURE_FASTAPI);
  run(repo, ["derive"]);
  run(repo, ["render"]);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  const tagOf = (id) => graph.nodes.find((n) => n.id === id).tags;
  assert.deepEqual(tagOf("metadata/route/offers"), ["offers"]);
  assert.deepEqual(tagOf("metadata/route/jobs--_id"), ["jobs"]);
  const index = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  assert.match(index, /^## Jobs/m);
  assert.ok(index.includes("metadata/route/jobs--_id.json"), index);
  assert.ok(index.includes("metadata/table/db--jobs.json"), index);
  rmSync(repo, { recursive: true, force: true });
});

test("no git, storeChanges:false: render exits 0 and writes graph.json", () => {
  const repo = mkRepo(FIXTURE_GREENFIELD);
  assert.ok(!existsSync(join(repo, ".git")));
  run(repo, ["derive"]);
  run(repo, ["render"]);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  assert.deepEqual(graph.nodes, []);
  assert.match(run(repo, ["render", "--check"]), /in sync/);
  rmSync(repo, { recursive: true, force: true });
});

test("determinism per viewer: two fresh copies and a re-run are byte-identical across zdd/", () => {
  for (const viewer of ["cytoscape", "minimal"]) {
    const a = mkRepo(FIXTURE);
    const b = mkRepo(FIXTURE);
    for (const r of [a, b]) {
      writeConfig(r, { ...readConfig(r), viewer });
      run(r, ["derive"]);
      run(r, ["render"]);
    }
    const ta = tree(join(a, "zdd"));
    assert.deepEqual(ta, tree(join(b, "zdd")), viewer);
    run(a, ["render"]);
    assert.deepEqual(tree(join(a, "zdd")), ta, `${viewer} (idempotent)`);
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("licence isolation: the Apache-derived files are exactly the ones the notice names, all under src/viewers/cytoscape", () => {
  const dir = join(PKG, "src", "viewers", "cytoscape");
  const notice = readFileSync(join(dir, "LICENSE-NOTICE.md"), "utf8");
  assert.match(notice, /Apache License 2\.0/);
  // The notice names the derived files; they exist there and nowhere else
  // (a future MIT viewer may have HTML and CSS of its own — CR-024).
  for (const f of ["viz.html", "viz.css", "viz.js"]) {
    assert.ok(notice.includes(`\`${f}\``), `notice names ${f}`);
    assert.ok(existsSync(join(dir, f)));
    for (const [rel] of tree(join(PKG, "src"))) {
      if (rel.endsWith("/" + f)) assert.equal(rel, `viewers/cytoscape/${f}`, `${f} only in the cytoscape viewer`);
    }
  }
  // Nothing outside the folder imports from it — the registry loads it by name.
  for (const [rel, text] of tree(join(PKG, "src"))) {
    if (rel.startsWith("viewers/cytoscape/") || !rel.endsWith(".mjs")) continue;
    assert.ok(!/from\s+["'][^"']*cytoscape/.test(text), `${rel} does not import the cytoscape viewer`);
  }
  assert.ok(!existsSync(join(PKG, "src", "viewer")), "old src/viewer folder gone");
  const engineLicence = readFileSync(join(PKG, "..", "..", "LICENSE"), "utf8");
  assert.match(engineLicence, /MIT License/);
});

test("CONTRIBUTING names the graph schema and the registry step", () => {
  const text = readFileSync(join(PKG, "..", "..", "CONTRIBUTING.md"), "utf8");
  assert.ok(text.includes("zdd-graph/1"));
  assert.ok(text.includes("src/viewers/index.mjs"));
  assert.ok(text.includes("zdd/graph.json"));
});

test("CR-007: source-derived markdown cannot execute script in the Cytoscape viewer", () => {
  // Same load order as viz.html: the vendored marked, then the sanitiser, in
  // one browser-like global scope.
  const dir = join(PKG, "src", "viewers", "cytoscape");
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(join(dir, "vendor", "marked.min.js"), "utf8"), ctx);
  vm.runInContext(readFileSync(join(dir, "safe-marked.js"), "utf8"), ctx);
  const html = vm.runInContext(
    `safeMarked.parse(${JSON.stringify(
      'Intro <img src=x onerror=alert(1)> here.\n\n<script>alert(2)</script>\n\n[go](javascript:alert(3)) ![i](data:text/html,x) [ok](https://example.com) [adr](0002-things.md) [tab](java\tscript:alert(4)) ![pixel](https://tracker.example/p) ![rel](//tracker.example/p) ![local](./diagram.png)\n',
    )})`,
    ctx,
  );
  // No image ever renders — an <img> is a network request on panel open,
  // and the page promises none (CR-006). The alt text stands in.
  assert.ok(!/tracker\.example/.test(html), html);
  assert.ok(html.includes("pixel") && html.includes("local"), html);
  assert.ok(!/<img/i.test(html), html);
  assert.ok(!/<script/i.test(html), html);
  assert.ok(!/javascript:/i.test(html), html);
  assert.ok(!/data:/i.test(html), html);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), html);
  assert.ok(html.includes('href="https://example.com"'), html);
  assert.ok(html.includes('href="0002-things.md"'), html);
  // Every marked.parse in the viewer goes through safeMarked.
  const viz = readFileSync(join(dir, "viz.js"), "utf8");
  assert.ok(!/\bmarked\.parse\(/.test(viz), "viz.js calls safeMarked.parse, never marked.parse");
  assert.ok(/safeMarked\.parse\(/.test(viz));
  // Browser parity: the inlined sources must hold no raw control characters —
  // a literal \x00 inside a regex class parsed in Node's vm but threw a
  // SyntaxError in the page, leaving safeMarked undefined (caught by the
  // browser pass on DIO-310).
  for (const f of ["safe-marked.js", "viz.js", "viz.html", "viz.css"]) {
    const text = readFileSync(join(dir, f), "utf8");
    assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text), `${f} has no raw control characters`);
  }
  // The header links only to what every bundle has — no adopter-specific pages.
  const tpl = readFileSync(join(dir, "viz.html"), "utf8");
  assert.ok(!/harness/i.test(tpl), "no PressPlay harness links in the stack-neutral template");
  // No innerHTML assignment interpolates a value: source-derived strings are
  // built as DOM nodes (CR-001). Static legend strings are the only innerHTML.
  for (const m of viz.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)) {
    assert.ok(!m[1].includes("${") && !m[1].includes("+ "), `innerHTML assignment interpolates: ${m[0].slice(0, 80)}`);
  }
  // Source-keyed dictionaries are prototype-free (CR-010).
  assert.ok(!/const (nodeIndex|byType|backlinks|authMode|ADR_BY_NUM) = \{\}/.test(viz));
});
