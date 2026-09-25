// react-router extractor (CAS-63): surfaces from a code-declared route tree,
// guards from pathless ancestors, API refs from a screen and its one-hop
// data module resolved against the fastapi extractor's routes; the
// unclaimed-records lint and the count in both viewers' headers.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { derive, parseRouteTree, joinRoutePath, scanApiCalls, normalizeApiPath, importMap } from "../src/extractors/react-router/index.mjs";
import { derive as fastapi } from "../src/extractors/fastapi/index.mjs";
import { resolveRefs } from "../src/lib/resolve-refs.mjs";
import { unclaimedRecords, unclaimedInGraph } from "../src/lib/claims.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture-react-router");

const scratch = (files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-rr-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};
const mkRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-rr-fix-"));
  cpSync(FIXTURE, repo, { recursive: true });
  return repo;
};
const run = (repo, args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
const ok = (repo, args) => {
  const r = run(repo, args);
  assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}${r.stdout}`);
  return r.stdout + r.stderr;
};

test("fixture: one surface per route with a path; index routes take the parent path; pathless elements become guards; the comment above a route is its description", () => {
  const { records, diagnostics } = derive({ repoRoot: FIXTURE, options: { routesFile: "apps/web/src/routes.tsx" } });
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    records.map((r) => r.id),
    ["surface:/", "surface:/*", "surface:/activity", "surface:/admin/audit", "surface:/admin/tenants/:tenantId", "surface:/admin/users", "surface:/sign-in"],
  );
  const by = (id) => records.find((r) => r.id === id);
  assert.deepEqual(by("surface:/sign-in").facts, { element: "SignInPage", guards: [], dynamicSegments: [] });
  assert.deepEqual(by("surface:/").facts.guards, ["Shell"]);
  assert.deepEqual(by("surface:/admin/users").facts.guards, ["Shell", "AdminOnly"]);
  assert.deepEqual(by("surface:/admin/tenants/:tenantId").facts.dynamicSegments, ["tenantId"]);
  assert.equal(by("surface:/activity").description, "Everyone signed in: the audit trail as a live feed.");
  assert.equal(by("surface:/sign-in").description, "", "the file-level comment above the array is not a route's description");
  // resource[0] is the element's file; the routes file rides along as routing truth.
  assert.deepEqual(by("surface:/admin/users").resource, ["apps/web/src/pages/admin/UsersPage.tsx", "apps/web/src/routes.tsx"]);
  // A framework element (<Navigate>) has no local file: the routes file is the resource.
  assert.deepEqual(by("surface:/admin/audit").resource, ["apps/web/src/routes.tsx"]);
  assert.equal(by("surface:/admin/audit").facts.element, "Navigate");
  // Filenames spell `:id` / `*` the shared slug way.
  assert.equal(by("surface:/admin/tenants/:tenantId").filename, "admin--tenants--_tenantId.json");
  assert.equal(by("surface:/*").filename, "___splat.json");
});

test("refs: a screen's own API calls and its one-hop data module's resolve to the fastapi routes; the module's calls are attributed whole", () => {
  const web = derive({ repoRoot: FIXTURE, options: { routesFile: "apps/web/src/routes.tsx" } });
  // Unresolved before the merge: the extractor cannot see fastapi's records.
  assert.deepEqual(web.records.find((r) => r.id === "surface:/activity").refs, ["?route:/activity"]);
  const api = fastapi({ repoRoot: FIXTURE, options: { roots: ["apps/api"] } });
  const { records } = resolveRefs([...api.records, ...web.records]);
  const by = (id) => records.find((r) => r.id === id);
  assert.deepEqual(by("surface:/activity").refs, ["route:/activity"]);
  // admin/api.ts holds users, invite AND tenants: every screen importing it gets all three (one hop, whole file — by design).
  assert.deepEqual(by("surface:/admin/users").refs, ["route:/tenants", "route:/users", "route:/users/invite"]);
  assert.deepEqual(by("surface:/admin/tenants/:tenantId").refs, ["route:/tenants", "route:/users", "route:/users/invite"]);
  // The shell's `/me` call belongs to the shell, which is a guard, not a surface — no record carries it.
  assert.ok(!records.some((r) => r.refs.includes("route:/me")));
});

test("route tree parsing: createBrowserRouter form, absolute child paths, nested pathless layouts, duplicate paths, non-literal paths", () => {
  const text = `
import { createBrowserRouter } from "react-router-dom";
import Root from "./Root";
import { Auth } from "./Auth";
export const router = createBrowserRouter([
  { path: "/", element: <Root />, children: [
    { index: true, Component: Home },
    { path: "things", children: [
      { index: true, element: <Things /> },
      // One thing.
      { path: ":id", element: <Thing /> },
      { path: "/absolute/child", element: <Abs /> },
    ] },
    { element: <Auth />, children: [ { path: "account", element: <Account /> } ] },
    { path: computed(), element: <X /> },
    { path: "things", element: <Dup /> },
  ] },
]);`;
  const diagnostics = [];
  const flat = parseRouteTree(text, diagnostics);
  assert.deepEqual(
    flat.map((r) => [r.path, r.element, r.guards.join(">"), r.comment]),
    [
      ["/", "Home", "Root", ""],
      ["/things", "Things", "Root", ""],
      ["/things/:id", "Thing", "Root", "One thing."],
      ["/absolute/child", "Abs", "Root", ""],
      ["/account", "Account", "Root>Auth", ""],
      ["/things", "Dup", "Root", ""],
    ],
  );
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /not a string literal/);
  // A route with a path AND children is a layout: a guard, its index child the surface at that path.
  assert.equal(joinRoutePath("/things", ":id"), "/things/:id");
  assert.equal(joinRoutePath("/", "sign-in"), "/sign-in");
  assert.equal(joinRoutePath("/a/", "/b"), "/b");
  assert.equal(joinRoutePath("/a", ""), "/a");
});

test("route tree parsing: the JSX <Route> form, nested and self-closing", () => {
  const text = `
export const routes = createRoutesFromElements(
  <Route element={<Shell />}>
    <Route index element={<Home />} />
    {/* Admin only. */}
    <Route element={<AdminOnly />}>
      <Route path="admin/users" element={<Users />} />
    </Route>
    <Route path="*" element={<NotFound />} />
  </Route>,
);`;
  const flat = parseRouteTree(text.replace("export const routes = createRoutesFromElements(", "const r = build("), []);
  assert.deepEqual(
    flat.map((r) => [r.path, r.element, r.guards.join(">")]),
    [
      ["/", "Home", "Shell"],
      ["/admin/users", "Users", "Shell>AdminOnly"],
      ["/*", "NotFound", "Shell"],
    ],
  );
});

test("API call scan: get/post/put/patch/delete on any receiver and fetch; a leading \${base} is dropped, query strings and \${expr} segments normalised; non-path strings ignored", () => {
  const text = `
    api.get("/users");
    client.post('/users/invite', body);
    fetch(\`\${baseUrl}/tenants?limit=\${PAGE}\`);
    http.delete(\`/things/\${id}\`);
    api.post<User>("/users/invite", invitation); // TypeScript generic between method and call
    api.get<{ users: User[] }>("/users");
    api.get(path); // not a literal
    api.get("users"); // no leading slash: not a path
    map.get("/"); // the root alone is noise
  `;
  assert.deepEqual([...scanApiCalls(text)].sort(), ["/things/*", "/users", "/users/invite", "/tenants"].sort());
  assert.equal(normalizeApiPath("${b}/a/${x}/?q=1"), "/a/*");
  assert.deepEqual([...importMap(`import A, { b as c, type D } from "./x"; import { e } from '@/y';`).entries()], [["A", "./x"], ["c", "./x"], ["D", "./x"], ["e", "@/y"]]);
});

test("missing routes file is nothing to inventory; a path option outside the repo is refused; the `@/` alias resolves through srcAliasRoot", () => {
  const empty = scratch({ "package.json": "{}" });
  const out = derive({ repoRoot: empty, options: {} });
  assert.deepEqual(out.records, []);
  assert.match(out.diagnostics[0], /src\/routes\.tsx not found — nothing to inventory/);
  assert.throws(() => derive({ repoRoot: empty, options: { routesFile: "../x.tsx" } }), /repo-relative/);
  rmSync(empty, { recursive: true, force: true });

  const aliased = scratch({
    "web/src/app/routes.tsx": `import { Home } from "@/screens/Home";\nexport const routes: RouteObject[] = [{ path: "/", element: <Home /> }];\n`,
    "web/src/screens/Home.tsx": `export function Home() { return fetch("/v1/home"); }\n`,
  });
  const a = derive({ repoRoot: aliased, options: { routesFile: "web/src/app/routes.tsx", srcAliasRoot: "web/src" } });
  assert.deepEqual(a.records[0].resource, ["web/src/screens/Home.tsx", "web/src/app/routes.tsx"]);
  assert.deepEqual(a.records[0].refs, ["?route:/v1/home"]);
  rmSync(aliased, { recursive: true, force: true });
});

test("CLI: derive + render + lint on the fixture; the unclaimed lint WARNS (exit 0) and lists each unclaimed record; the count agrees between lint, graph and both viewers", () => {
  const repo = mkRepo();
  ok(repo, ["derive"]);
  ok(repo, ["render"]);
  const lint = run(repo, ["lint"]);
  assert.equal(lint.status, 0, lint.stderr);
  // 12 records: 5 routes + 7 surfaces; the feature claims /admin/users, GET /users, POST /users/invite.
  assert.match(lint.stderr, /WARNING: 9 of 12 records unclaimed/);
  assert.match(lint.stderr, /surface {2}\/activity {2}\(zdd\/metadata\/surface\/activity\.json\)/);
  assert.match(lint.stderr, /route {4}\/tenants {2}\(zdd\/metadata\/route\/tenants\.json\)/);
  assert.ok(!/\/admin\/users /.test(lint.stderr), "a claimed surface is not listed");
  assert.match(lint.stdout, /store lints passed \(3\/12 records claimed by a feature\)/);

  const paths = { metadataDir: join(repo, "zdd", "metadata"), mapDir: join(repo, "zdd", "map"), bundleDir: join(repo, "zdd") };
  const fromStores = unclaimedRecords(paths);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  const fromGraph = unclaimedInGraph(graph);
  assert.deepEqual({ total: fromStores.total, unclaimed: fromStores.unclaimed.length }, fromGraph);
  assert.equal(fromGraph.unclaimed, 9);

  const html = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  assert.ok(html.includes('id="unclaimed"'), "cytoscape header carries the unclaimed span");
  // The header's inline script (no viz.js, no DOM) agrees with the engine's rule.
  const inline = /<script>\nwindow\.BUNDLE_NAME = ([\s\S]*?)<\/script>/.exec(html)[1];
  const el = { textContent: "", hidden: true };
  vm.runInNewContext(`var window = {}; ${inline}`, { document: { getElementById: () => el } });
  assert.equal(el.textContent, "· 9 of 12 unclaimed");
  assert.equal(el.hidden, false);
  // Minimal viewer states the count in its header line.
  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ ...config, viewer: "minimal" }));
  ok(repo, ["render"]);
  assert.match(readFileSync(join(repo, "zdd", "human-index.html"), "utf8"), /9 of 12 records unclaimed by any feature/);
  rmSync(repo, { recursive: true, force: true });
});

test("lint: claiming every record silences the warning; an unrelated map concept type (Application) claims nothing; absent metadata prints no line", () => {
  const repo = mkRepo();
  ok(repo, ["derive"]);
  const links = unclaimedRecords({ metadataDir: join(repo, "zdd", "metadata"), mapDir: join(repo, "zdd", "map"), bundleDir: join(repo, "zdd") }).unclaimed.map((r) => `- [${r.title}](/${r.nodeId}.json)`);
  // An Application linking them does not claim them.
  writeFileSync(join(repo, "zdd", "map", "apps", "web.md"), `---\ntype: Application\ntitle: Web\ndescription: x\nresource: apps/web\ntags: []\n---\n\n${links.join("\n")}\n`);
  assert.match(run(repo, ["lint"]).stderr, /WARNING: 9 of 12 records unclaimed/);
  writeFileSync(join(repo, "zdd", "map", "features", "everything.md"), `---\ntype: Feature\ntitle: Everything\ndescription: x\nresource: apps\ntags: [all]\n---\n\n${links.join("\n")}\n`);
  const r = run(repo, ["lint"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/unclaimed/.test(r.stderr), r.stderr);
  assert.match(r.stdout, /12\/12 records claimed/);
  rmSync(join(repo, "zdd", "metadata"), { recursive: true, force: true });
  const bare = run(repo, ["lint"]);
  assert.ok(!/unclaimed/.test(bare.stderr), bare.stderr);
  assert.match(bare.stdout, /^store lints passed\n$/);
  rmSync(repo, { recursive: true, force: true });
});
