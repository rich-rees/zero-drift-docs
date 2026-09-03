// Pure-function tests for the route/surface walkers and refs scanner.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, extractMethods, leadingComment } from "../src/extractors/nextjs/index.mjs";
import { scanFileText, normalizeFetchUrl } from "../src/extractors/nextjs/refs.mjs";
import { makeRouteMatcher } from "../src/lib/resolve-refs.mjs";

test("slugify: dynamic + catch-all + groups + dots", () => {
  assert.equal(slugify("journeys/[id]/runs/[runId]"), "journeys--_id--runs--_runId");
  assert.equal(slugify("assets/video/[id]/hls/[...path]"), "assets--video--_id--hls--___path");
  assert.equal(slugify("/"), "index");
  assert.equal(slugify("apps/backoffice/src/lib/journey-api.ts"), "apps--backoffice--src--lib--journey-api-ts");
  assert.equal(slugify("(app)/_layout"), "(app)--_layout");
  assert.equal(slugify("/jobs/{id}/files/{p:path}"), "jobs--_id--files--_p");
});

test("extractMethods: three export forms, canonical order", () => {
  assert.deepEqual(extractMethods("export async function POST() {}\nexport async function GET() {}"), ["GET", "POST"]);
  assert.deepEqual(extractMethods("export const DELETE = handler"), ["DELETE"]);
  assert.deepEqual(extractMethods("export const { GET, POST } = handlers;"), ["GET", "POST"]);
  assert.deepEqual(extractMethods("export { doThing as PUT }"), ["PUT"]);
  // Non-method exports don't leak in.
  assert.deepEqual(extractMethods("export const MAX = 3\nexport async function GET() {}"), ["GET"]);
});

test("leadingComment: skips file-path echo, returns prose", () => {
  const text = "// src/app/api/journeys/[id]/route.ts\n// Journey load and save endpoints.\nimport x from 'y'";
  assert.equal(leadingComment(text), "Journey load and save endpoints.");
  assert.equal(leadingComment("import x from 'y'"), "");
  // Comment scan stops at the first non-comment line.
  assert.equal(leadingComment("import a from 'b'\n// later comment"), "");
});

test("scanFileText: quotes, const indirection, rpc, fetch", () => {
  const src = `
const BUCKET = 'survey-media'
await supabase.from('journeys').select()
await admin().from("video_assets").select()
await supabase.storage.from(BUCKET).upload(p, f)
await supabase.rpc('save_journey_graph', {})
await fetch('/api/journeys')
await fetch(\`/api/journeys/\${id}/runs?x=1\`)
Buffer.from(header, 'base64')
await db.from(tableVar).select()
`;
  const scan = scanFileText(src);
  assert.deepEqual([...scan.fromNames].sort(), ["journeys", "survey-media", "video_assets"]);
  assert.deepEqual([...scan.rpcNames], ["save_journey_graph"]);
  assert.deepEqual([...scan.fetchUrls].sort(), ["/api/journeys", "/api/journeys/*/runs"]);
  // Single-arg identifier form is Supabase-shaped and gets flagged; multi-arg
  // Buffer.from(x, 'base64') is deliberately ignored noise.
  assert.deepEqual([...scan.unresolvedFromIdents], ["tableVar"]);
});

test("normalizeFetchUrl: query, trailing slash, template holes", () => {
  assert.equal(normalizeFetchUrl("/api/x/${id}/y/?q=1"), "/api/x/*/y");
  assert.equal(normalizeFetchUrl("/api/x"), "/api/x");
});

test("makeRouteMatcher: exact, dynamic, catch-all", () => {
  const dyn = makeRouteMatcher("/api/journeys/[id]/runs/[runId]");
  assert.ok(dyn("/api/journeys/*/runs/*"));
  assert.ok(dyn("/api/journeys/abc/runs/def"));
  assert.ok(!dyn("/api/journeys/abc/runs"));
  assert.ok(!dyn("/api/journeys/abc/runs/def/extra"));

  const catchAll = makeRouteMatcher("/api/assets/video/[id]/hls/[...path]");
  assert.ok(catchAll("/api/assets/video/*/hls/a/b/c"));
  assert.ok(catchAll("/api/assets/video/*/hls/a"));
  assert.ok(!catchAll("/api/assets/video/*/hls"));

  const exact = makeRouteMatcher("/api/clients");
  assert.ok(exact("/api/clients"));
  assert.ok(!exact("/api/clients/extra"));

  // FastAPI-shaped patterns share the matcher: {x} is one segment, {x:path} is 1+.
  const fast = makeRouteMatcher("/jobs/{id}");
  assert.ok(fast("/jobs/*"));
  assert.ok(!fast("/jobs"));
  const fastCatch = makeRouteMatcher("/files/{p:path}");
  assert.ok(fastCatch("/files/a/b"));
  assert.ok(!fastCatch("/files"));
});
