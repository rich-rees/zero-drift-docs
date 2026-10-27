// The slice 5 campaign's findings on the catalogue adapters moved onto io,
// and on io itself (CR-119, CR-126, CR-129 to CR-132, CR-139, CR-144,
// CR-145): one test per finding, each shown red without its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";
import { derive as nextjs } from "../src/adapters/nextjs/index.mjs";
import { derive as supabase } from "../src/adapters/supabase/index.mjs";
import { derive as reactRouter } from "../src/adapters/react-router/index.mjs";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "zdd-engine.mjs");
const POSIX = process.platform !== "win32";

function repo(t, files) {
  const root = mkdtempSync(join(tmpdir(), "zdd-adapters-cr-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
// io, with every read and walk counted.
function countingIo(root, label, opts) {
  const io = makeExtractorIo(root, label, opts);
  const reads = new Map();
  const walks = [];
  return {
    reads,
    walks,
    io: {
      ...io,
      read: (rel, o) => {
        reads.set(rel, (reads.get(rel) ?? 0) + 1);
        return io.read(rel, o);
      },
      walk: (rel, ...rest) => {
        walks.push(rel);
        return io.walk(rel, ...rest);
      },
    },
  };
}
const ROUTE = "export async function GET() { return Response.json([]); }\n";
const BIG = (head) => head + "\n" + "// pad\n".repeat(160_000); // over 1 MiB

test("CR-119: nextjs reads the middleware matcher from live code only — a commented-out one is never a matcher, and a live one after it is", (t) => {
  const commented = repo(t, { "src/middleware.ts": 'export function middleware() {}\n// export const config = { matcher: ["/api/a"] };\n', "src/app/api/a/route.ts": ROUTE });
  assert.throws(() => nextjs({ repoRoot: commented, io: makeExtractorIo(commented, "nextjs"), options: { appDir: "src/app", middlewarePath: "src/middleware.ts" } }), /No config\.matcher found/);
  const both = repo(t, { "src/middleware.ts": '// export const config = { matcher: ["/api/a"] };\nexport const config = { matcher: ["/api/b"] };\n', "src/app/api/a/route.ts": ROUTE, "src/app/api/b/route.ts": ROUTE });
  const out = nextjs({ repoRoot: both, io: makeExtractorIo(both, "nextjs"), options: { appDir: "src/app", middlewarePath: "src/middleware.ts" } });
  const auth = Object.fromEntries(out.records.filter((r) => r.kind === "route").map((r) => [r.id, r.facts.auth]));
  assert.deepEqual(auth, { "route:/api/a": "public", "route:/api/b": "session" });
});

test("CR-129: a route or page nextjs cannot read stops derive, naming the file — never an empty, public record", (t) => {
  const root = repo(t, { "src/app/api/big/route.ts": BIG(ROUTE) });
  assert.throws(() => nextjs({ repoRoot: root, io: makeExtractorIo(root, "nextjs"), options: { appDir: "src/app" } }), /src\/app\/api\/big\/route\.ts is over \d+ bytes/);
});

test("CR-130: a migration supabase cannot read stops derive — never an incomplete schema", (t) => {
  const root = repo(t, { "supabase/migrations/0001_init.sql": "create table a (id int);\n", "supabase/migrations/0002_big.sql": BIG("create table b (id int);") });
  assert.throws(() => supabase({ repoRoot: root, io: makeExtractorIo(root, "supabase"), options: { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] } }), /0002_big\.sql is over \d+ bytes/);
});

test("CR-126: supabase never lists a gitignored migrations folder", (t) => {
  const root = repo(t, { ".gitignore": "supabase/\n", "supabase/migrations/0001_init.sql": "create table a (id int);\n" });
  execFileSync("git", ["init", "-q"], { cwd: root });
  const c = countingIo(root, "supabase");
  const out = supabase({ repoRoot: root, io: c.io, options: { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] } });
  assert.deepEqual(c.walks, []);
  assert.deepEqual(out.records, []);
  assert.match(out.diagnostics.join("\n"), /gitignored/);
});

test("CR-132: nextjs reads each file once, and finds a wrapper's target without reading it (one over 1 MiB too)", (t) => {
  const root = repo(t, {
    "src/app/page.tsx": 'import Home from "@/components/Home";\nexport default function Page() {\n  return <Home />;\n}\n',
    "src/components/Home.tsx": BIG("export default function Home() { return null; }"),
    "src/app/api/a/route.ts": ROUTE,
    "src/lib/x.ts": 'export const x = () => fetch("/api/a");\n',
  });
  const c = countingIo(root, "nextjs");
  const out = nextjs({ repoRoot: root, io: c.io, options: { appDir: "src/app" } });
  for (const [rel, n] of c.reads) assert.equal(n, 1, `${rel} read ${n} times`);
  assert.deepEqual(out.records.find((r) => r.id === "surface:/").resource, ["src/components/Home.tsx", "src/app/page.tsx"]);
});

test("CR-131: io.kind says unreadable — never missing — when a path cannot be examined, and react-router stops on it (POSIX)", { skip: (!POSIX || process.getuid?.() === 0) && "needs a permission the user cannot bypass" }, (t) => {
  const root = repo(t, { "web/src/routes.tsx": "export const routes = [];\n" });
  chmodSync(join(root, "web"), 0o000);
  t.after(() => chmodSync(join(root, "web"), 0o755));
  const io = makeExtractorIo(root, "react-router");
  assert.equal(io.kind("web/src"), "unreadable");
  assert.throws(() => reactRouter({ repoRoot: root, io, options: { routesFile: "web/src/routes.tsx" } }), /cannot be examined/);
});

test("CR-144: io.kind calls a folder under a linked folder linked, never a directory", (t) => {
  const root = repo(t, { "real/inner/a.txt": "x" });
  symlinkSync(join(root, "real"), join(root, "via"), POSIX ? "dir" : "junction");
  const io = makeExtractorIo(root, "x");
  assert.equal(io.kind("real/inner"), "directory");
  assert.equal(io.kind("via/inner"), "linked");
  assert.equal(io.kind("via/inner/a.txt"), "linked");
  assert.equal(io.kind("via"), "symlink");
  assert.equal(io.kind("real/inner/a.txt"), "file");
  assert.equal(io.kind("nope"), "missing");
  assert.equal(io.kind("real/inner/a.txt/deeper"), "missing");
  assert.throws(() => io.kind("../x"), /repo-relative/);
});

test("CR-145: react-router says why its routes file could not be read — not always 'over 1024 KiB'", (t) => {
  const root = repo(t, { "web/src/routes.tsx": 'import { createBrowserRouter } from "react-router-dom";\nexport const router = createBrowserRouter([{ path: "/", element: null }]);\n' });
  const io = makeExtractorIo(root, "react-router", { maxTotalBytes: 10 });
  assert.throws(() => reactRouter({ repoRoot: root, io, options: { routesFile: "web/src/routes.tsx" } }), (e) => /total read budget/.test(e.message) && !/over 1024 KiB/.test(e.message));
});

test("CR-139: external-services detection proposes nothing from a commented-out import or env read, and still finds a live one", (t) => {
  const quiet = repo(t, { "app.py": '# import sentry_sdk\n# key = os.getenv("ACME_API_KEY")\n', "web.ts": '// const k = process.env.BRAVO_API_KEY;\n' });
  const d = JSON.parse(spawnSync(process.execPath, [BIN, "detect", `--root=${quiet}`], { encoding: "utf8" }).stdout);
  assert.ok(!d.proposals.some((p) => p.name === "external-services"), JSON.stringify(d.proposals));
  const live = repo(t, { "app.py": 'import os\nkey = os.getenv("ACME_API_KEY")\n' });
  const l = JSON.parse(spawnSync(process.execPath, [BIN, "detect", `--root=${live}`], { encoding: "utf8" }).stdout);
  assert.ok(l.proposals.some((p) => p.name === "external-services"), JSON.stringify(l.proposals));
});
