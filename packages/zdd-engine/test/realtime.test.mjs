// Realtime subscriptions (CAS-97 item 5): a surface that reads a table over
// Supabase Realtime bypasses the API, so it gets a `subscribes` edge to the
// table — from the client's own `.on("postgres_changes", { table })` and
// from any helper the adopter names (Cascade's `live.onInsert`), in both page
// extractors. A variable table is not seen. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSubscriptions, derive as reactRouter } from "../src/extractors/react-router/index.mjs";
import { derive as nextjs } from "../src/extractors/nextjs/index.mjs";
import { derive as supabase } from "../src/extractors/supabase/index.mjs";
import { resolveRefs } from "../src/lib/resolve-refs.mjs";

const scratch = (files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-rt-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};

test("scanSubscriptions: the client shape with a literal table (multi-line, any order of keys), a named helper, never a variable table, never a comment, never a helper with a non-literal first argument", () => {
  const text = `
    supabase.channel("a").on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_events" }, cb).subscribe();
    client
      .channel(\`\${table}:\${Date.now()}\`)
      .on("postgres_changes", {
        schema: "public",
        table,
        event: "*",
      }, cb);
    sb.on('postgres_changes', { table: 'jobs', event: 'UPDATE' }, cb);
    live.onInsert("outbound_messages", (row) => row);
    live.onInsert(tableName, cb);
    other.onInsert("not_a_helper", cb);
    // live.onInsert("commented_out", cb)
    const s = 'live.onInsert("in_a_string", cb)';
  `;
  assert.deepEqual([...scanSubscriptions(text, ["live.onInsert"])].sort(), ["audit_events", "jobs", "outbound_messages"]);
  assert.deepEqual([...scanSubscriptions(text)].sort(), ["audit_events", "jobs"]);
  assert.deepEqual([...scanSubscriptions(text, ["bad name", 42])], ["audit_events", "jobs"], "an unusable helper name is ignored");
});

test("react-router (Cascade's shape): the Activity screen calls live.onInsert('audit_events') through its services module — a subscribes edge to the table, also a plain ref; a screen without one has no edges fact", () => {
  const root = scratch({
    "migrations/0001.sql": "create table audit_events (id uuid primary key);\ncreate table jobs (id uuid primary key);\n",
    "web/src/routes.tsx": 'import { ActivityPage } from "./ActivityPage";\nimport { JobsPage } from "./JobsPage";\nexport const routes = [{ path: "/activity", element: <ActivityPage /> }, { path: "/jobs", element: <JobsPage /> }];\n',
    "web/src/ActivityPage.tsx": 'import { useServices } from "./services";\nexport function ActivityPage() {\n  const { live, api } = useServices();\n  live.onInsert("audit_events", (row) => row);\n  api.get("/activity");\n  return <main />;\n}\n',
    "web/src/JobsPage.tsx": 'import { useServices } from "./services";\nexport function JobsPage() {\n  const { api } = useServices();\n  api.get("/jobs");\n  return <main />;\n}\n',
    "web/src/services.ts": 'export function useServices() {\n  return {\n    api: { get: (p: string) => p },\n    live: { onInsert: (table: string, cb: (r: unknown) => void) => supabase.channel(`${table}:1`).on("postgres_changes", { schema: "public", table }, cb) },\n  };\n}\n',
  });
  try {
    const db = supabase({ repoRoot: root, options: { migrationNamespaces: [{ name: "db", dir: "migrations" }] } });
    const web = reactRouter({ repoRoot: root, options: { routesFile: "web/src/routes.tsx", subscribeCalls: ["live.onInsert"] } });
    const { records } = resolveRefs([...db.records, ...web.records]);
    const activity = records.find((r) => r.id === "surface:/activity");
    assert.deepEqual(activity.refs, ["table:db/audit_events"], "the /activity call matches no route here and drops; the subscription stays");
    assert.deepEqual(activity.facts.edges, { subscribes: ["table:db/audit_events"] });
    const jobs = records.find((r) => r.id === "surface:/jobs");
    assert.equal(jobs.facts.edges, undefined);
    // Without the helper named, the services module's own `.on` has a variable table: nothing is seen.
    const plain = reactRouter({ repoRoot: root, options: { routesFile: "web/src/routes.tsx" } });
    assert.equal(plain.records.find((r) => r.id === "surface:/activity").facts.edges, undefined);
    assert.throws(() => reactRouter({ repoRoot: root, options: { routesFile: "web/src/routes.tsx", subscribeCalls: "live.onInsert" } }), /subscribeCalls' must be an array/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nextjs: a page's own .on('postgres_changes', { table: 'things' }) and a named helper become a subscribes edge on the surface", () => {
  const root = scratch({
    "migrations/0001.sql": "create table things (id uuid primary key);\ncreate table events (id uuid primary key);\n",
    "src/app/layout.tsx": "export default function Layout({ children }) { return children }\n",
    "src/app/page.tsx": 'export default function Home() {\n  supabase.channel("x").on("postgres_changes", { event: "*", schema: "public", table: "things" }, () => {});\n  live.onInsert("events", () => {});\n  return null;\n}\n',
    "src/app/quiet/page.tsx": "export default function Quiet() { return null }\n",
  });
  try {
    const db = supabase({ repoRoot: root, options: { migrationNamespaces: [{ name: "db", dir: "migrations" }] } });
    const out = nextjs({ repoRoot: root, options: { appDir: "src/app", refs: { subscribeCalls: ["live.onInsert"] } } });
    const { records } = resolveRefs([...db.records, ...out.records]);
    const home = records.find((r) => r.id === "surface:/");
    assert.deepEqual(home.refs, ["table:db/events", "table:db/things"]);
    assert.deepEqual(home.facts.edges, { subscribes: ["table:db/events", "table:db/things"] });
    assert.equal(records.find((r) => r.id === "surface:/quiet").facts.edges, undefined);
    assert.throws(() => nextjs({ repoRoot: root, options: { appDir: "src/app", refs: { subscribeCalls: [1] } } }), /refs\.subscribeCalls' must be an array/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a subscribes ref resolves against a schema-qualified table (CAS-99): migrations that say `public.audit_events` still give the Activity page its edge, from a bare name or a `schema.table` one", () => {
  const root = scratch({
    "migrations/0001.sql": "create table public.audit_events (id uuid primary key);\ncreate table public.jobs (id uuid primary key);\n",
    "web/src/routes.tsx": 'import { ActivityPage } from "./ActivityPage";\nexport const routes = [{ path: "/activity", element: <ActivityPage /> }];\n',
    "web/src/ActivityPage.tsx": 'export function ActivityPage() {\n  live.onInsert("audit_events", (row) => row);\n  live.onInsert("public.jobs", (row) => row);\n  return <main />;\n}\n',
  });
  try {
    const db = supabase({ repoRoot: root, options: { migrationNamespaces: [{ name: "db", dir: "migrations" }] } });
    assert.ok(db.records.some((r) => r.id === "table:db/public.audit_events"), "the table keeps its schema in its id");
    const web = reactRouter({ repoRoot: root, options: { routesFile: "web/src/routes.tsx", subscribeCalls: ["live.onInsert"] } });
    const { records, diagnostics } = resolveRefs([...db.records, ...web.records]);
    const activity = records.find((r) => r.id === "surface:/activity");
    assert.deepEqual(activity.facts.edges, { subscribes: ["table:db/public.audit_events", "table:db/public.jobs"] });
    assert.deepEqual(diagnostics, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
