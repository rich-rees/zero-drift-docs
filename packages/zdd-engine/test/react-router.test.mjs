// react-router extractor (CAS-63): surfaces from a code-declared route tree,
// guards from layout ancestors, API refs from a screen and its one-hop data
// module resolved against the fastapi extractor's routes; the
// unclaimed-records lint and the count in both viewers' headers. The
// review-campaign cases (CR-001..CR-024) are the lexical-mask and
// trust-boundary tests in the second half.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, symlinkSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { derive, parseRouteTree, joinRoutePath, scanApiCalls, normalizeApiPath, importMap, lex, MAX_SOURCE_BYTES } from "../src/extractors/react-router/index.mjs";
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
const flat = (text, diagnostics = []) => parseRouteTree(text, diagnostics).map((r) => [r.path, r.element, r.guards.join(">"), r.comment]);
const ROUTES = "apps/web/src/routes.tsx";

test("fixture: one surface per leaf route; index routes take the parent path; layout elements become guards; the comment above a route is its description", () => {
  const { records, diagnostics } = derive({ repoRoot: FIXTURE, options: { routesFile: ROUTES } });
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
  assert.deepEqual(by("surface:/admin/users").resource, ["apps/web/src/pages/admin/UsersPage.tsx", ROUTES]);
  assert.deepEqual(by("surface:/admin/audit").resource, [ROUTES], "a framework element (<Navigate>) has no local file");
  assert.equal(by("surface:/admin/audit").facts.element, "Navigate");
  assert.equal(by("surface:/admin/tenants/:tenantId").filename, "admin--tenants--_tenantId.json");
  assert.equal(by("surface:/*").filename, "___splat.json");
});

test("refs: a screen's own API calls and its one-hop data module's resolve to the fastapi routes; the module's calls are attributed whole; a guard's calls belong to no surface", () => {
  const web = derive({ repoRoot: FIXTURE, options: { routesFile: ROUTES } });
  assert.deepEqual(web.records.find((r) => r.id === "surface:/activity").refs, ["?route:/activity"], "unresolved before the merge");
  const api = fastapi({ repoRoot: FIXTURE, options: { roots: ["apps/api"] } });
  const { records } = resolveRefs([...api.records, ...web.records]);
  const by = (id) => records.find((r) => r.id === id);
  assert.deepEqual(by("surface:/activity").refs, ["route:/activity"]);
  assert.deepEqual(by("surface:/admin/users").refs, ["route:/tenants", "route:/users", "route:/users/invite"]);
  assert.deepEqual(by("surface:/admin/tenants/:tenantId").refs, ["route:/tenants", "route:/users", "route:/users/invite"]);
  assert.ok(!records.some((r) => r.refs.includes("route:/me")));
});

test("array form: createBrowserRouter literal, absolute child paths, a path-bearing layout, nested pathless layouts, duplicate paths, non-literal paths", () => {
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
  assert.deepEqual(flat(text, diagnostics), [
    ["/", "Home", "Root", ""],
    ["/things", "Things", "Root", ""],
    ["/things/:id", "Thing", "Root", "One thing."],
    ["/absolute/child", "Abs", "Root", ""],
    ["/account", "Account", "Root>Auth", ""],
    ["/things", "Dup", "Root", ""],
  ]);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /not a string literal/);
  assert.equal(joinRoutePath("/things", ":id"), "/things/:id");
  assert.equal(joinRoutePath("/", "sign-in"), "/sign-in");
  assert.equal(joinRoutePath("/a/", "/b"), "/b");
  assert.equal(joinRoutePath("/a", ""), "/a");
});

test("JSX form: nested layouts, self-closing leaves, and a PAIRED leaf <Route></Route> is a surface, not a layout (CR-011)", () => {
  const text = `
const r = build(
  <Route element={<Shell />}>
    <Route index element={<Home />} />
    {/* Admin only. */}
    <Route element={<AdminOnly />}>
      <Route path="admin/users" element={<Users />} />
    </Route>
    <Route path="open" element={<Open />}></Route>
    <Route path="*" element={<NotFound />} />
  </Route>,
);`;
  assert.deepEqual(flat(text).map((r) => r.slice(0, 3)), [
    ["/", "Home", "Shell"],
    ["/admin/users", "Users", "Shell>AdminOnly"],
    ["/open", "Open", "Shell"],
    ["/*", "NotFound", "Shell"],
  ]);
});

test("CR-006: routes, <Route> tags and API calls inside comments, strings and template literals are not code; a regex literal holding a brace does not truncate the object", () => {
  const arr = `
// const ghost = createBrowserRouter([{ path: "/ghost", element: <Ghost /> }]);
/* { path: "/block", element: <Block /> } */
const doc = "createBrowserRouter([{ path: '/in-string' }])";
export const routes: RouteObject[] = [
  { path: "/real", loader: () => /[}]{2}/.test(x), element: <Real /> },
  { path: "/tpl", element: <Tpl />, handle: \`{ "path": "/in-template" }\` },
];`;
  const d = [];
  assert.deepEqual(flat(arr, d).map((r) => r.slice(0, 2)), [["/real", "Real"], ["/tpl", "Tpl"]]);
  assert.deepEqual(d, []);
  const jsx = `
// <Route path="/old" element={<Old />} />
const s = '<Route path="/str" />';
export default (
  <Routes>
    {/* <Route path="/jsx-comment" element={<C />} /> */}
    <Route path="/real" element={<Real />} />
  </Routes>
);`;
  assert.deepEqual(flat(jsx).map((r) => [r[0], r[1], r[3]]), [["/real", "Real", ""]], "no phantom routes, and the commented route is not the real one's description");
  const calls = `
    // api.get("/ghost")
    /* fetch("/block") */
    const example = "fetch('/also-ghost')";
    const tpl = \`api.post("/tpl-ghost")\`;
    api.get("/real");
    const re = /\\/regex/; api.get("/after-regex");
  `;
  assert.deepEqual([...scanApiCalls(calls)].sort(), ["/after-regex", "/real"]);
  const { code, mask } = lex(`a("x") // c\nx = /re/g.test("y")`);
  assert.equal(code, `a("x")     \nx =      .test("y")`);
  assert.equal(mask, `a(" ")     \nx =      .test(" ")`, "delimiters kept, bodies blanked");
});

test("CR-018: the tree is the array handed to create*Router — a local binding by name; children and spreads naming local array bindings are followed; anything else is a diagnostic", () => {
  const text = `
const adminRoutes: RouteObject[] = [{ path: "users", element: <Users /> }];
const extra = [{ path: "/extra", element: <Extra /> }];
const appRoutes = [
  { path: "admin", element: <Admin />, children: adminRoutes },
  ...extra,
  ...fromElsewhere,
  { path: "/x", children: notLocal },
];
export const router = createBrowserRouter(appRoutes);`;
  const d = [];
  assert.deepEqual(flat(text, d).map((r) => r.slice(0, 3)), [
    ["/admin/users", "Users", "Admin"],
    ["/extra", "Extra", ""],
  ]);
  assert.equal(d.length, 2, d.join("\n"));
  assert.match(d[0], /spreads 'fromElsewhere'/);
  assert.match(d[1], /route \/x: children is not a local array literal/);
  // The typed `adminRoutes` binding is NOT the root just because it comes first.
  const d2 = [];
  assert.deepEqual(flat(`const r = createBrowserRouter(nope);`, d2), []);
  assert.match(d2[0], /'nope', which is not a local array literal/);
});

test("CR-017: lazy routes and lazy component declarations resolve to their module; CR-020: nested generics; CR-019: import type binds nothing", () => {
  const root = scratch({
    "src/routes.tsx": `
import { lazy } from "react";
import type { Foo } from "./types";
const Reports = lazy(() => import("./pages/Reports"));
export const routes: RouteObject[] = [
  { path: "/reports", element: <Reports /> },
  { path: "/users", lazy: () => import("./pages/UsersRoute") },
];`,
    "src/types.ts": `export type Foo = {}; api.get("/type-only-ghost");\n`,
    "src/pages/Reports.tsx": `import type { User } from "../admin/api";\nexport default function R() { return api.get<ApiResponse<User>>("/reports"); }\n`,
    "src/pages/UsersRoute.tsx": `export function Component() { return api.get<{ users: Array<User> }>("/users"); }\n`,
    "src/admin/api.ts": `export type User = {}; export const x = () => api.get("/ghost-via-type-import");\n`,
  });
  const { records, diagnostics } = derive({ repoRoot: root, options: {} });
  assert.deepEqual(diagnostics, []);
  const by = (id) => records.find((r) => r.id === id);
  assert.deepEqual(by("surface:/reports").resource, ["src/pages/Reports.tsx", "src/routes.tsx"]);
  assert.deepEqual(by("surface:/reports").refs, ["?route:/reports"], "type-only import of admin/api does not pull its calls in");
  assert.deepEqual(by("surface:/users").resource, ["src/pages/UsersRoute.tsx", "src/routes.tsx"]);
  assert.deepEqual(by("surface:/users").refs, ["?route:/users"]);
  assert.equal(by("surface:/users").facts.element, "lazy(./pages/UsersRoute)");
  assert.deepEqual([...importMap(`import A, { b as c, type D } from "./x"; import type { E } from "./t"; import { e } from '@/y';`).entries()], [["A", "./x"], ["c", "./x"], ["e", "@/y"]]);
  rmSync(root, { recursive: true, force: true });
});

test("CR-012: optional segments — static and dynamic — get a filename derive accepts, distinct from the non-optional spelling", () => {
  const root = scratch({
    "src/routes.tsx": `export const routes = [
      { path: "/project/task", element: <A /> },
      { path: "/project/task?", element: <B /> },
      { path: "/user/:id", element: <C /> },
      { path: "/user/:id?", element: <D /> },
    ];`,
  });
  const { records } = derive({ repoRoot: root, options: {} });
  assert.deepEqual(records.map((r) => [r.id, r.filename]), [
    ["surface:/project/task", "project--task.json"],
    ["surface:/project/task?", "project--task~.json"],
    ["surface:/user/:id", "user--_id.json"],
    ["surface:/user/:id?", "user--_id~.json"],
  ]);
  assert.deepEqual(records[3].facts.dynamicSegments, ["id"]);
  for (const r of records) assert.match(r.filename, /^[A-Za-z0-9._~()\[\]-]+\.json$/, "derive's filename rule");
  rmSync(root, { recursive: true, force: true });
});

test("API call scan: any receiver, fetch, a leading ${base} dropped, query strings and ${expr} normalised, non-path strings ignored, generics skipped", () => {
  const text = `
    api.get("/users");
    client.post('/users/invite', body);
    fetch(\`\${baseUrl}/tenants?limit=\${PAGE}\`);
    http.delete(\`/things/\${id}\`);
    api.post<User>("/generic", x);
    api.get(path); // not a literal
    api.get("users"); // no leading slash: not a path
    map.get("/"); // the root alone is noise
  `;
  assert.deepEqual([...scanApiCalls(text)].sort(), ["/generic", "/tenants", "/things/*", "/users", "/users/invite"]);
  assert.equal(normalizeApiPath("${b}/a/${x}/?q=1"), "/a/*");
});

test("CR-001: a symlinked routes file, element file or one-hop module is never read (POSIX); an oversized source is not read; both are diagnostics, not records", (t) => {
  const root = scratch({
    "src/routes.tsx": `import { A } from "./A";\nimport { B } from "./B";\nexport const routes = [{ path: "/a", element: <A /> }, { path: "/b", element: <B /> }];\n`,
    "src/A.tsx": `import { x } from "./data";\nexport const A = () => api.get("/a");\n`,
    "src/B.tsx": `export const B = () => api.get("/b");\n`,
    "outside.ts": `export const x = api.get("/outside");\n`,
  });
  writeFileSync(join(root, "src", "big.tsx"), "x".repeat(MAX_SOURCE_BYTES + 1));
  if (process.platform !== "win32") {
    symlinkSync(join(root, "outside.ts"), join(root, "src", "data.ts"));
    const { records, diagnostics } = derive({ repoRoot: root, options: {} });
    assert.deepEqual(records.find((r) => r.id === "surface:/a").refs, ["?route:/a"], "the linked data module contributes nothing");
    assert.ok(diagnostics.some((d) => /src\/data\.ts is not a regular file inside the repo/.test(d)), diagnostics.join("\n"));
    // A linked routes file is "not found".
    rmSync(join(root, "src", "routes.tsx"));
    symlinkSync(join(root, "outside.ts"), join(root, "src", "routes.tsx"));
    const linked = derive({ repoRoot: root, options: {} });
    assert.deepEqual(linked.records, []);
    assert.match(linked.diagnostics[0], /not found — nothing to inventory/);
  } else t.diagnostic("symlink cases skipped on win32");
  const big = derive({ repoRoot: root, options: { routesFile: "src/big.tsx" } });
  assert.deepEqual(big.records, []);
  assert.match(big.diagnostics[0], /is over 1024 KiB — not read/);
  rmSync(root, { recursive: true, force: true });
});

test("CR-004: a route tree nested past the ceiling is a diagnostic, never a stack overflow", () => {
  const depth = 200;
  const text = `export const routes = [${"{ path: 'l', children: [".repeat(depth)}{ path: 'leaf', element: <L /> }${"] }".repeat(depth)}];`;
  const d = [];
  const out = parseRouteTree(text, d);
  assert.equal(out.length, 0);
  assert.match(d[0], /nested deeper than 32/);
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

test("derive: a duplicate path is a diagnostic and the second entry is skipped; a Component import is the primary resource and is scanned", () => {
  const root = scratch({
    "src/routes.tsx": `import { Users } from "./Users";\nexport const routes = [{ path: "/u", Component: Users }, { path: "/u", element: <Dup /> }];\n`,
    "src/Users.tsx": `export const Users = () => api.get("/users");\n`,
  });
  const { records, diagnostics } = derive({ repoRoot: root, options: {} });
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].resource, ["src/Users.tsx", "src/routes.tsx"]);
  assert.deepEqual(records[0].refs, ["?route:/users"]);
  assert.match(diagnostics[0], /route \/u declared twice — second entry skipped/);
  rmSync(root, { recursive: true, force: true });
});

test("CLI: derive + render + lint on the fixture; the unclaimed lint WARNS (exit 0) and lists each unclaimed record; the count agrees between lint, graph and both viewers, including with a map concept whose type looks like a metadata type (CR-010)", () => {
  const repo = mkRepo();
  // A map concept typed `Table` is a map node, not a record: it must not count.
  writeFileSync(join(repo, "zdd", "map", "apps", "ledger.md"), "---\ntype: Table\ntitle: Ledger (a concept, not a record)\ndescription: x\nresource: apps\ntags: []\n---\n");
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
  assert.ok(html.includes('<span id="unclaimed" class="muted"'), "cytoscape header carries the unclaimed span");
  assert.ok(html.includes(">9 of 12 unclaimed</span>"), "the count is rendered by the viewer from the graph's layer + edges");
  const config = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ ...config, viewer: "minimal" }));
  ok(repo, ["render"]);
  assert.match(readFileSync(join(repo, "zdd", "human-index.html"), "utf8"), /9 of 12 records unclaimed by any feature/);
  rmSync(repo, { recursive: true, force: true });
});

test("lint: claiming every record silences the warning; an Application claims nothing; absent metadata prints no line; CR-002/003: a symlinked or oversized store file is skipped, never followed or read whole", (t) => {
  const repo = mkRepo();
  ok(repo, ["derive"]);
  const links = unclaimedRecords({ metadataDir: join(repo, "zdd", "metadata"), mapDir: join(repo, "zdd", "map"), bundleDir: join(repo, "zdd") }).unclaimed.map((r) => `- [${r.title}](/${r.nodeId}.json)`);
  writeFileSync(join(repo, "zdd", "map", "apps", "web.md"), `---\ntype: Application\ntitle: Web\ndescription: x\nresource: apps/web\ntags: []\n---\n\n${links.join("\n")}\n`);
  assert.match(run(repo, ["lint"]).stderr, /WARNING: 9 of 12 records unclaimed/);
  writeFileSync(join(repo, "zdd", "map", "features", "everything.md"), `---\ntype: Feature\ntitle: Everything\ndescription: x\nresource: apps\ntags: [all]\n---\n\n${links.join("\n")}\n`);
  const r = run(repo, ["lint"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/unclaimed/.test(r.stderr), r.stderr);
  assert.match(r.stdout, /12\/12 records claimed/);

  // An oversized metadata record and an oversized feature are skipped by the claims pass.
  const secret = join(repo, "secret.json");
  writeFileSync(secret, JSON.stringify({ kind: "table", id: "table:x/secret", title: "SECRET" }));
  writeFileSync(join(repo, "zdd", "metadata", "route", "huge.json"), `{"kind":"route","id":"route:/huge","title":"HUGE","pad":"${"x".repeat(1024 * 1024)}"}`);
  if (process.platform !== "win32") {
    symlinkSync(secret, join(repo, "zdd", "metadata", "route", "linked.json"));
    mkdirSync(join(repo, "zdd", "metadata", "linkdir"));
    symlinkSync(join(repo, "zdd", "metadata", "route"), join(repo, "zdd", "metadata", "linkdir", "routes"));
  } else t.diagnostic("symlink cases skipped on win32");
  const c = unclaimedRecords({ metadataDir: join(repo, "zdd", "metadata"), mapDir: join(repo, "zdd", "map"), bundleDir: join(repo, "zdd") });
  assert.equal(c.total, 12, "neither the linked record nor the oversized one is inventoried");
  assert.ok(!c.unclaimed.some((x) => /SECRET|HUGE/.test(x.title)));

  rmSync(join(repo, "zdd", "metadata"), { recursive: true, force: true });
  const bare = run(repo, ["lint"]);
  assert.ok(!/unclaimed/.test(bare.stderr), bare.stderr);
  assert.match(bare.stdout, /^store lints passed\n$/);
  rmSync(repo, { recursive: true, force: true });
});
