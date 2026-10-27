// Decision 0019 (2.1.0, item 1, from the second adopter): a variable path
// segment matches a route parameter, never a fixed word; a hole typed as a
// union of string literals expands to one url per literal; a call that
// cannot be placed is recorded on the record and named by lint.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { expandTemplatePath, literalValues, parseLiteralUnion, MAX_EXPANSIONS } from "../src/core/lib/template-paths.mjs";
import { scanApiCalls } from "../src/adapters/react-router/index.mjs";
import { scanFileText } from "../src/adapters/nextjs/refs.mjs";
import { derive as reactRouter } from "../src/adapters/react-router/index.mjs";
import { derive as fastapi } from "../src/adapters/fastapi/index.mjs";
import { resolveRefs } from "../src/core/lib/resolve-refs.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");

test("parseLiteralUnion: double and single quotes, spaces; anything else is null", () => {
  assert.deepEqual(parseLiteralUnion(`"a" | 'b' |"c"`), ["a", "b", "c"]);
  assert.deepEqual(parseLiteralUnion(`"only"`), ["only"]);
  assert.equal(parseLiteralUnion(`string`), null);
  assert.equal(parseLiteralUnion(`"a" | number`), null);
  assert.equal(parseLiteralUnion(``), null);
});

test("literalValues: a parameter annotation, a variable annotation, an optional parameter, a one-hop type alias, a single-literal const; nothing for a string or an unknown name", () => {
  const ctx = `
    type Plural = "publishers" | "authors";
    const kind = "jobs";
    export function useNetwork(plural: Plural, id: string, action?: "activate" | "retire") {
      const verb: "a" | 'b' = "a";
      return api.get(\`/\${plural}/\${id}/\${action}\`);
    }
  `;
  assert.deepEqual(literalValues("plural", ctx), ["publishers", "authors"]);
  assert.deepEqual(literalValues("action", ctx), ["activate", "retire"]);
  assert.deepEqual(literalValues("verb", ctx), ["a", "b"]);
  assert.deepEqual(literalValues("kind", ctx), ["jobs"]);
  assert.equal(literalValues("id", ctx), null);
  assert.equal(literalValues("nope", ctx), null);
  assert.equal(literalValues("a.b", ctx), null, "not an identifier");
  // `splural:` (a longer name) and `o.plural:` are not the name. An object
  // property `{ plural: "z" }` reads exactly like an annotation and IS taken
  // — the known textual limit, erring toward a literal the file really holds.
  assert.equal(literalValues("plural", `let splural: "q" = "q"; o.plural: "r";`), null);
});

test("expandTemplatePath: the product of union holes, `*` for the rest, deduped, capped", () => {
  const ctx = `type P = "a" | "b"; function f(p: P, q: "x" | "y", id: string) {}`;
  assert.deepEqual(expandTemplatePath("/${p}/${id}/${q}", ctx), ["/a/*/x", "/a/*/y", "/b/*/x", "/b/*/y"]);
  assert.deepEqual(expandTemplatePath("/plain", ctx), ["/plain"]);
  assert.deepEqual(expandTemplatePath("/${id}", ctx), ["/*"]);
  const many = Array.from({ length: 6 }, (_, i) => `"v${i}"`).join(" | ");
  const big = `function g(a: ${many}, b: ${many}) {}`;
  assert.equal(6 * 6 > MAX_EXPANSIONS, true);
  assert.deepEqual(expandTemplatePath("/${a}/${b}", big), ["/*/*"], "past the cap the call stays wildcards");
});

test("react-router scanApiCalls: the second adopter's network client — `/${plural}` expands to both resources; a leading ${base} is still dropped; the context may be the whole module", () => {
  const module = `
    type Plural = "publishers" | "authors";
    export function useAdmin(plural: Plural) {
      const { api } = useServices();
      return {
        list: () => api.get(\`/\${plural}\`),
        save: (id: string) => api.put(\`/\${plural}/\${id}\`, {}),
        act: (id: string, action: string) => api.post(\`/\${plural}/\${id}/\${action}\`, {}),
        other: () => fetch(\`\${baseUrl}/\${plural}?x=1\`),
      };
    }
  `;
  assert.deepEqual(
    [...scanApiCalls(module)].sort(),
    ["/authors", "/authors/*", "/authors/*/*", "/publishers", "/publishers/*", "/publishers/*/*"],
  );
  // One statement scanned with the module as context still sees the alias.
  const statement = module.slice(module.indexOf("export function"));
  assert.ok(scanApiCalls(statement, module).has("/authors"));
  assert.deepEqual([...scanApiCalls(statement)].sort(), ["/*", "/*/*", "/*/*/*"], "without the alias in reach the hole is a wildcard");
});

test("nextjs scanFileText: the same expansion for fetch('/api/…') template literals", () => {
  const src = `
    const area: "things" | "widgets" = "things";
    await fetch(\`/api/\${area}/\${id}\`);
  `;
  assert.deepEqual([...scanFileText(src).fetchUrls].sort(), ["/api/things/*", "/api/widgets/*"]);
});

test("end to end (the second adopter's shape): a union-typed segment expands to the right routes only; an untyped one reaches no fixed word, is recorded as unplaced, and lint names it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-varseg-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    "api/main.py": [
      "from fastapi import FastAPI",
      "app = FastAPI()",
      "",
      '@app.get("/health")',
      "async def health():",
      "    return {}",
      "",
      '@app.get("/publishers")',
      "async def publishers():",
      "    return []",
      "",
      '@app.get("/authors")',
      "async def authors():",
      "    return []",
      "",
      '@app.put("/publishers/{id}")',
      "async def put_supplier(id: str):",
      "    return {}",
      "",
      '@app.put("/authors/{id}")',
      "async def put_carrier(id: str):",
      "    return {}",
      "",
      '@app.post("/jobs/{job_id}/cancel")',
      "async def cancel(job_id: str):",
      "    return {}",
      "",
    ].join("\n"),
    "web/src/routes.tsx": 'import { Publishers } from "./Publishers";\nimport { Locations } from "./Locations";\nexport const routes = [{ path: "/admin/publishers", element: <Publishers /> }, { path: "/admin/locations", element: <Locations /> }];\n',
    "web/src/Publishers.tsx": 'import { useNetwork } from "./network";\nexport function Publishers() { return <main>{String(useNetwork("publishers"))}</main>; }\n',
    "web/src/Locations.tsx": 'export function Locations() { const kind = window.name; return <main onClick={() => api.get(`/${kind}`)} />; }\n',
    "web/src/network.ts": 'type Plural = "publishers" | "authors";\nexport function useNetwork(plural: Plural) {\n  return { list: () => api.get(`/${plural}`), save: (id: string) => api.put(`/${plural}/${id}`, {}) };\n}\n',
    "zdd/config.json": JSON.stringify({ name: "VarSeg", extractors: ["fastapi", "react-router"], render: { storeChanges: false }, extractorOptions: { fastapi: { roots: ["api"] }, "react-router": { routesFile: "web/src/routes.tsx" } } }),
    "zdd/map/features/network.md": "---\ntype: Feature\ntitle: Network\ndescription: Publishers and authors.\ntags: [network]\n---\n\n- [Publishers](../../metadata/surface/admin--publishers.json)\n",
  };
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  const api = fastapi({ repoRoot: root, options: { roots: ["api"] } });
  const web = reactRouter({ repoRoot: root, options: { routesFile: "web/src/routes.tsx" } });
  const { records } = resolveRefs([...api.records, ...web.records]);
  const by = (id) => records.find((r) => r.id === id);
  assert.deepEqual(by("surface:/admin/publishers").refs, ["route:/authors", "route:/authors/{id}", "route:/publishers", "route:/publishers/{id}"], "never /health, never /jobs/{job_id}/cancel");
  assert.deepEqual(by("surface:/admin/locations").refs, []);
  assert.deepEqual(by("surface:/admin/locations").facts.unplaced, ["/*"]);

  const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: "utf8" });
  const d = run(["derive", "--verbose"]);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stderr, /fetch\('\/\*'\) matches no route — a variable segment matches only a route parameter/);
  const locations = JSON.parse(readFileSync(join(root, "zdd", "metadata", "surface", "admin--locations.json"), "utf8"));
  assert.deepEqual(locations.facts.unplaced, ["/*"]);
  const l = run(["lint"]);
  assert.equal(l.status, 0, l.stderr);
  assert.match(l.stderr, /WARNING: 1 API call could not be placed on a route — a variable segment \(`\*`\) matches only a route parameter/);
  assert.match(l.stderr, /surface:\/admin\/locations {2}\/\* {2}\(zdd\/metadata\/surface\/admin--locations\.json\)/);
  assert.equal(run(["derive", "--check"]).status, 0);
});
