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
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, existsSync, readdirSync, statSync } from "node:fs";
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
const readBundle = (repo) => {
  const html = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  const m = /window\.BUNDLE = (.*);\n/.exec(html);
  assert.ok(m, "human-index.html embeds window.BUNDLE");
  return JSON.parse(m[1]);
};
const tree = (dir, base = dir, out = new Map()) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tree(p, base, out);
    else out.set(relative(base, p).split(/[\\/]/).join("/"), readFileSync(p, "utf8"));
  }
  return out;
};

test("default viewer: BUNDLE and agent index equal the v0.3.1 goldens on the Next.js fixture", () => {
  const repo = mkRepo(FIXTURE);
  run(repo, ["derive"]);
  run(repo, ["render"]);
  assert.deepEqual(readBundle(repo), JSON.parse(readFileSync(join(GOLDEN, "human-index-bundle-v0.3.1-nextjs-supabase.json"), "utf8")));
  assert.equal(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), readFileSync(join(GOLDEN, "agent-index-v0.3.1-nextjs-supabase.md"), "utf8"));
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
  assert.match(stderr, /Unknown viewer 'nope'/);
  assert.match(stderr, /cytoscape/);
  assert.match(stderr, /minimal/);
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

test("licence isolation: Apache-derived files live only under src/viewers/cytoscape with its notice", () => {
  const notice = join(PKG, "src", "viewers", "cytoscape", "LICENSE-NOTICE.md");
  assert.ok(existsSync(notice));
  assert.match(readFileSync(notice, "utf8"), /Apache License 2\.0/);
  for (const [rel] of tree(join(PKG, "src"))) {
    if (rel.startsWith("viewers/cytoscape/")) continue;
    assert.ok(!/\.(css|html)$/.test(rel) && !rel.includes("vendor/"), `${rel} outside the cytoscape viewer`);
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
      'Intro <img src=x onerror=alert(1)> here.\n\n<script>alert(2)</script>\n\n[go](javascript:alert(3)) ![i](data:text/html,x) [ok](https://example.com) [adr](0002-things.md) [tab](java\tscript:alert(4))\n',
    )})`,
    ctx,
  );
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
});
