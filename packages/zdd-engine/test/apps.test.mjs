// One map across apps (CAS-97 item 4, decision 0018): a code record belongs
// to the Application page whose resource path contains it — a `belongsTo`
// edge and an `app` field on the graph node; a shared package belongs to no
// app; an Application page without a resource, or two whose paths nest, is
// a warning and assigns nothing. The viewer's bundle lists the apps for its
// filter and takes the component fan-in option. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture-components");

const mkRepo = (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-apps-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE, repo, { recursive: true });
  return repo;
};
const run = (repo, args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
const graphOf = (repo) => JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
const bundleOf = (repo) => JSON.parse(/window\.BUNDLE = (.*);\n/.exec(readFileSync(join(repo, "zdd", "human-index.html"), "utf8"))[1]);

test("a web page, a web component and a native screen each belong to their app; the shared button and the API (no Application page) belong to none; belongsTo edges are drawn and said", (t) => {
  const repo = mkRepo(t);
  assert.equal(run(repo, ["derive"]).status, 0);
  const r = run(repo, ["render"]);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /WARNING: .*Application/);
  const g = graphOf(repo);
  const node = (title) => g.nodes.find((n) => n.title === title);
  assert.equal(node("RouteSearchPanel").app, "map/apps/web");
  assert.equal(g.nodes.find((n) => n.id === "metadata/surface/jobs").app, "map/apps/web");
  assert.equal(node("/jobs (native)").app, "map/apps/mobile");
  assert.equal(node("Button").app, undefined, "packages/ui is under no Application page");
  assert.equal(node("/jobs/{job_id}/route").app, undefined, "apps/api has no Application page in this fixture");
  assert.equal(node("Jobs").app, undefined, "map concepts carry no app");
  const belongs = g.edges.filter((e) => e.verb === "belongsTo");
  assert.ok(belongs.some((e) => e.source === node("/jobs (native)").id && e.target === "map/apps/mobile"));
  assert.ok(belongs.some((e) => e.source === node("Badge").id && e.target === "map/apps/web"));
  assert.doesNotMatch(node("Badge").body, /belongs to/, "membership is minted at render, never written into a record body");
  // The bundle: apps listed for the filter, nodes carry app and layer, the page holds the filter.
  const b = bundleOf(repo);
  assert.deepEqual(b.apps, [{ id: "map/apps/mobile", title: "Mobile" }, { id: "map/apps/web", title: "Web" }]);
  assert.equal(b.nodes.find((n) => n.data.label === "Badge").data.app, "map/apps/web");
  assert.equal(b.nodes.find((n) => n.data.label === "Badge").data.layer, "metadata");
  assert.match(readFileSync(join(repo, "zdd", "human-index.html"), "utf8"), /id="filter-app"/);
  assert.equal(run(repo, ["render", "--check"]).status, 0, "byte-stable");
});

test("an Application page without a resource, and two whose paths nest, are warnings that assign nothing — never a guess", (t) => {
  const repo = mkRepo(t);
  writeFileSync(join(repo, "zdd", "map", "apps", "admin.md"), "---\ntype: Application\ntitle: Admin\ndescription: Nested under the web app.\nresource: apps/web/src/pages/admin\ntags: [admin]\n---\n\nThe admin area.\n");
  writeFileSync(join(repo, "zdd", "map", "apps", "mobile.md"), "---\ntype: Application\ntitle: Mobile\ndescription: No path.\ntags: [jobs]\n---\n\nNo resource here.\n");
  assert.equal(run(repo, ["derive"]).status, 0);
  const r = run(repo, ["render"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING: map\/apps\/mobile: Application page has no resource path/);
  assert.match(r.stderr, /WARNING: map\/apps\/admin: Application pages' resource paths nest or coincide/);
  assert.match(r.stderr, /WARNING: map\/apps\/web: Application pages' resource paths nest or coincide/);
  const g = graphOf(repo);
  for (const title of ["RouteSearchPanel", "/jobs", "/jobs (native)"]) assert.equal(g.nodes.find((n) => n.title === title).app, undefined, title);
  assert.equal(g.edges.filter((e) => e.verb === "belongsTo").length, 0);
});

test("the viewer's componentFanIn option reaches the bundle; the lanes code keys components to their own band", (t) => {
  const repo = mkRepo(t);
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  cfg.viewer = { name: "cytoscape", componentFanIn: 2 };
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(cfg));
  assert.equal(run(repo, ["derive"]).status, 0);
  assert.equal(run(repo, ["render"]).status, 0);
  assert.equal(bundleOf(repo).viewer.componentFanIn, 2);
  const html = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  assert.match(html, /"UI Component": 1, "Feature": 2/);
  assert.match(html, /edge\[verb = 'subscribes'\]/);
});
