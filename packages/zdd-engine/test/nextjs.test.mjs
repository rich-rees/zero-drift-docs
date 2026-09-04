// nextjs extractor against scratch App Router trees.
// Review CR-095 (DIO-312 campaign). Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { derive as nextjs } from "../src/extractors/nextjs/index.mjs";
import { derive as supabase } from "../src/extractors/supabase/index.mjs";
import { DEFAULT_REFS } from "../src/extractors/nextjs/refs.mjs";
import { resolveRefs } from "../src/lib/resolve-refs.mjs";

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
  const out = nextjs({ repoRoot: root, options: { appDir: "src/app" } });
  const db = supabase({ repoRoot: root, options: { migrationNamespaces: [{ name: "db", dir: "migrations" }] } });
  const { records } = resolveRefs([...db.records, ...out.records]);
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
