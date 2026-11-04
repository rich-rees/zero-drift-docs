// nextjs extractor against scratch App Router trees.
// Review CR-095 (1.0.0 campaign). Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeExtractorIo } from "../../zdd-engine/src/core/lib/extractor-io.mjs";
import { derive as nextjs } from "../adapters/nextjs/index.mjs";
import { derive as supabase } from "../adapters/supabase/index.mjs";
import { DEFAULT_REFS } from "../adapters/nextjs/refs.mjs";
import { resolveRefs } from "../../zdd-engine/src/core/lib/resolve-refs.mjs";
import { dataAccessOf } from "./code-reach.mjs";

const scratch = (files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-next-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};

test("CR-095: a JavaScript App Router tree (route.js, page.jsx, layout.js) is inventoried like a TypeScript one", () => {
  const root = scratch({
    "src/app/layout.js": "export default function Layout({ children }) { return children }\n",
    "src/app/page.jsx": "export default function Home() { return null }\n",
    "src/app/things/[id]/page.js": "export default function Thing() { return null }\n",
    "src/app/api/things/route.js": "// Things endpoint.\nexport async function GET() { return supabase.from('things').select() }\n",
    "src/lib/things-api.js": "export const load = () => fetch('/api/things')\n",
    "src/lib/things-api.test.js": "supabase.from('things')\n",
    "migrations/0001.sql": "create table things (id uuid primary key);\n",
  });
  const out = nextjs({ repoRoot: root, io: makeExtractorIo(root, "nextjs"), options: { appDir: "src/app" } });
  const db = supabase({ repoRoot: root, io: makeExtractorIo(root, "supabase"), options: { migrationNamespaces: [{ name: "db", dir: "migrations" }] } });
  const { records } = resolveRefs([...db.records, ...out.records, ...dataAccessOf(root)]); // supabase-js reads the calls (decision 0037)
  const ids = records.map((r) => r.id).sort();
  assert.deepEqual(ids, ["module:src/lib/things-api.js", "route:/api/things", "surface:/", "surface:/_layout", "surface:/things/[id]", "table:db/things"]);
  const route = records.find((r) => r.id === "route:/api/things");
  assert.deepEqual(route.facts.methods, ["GET"]);
  assert.deepEqual(route.refs, ["table:db/things"]);
  assert.equal(route.description, "Things endpoint.");
  assert.deepEqual(route.resource, ["src/app/api/things/route.js"]);
  // The .test.js sibling is excluded by default, exactly like .test.ts.
  assert.ok(!ids.some((id) => id.includes("things-api.test")), ids.join(", "));
  assert.deepEqual(records.find((r) => r.id === "module:src/lib/things-api.js").refs, ["route:/api/things"]);
  rmSync(root, { recursive: true, force: true });
});

test("CR-095: default refs extensions cover JS and TS, and their test suffixes", () => {
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) assert.ok(DEFAULT_REFS.extensions.includes(ext), ext);
  for (const suffix of [".test.ts", ".test.tsx", ".test.js", ".test.jsx", ".d.ts"]) assert.ok(DEFAULT_REFS.excludeSuffixes.includes(suffix), suffix);
});

// A repo's move to 0.14.0: a page that only renders a component from
// src/components got none of the component's calls, so the map's gap check
// said the screen reaches nothing. A screen takes the calls of the local
// modules its page and layout import, one hop, as react-router's screens do.
test("a screen takes the calls of the local modules its page and layout import, one hop", () => {
  const root = scratch({
    "src/app/page.tsx": 'import { BookmarksPage } from "@/components/BookmarksPage";\nexport default function Page() { return <BookmarksPage />; }\n',
    "src/app/layout.tsx": 'import Nav from "../components/Nav";\nexport default function Layout({ children }) { return <><Nav />{children}</>; }\n',
    "src/app/tags/page.tsx": 'import { listTags } from "@/lib/api";\nexport default async function Tags() { await listTags(); return null; }\n',
    "src/app/api/bookmarks/route.ts": "export async function GET() { return Response.json([]) }\n",
    "src/app/api/tags/route.ts": "export async function GET() { return Response.json([]) }\n",
    "src/app/api/users/route.ts": "export async function GET() { return Response.json([]) }\n",
    "src/app/api/me/route.ts": "export async function GET() { return Response.json([]) }\n",
    "src/components/BookmarksPage.tsx": 'import { Row } from "./Row";\nexport function BookmarksPage() { fetch("/api/bookmarks"); return <Row />; }\n',
    // Two hops away: never the home screen's.
    "src/components/Row.tsx": 'export function Row() { fetch("/api/users"); return null; }\n',
    "src/components/Nav.tsx": 'export default function Nav() { fetch("/api/me"); return null; }\n',
    // A named import narrows: the tags screen reaches listTags, not listUsers.
    "src/lib/api.ts": 'export const listTags = () => fetch("/api/tags");\nexport const listUsers = () => fetch("/api/users");\n',
    // Imported by nothing: no screen's.
    "src/components/Orphan.tsx": 'export function Orphan() { fetch("/api/users"); return null; }\n',
  });
  const out = nextjs({ repoRoot: root, io: makeExtractorIo(root, "nextjs"), options: { appDir: "src/app" } });
  const raw = [...out.records.find((r) => r.id === "surface:/").refs]; // before resolution, which rewrites refs in place
  const { records } = resolveRefs(out.records);
  const refsOf = (id) => records.find((r) => r.id === id).refs.filter((r) => r.startsWith("route:"));
  assert.deepEqual(refsOf("surface:/"), ["route:/api/bookmarks"]);
  assert.deepEqual(refsOf("surface:/_layout"), ["route:/api/me"]);
  assert.deepEqual(refsOf("surface:/tags"), ["route:/api/tags"]);
  // The modules keep their own records and refs, as before.
  assert.deepEqual(refsOf("module:src/components/BookmarksPage.tsx"), ["route:/api/bookmarks"]);
  // The screen names the code it runs in the module, by unit (decision 0037).
  assert.ok(raw.includes("?code:src/components/BookmarksPage.tsx#BookmarksPage"), raw.join(", "));
  assert.ok(!raw.some((r) => r.includes("Row.tsx")), raw.join(", "));
  rmSync(root, { recursive: true, force: true });
});

// CR-397: a default or a namespace import takes the module whole, and says
// so. CR-391: a file in the screen's own folder counts for it whole, as it
// always did; a narrowed import of it takes nothing away (one hop only adds).
test("a whole-module import is noted; a file in the screen's folder stays whole", () => {
  const root = scratch({
    "src/app/page.tsx": 'import Nav from "@/components/Nav";\nimport * as api from "@/lib/api";\nimport { wanted } from "./helpers";\nexport default function Page() { api.x(); wanted(); return <Nav />; }\n',
    "src/app/helpers.ts": 'export const wanted = () => fetch("/api/wanted");\nexport const other = () => fetch("/api/other");\n',
    "src/components/Nav.tsx": 'export default function Nav() { fetch("/api/me"); return null; }\n',
    "src/lib/api.ts": 'export const x = () => fetch("/api/x");\nexport const y = () => fetch("/api/y");\n',
    "src/app/api/wanted/route.ts": "export async function GET() {}\n",
    "src/app/api/other/route.ts": "export async function GET() {}\n",
    "src/app/api/me/route.ts": "export async function GET() {}\n",
    "src/app/api/x/route.ts": "export async function GET() {}\n",
    "src/app/api/y/route.ts": "export async function GET() {}\n",
  });
  const out = nextjs({ repoRoot: root, io: makeExtractorIo(root, "nextjs"), options: { appDir: "src/app" } });
  const notes = out.diagnostics.join("\n");
  assert.match(notes, /src\/app\/page\.tsx imports src\/components\/Nav\.tsx by default import — its calls are attributed whole/, notes);
  assert.match(notes, /src\/app\/page\.tsx imports src\/lib\/api\.ts as a namespace — its calls are attributed whole/, notes);
  const { records } = resolveRefs(out.records);
  const refs = records.find((r) => r.id === "surface:/").refs.filter((r) => r.startsWith("route:")).sort();
  assert.deepEqual(refs, ["route:/api/me", "route:/api/other", "route:/api/wanted", "route:/api/x", "route:/api/y"]);
  rmSync(root, { recursive: true, force: true });
});
