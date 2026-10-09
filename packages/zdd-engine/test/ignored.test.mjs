// Ignored paths are never source (CAS-103 pick 1). The services extractor's
// default roots `["."]` read a gitignored `.claude/worktrees/` (another
// checkout of the same repo, created by the Claude desktop app) into DiO's
// and Cascade's service records: local `derive --check` passed, CI failed.
// Every walk now vetoes what the repository's own `.gitignore` rules ignore
// (never `.git/info/exclude` nor the global excludes: machine state, CR-406
// and decision 0026), and the worktree folder is vetoed by name even where
// git is absent. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { gitIgnoredPredicate, ALWAYS_IGNORED } from "../src/lib/ignored.mjs";
import { makeExtractorIo } from "../src/lib/extractor-io.mjs";
import { derive as services } from "../src/extractors/external-services/index.mjs";
import { derive as nextjs } from "../src/extractors/nextjs/index.mjs";
import { derive as fastapi } from "../src/extractors/fastapi/index.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE_SERVICES = join(PKG, "test", "fixture-services");

const scratch = (files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-ign-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const walked = (io, dir) => {
  const out = [];
  io.walk(dir, (rel) => out.push(rel));
  return out;
};

test("without git: the worktree folder is vetoed by name, nothing else is", (t) => {
  const root = scratch({ "src/a.ts": "a", ".claude/worktrees/x/src/a.ts": "a", "dist/b.ts": "b" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const isIgnored = gitIgnoredPredicate(root);
  assert.equal(isIgnored.source, "none", "no repo: git reports nothing");
  assert.equal(isIgnored(".claude/worktrees"), true);
  assert.equal(isIgnored(".claude/worktrees/x/src/a.ts"), true);
  assert.equal(isIgnored("dist/b.ts"), false, "a build folder is an extractor's own veto, never a guess here");
  assert.deepEqual(ALWAYS_IGNORED, [".claude/worktrees"]);
  assert.deepEqual(walked(makeExtractorIo(root), "."), ["dist/b.ts", "src/a.ts"]);
});

test("with git: .gitignore rules and ignored files are vetoed; .git/info/exclude is machine state and is NOT consulted (CR-406) — only .claude/worktrees is vetoed by name; tracked and plain untracked files are not", (t) => {
  const root = scratch({
    "src/a.ts": "a",
    "src/generated.ts": "g",
    "secrets/key.ts": "k",
    "untracked/new.ts": "n",
    "worktree-like/src/a.ts": "a",
    ".gitignore": "secrets/\nsrc/generated.ts\n",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  writeFileSync(join(root, ".git", "info", "exclude"), "worktree-like/\n");
  git(root, "add", "src/a.ts", ".gitignore");
  const isIgnored = gitIgnoredPredicate(root);
  assert.equal(isIgnored.source, "git");
  assert.equal(isIgnored("secrets"), true, "an ignored directory");
  assert.equal(isIgnored("secrets/key.ts"), true, "a file under an ignored directory");
  assert.equal(isIgnored("src/generated.ts"), true, "an ignored file");
  assert.equal(isIgnored("worktree-like"), false, "info/exclude is one machine's rule, not the repository's");
  assert.equal(isIgnored(".claude/worktrees/x"), true, "the worktree folder is vetoed by name instead");
  assert.equal(isIgnored("untracked/new.ts"), false, "untracked is still source — a new file on the branch");
  assert.equal(isIgnored("src/a.ts"), false);
  assert.deepEqual(walked(makeExtractorIo(root), "."), [".gitignore", "src/a.ts", "untracked/new.ts", "worktree-like/src/a.ts"]);
});

test("a repo root inside a larger git repo asks git relative to the root it was given", (t) => {
  const outer = scratch({ "pkg/src/a.ts": "a", "pkg/skip/b.ts": "b", ".gitignore": "pkg/skip/\n" });
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  git(outer, "init", "-q");
  const isIgnored = gitIgnoredPredicate(join(outer, "pkg"));
  assert.equal(isIgnored.source, "git");
  assert.equal(isIgnored("skip"), true);
  assert.equal(isIgnored("skip/b.ts"), true);
  assert.equal(isIgnored("src/a.ts"), false);
});

test("services: a declared service under a worktree copy does not become usedBy, with or without git", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-ign-svc-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE_SERVICES, repo, { recursive: true });
  // A worktree is another checkout of the same repo: a full copy of the source.
  cpSync(join(FIXTURE_SERVICES, "apps"), join(repo, ".claude", "worktrees", "feat-x", "apps"), { recursive: true });
  const options = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).extractorOptions["external-services"];
  const before = services({ repoRoot: FIXTURE_SERVICES, options, io: makeExtractorIo(FIXTURE_SERVICES, "external-services") });
  const after = services({ repoRoot: repo, options, io: makeExtractorIo(repo, "external-services") });
  assert.deepEqual(after.records, before.records, "the worktree copy changed nothing");
  assert.ok(!JSON.stringify(after.records).includes("worktrees"));
});

test("nextjs and fastapi (the walkDir extractors) honour the same veto through io", (t) => {
  const root = scratch({
    "src/app/page.tsx": "export default function P() { return null }\n",
    "src/app/api/x/route.ts": "export async function GET() {}\n",
    ".claude/worktrees/w/src/app/api/y/route.ts": "export async function GET() {}\n",
    "api/main.py": "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/a')\ndef a(): ...\n",
    "vendored/main.py": "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/b')\ndef b(): ...\n",
    ".gitignore": "vendored/\n",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  const io = makeExtractorIo(root, "t");
  const next = nextjs({ repoRoot: root, options: { appDir: "src/app" }, io });
  assert.deepEqual(next.records.filter((r) => r.kind === "route").map((r) => r.id), ["route:/api/x"]);
  const py = fastapi({ repoRoot: root, options: { roots: ["."] }, io });
  assert.deepEqual(py.records.map((r) => r.id), ["route:/a"]);
});

test("CLI: derive on a repo with an ignored worktree copy writes the same records as without it", (t) => {
  const plain = mkdtempSync(join(tmpdir(), "zdd-ign-cli-a-"));
  const withTree = mkdtempSync(join(tmpdir(), "zdd-ign-cli-b-"));
  t.after(() => {
    rmSync(plain, { recursive: true, force: true });
    rmSync(withTree, { recursive: true, force: true });
  });
  for (const repo of [plain, withTree]) cpSync(FIXTURE_SERVICES, repo, { recursive: true });
  cpSync(join(FIXTURE_SERVICES, "apps"), join(withTree, ".claude", "worktrees", "feat-x", "apps"), { recursive: true });
  const run = (repo) => execFileSync(process.execPath, [BIN, "derive"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run(plain);
  run(withTree);
  const read = (repo, rel) => (existsSync(join(repo, "zdd", "metadata", rel)) ? readFileSync(join(repo, "zdd", "metadata", rel), "utf8") : null);
  for (const rel of ["external-service/sentry.json", "external-service/resend.json"]) {
    assert.ok(read(plain, rel), `${rel} exists`);
    assert.equal(read(withTree, rel), read(plain, rel), `${rel} byte-identical`);
  }
});

// --- slice 1 review: CR-307, CR-308, CR-309, CR-320 ---------------------------------

test("CR-308: only the repository's own ignore sources count — a user's global excludes file is never consulted, so two machines agree on the same bytes", (t) => {
  const root = scratch({ "src/a.ts": "a", "src/local-only.ts": "b", ".gitignore": "" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  const globalExcludes = join(root, "..", `zdd-global-excludes-${process.pid}`);
  writeFileSync(globalExcludes, "local-only.ts\n");
  t.after(() => rmSync(globalExcludes, { force: true }));
  git(root, "config", "core.excludesFile", globalExcludes);
  // git itself would ignore it under --exclude-standard:
  assert.match(git(root, "ls-files", "--others", "--ignored", "--exclude-standard"), /local-only/);
  const isIgnored = gitIgnoredPredicate(root);
  assert.equal(isIgnored.source, "git");
  assert.equal(isIgnored("src/local-only.ts"), false, "a personal rule is not the repo's");
  assert.deepEqual(walked(makeExtractorIo(root), "src"), ["src/a.ts", "src/local-only.ts"]);
});

test("CR-307: io.read refuses an ignored file with its own code; an ignored import target does not exist for the extractors that resolve imports", (t) => {
  const root = scratch({ "src/a.ts": "a", "dist/gen.ts": "g", ".gitignore": "dist/\n" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  const io = makeExtractorIo(root);
  const r = io.read("dist/gen.ts");
  assert.equal(r.ok, false);
  assert.equal(r.code, "ignored");
  assert.match(r.reason, /dist\/gen\.ts is gitignored — not source, not read/);
  assert.equal(io.read("src/a.ts").ok, true);
  assert.equal(io.isIgnored("dist/gen.ts"), true);
});

test("CR-307/CR-320: supabase migrations, a react-router routes module, a FastAPI file root and a Next.js middleware file under an ignore rule are not source", async (t) => {
  const { derive: supabase } = await import("../src/extractors/supabase/index.mjs");
  const { derive: reactRouter } = await import("../src/extractors/react-router/index.mjs");
  const root = scratch({
    "db/migrations/001_a.sql": "create table public.a (id int);\n",
    "db/migrations/002_local.sql": "create table public.local_only (id int);\n",
    "vendored/migrations/001_v.sql": "create table public.vendored (id int);\n",
    "web/src/routes.tsx": 'import { Home } from "./Home";\nimport { Gen } from "./gen/Gen";\nexport const routes = [{ path: "/", element: <Home /> }, { path: "/gen", element: <Gen /> }];\n',
    "web/src/Home.tsx": "export function Home() { return null }\n",
    "web/src/gen/Gen.tsx": 'export function Gen() { supabase.from("secret_table"); return null }\n',
    "api/main.py": "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/a')\ndef a(): ...\n",
    "api/generated.py": "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/generated')\ndef g(): ...\n",
    "src/app/page.tsx": "export default function P() { return null }\n",
    "src/app/api/x/route.ts": "export async function GET() {}\n",
    "src/middleware.ts": 'export const config = { matcher: ["/api/:path*"] };\n',
    ".gitignore": "db/migrations/002_local.sql\nvendored/\nweb/src/gen/\napi/generated.py\nsrc/middleware.ts\n",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  const io = () => makeExtractorIo(root, "t");
  const sb = supabase({ repoRoot: root, options: { migrationNamespaces: [{ name: "db", dir: "db/migrations" }, { name: "v", dir: "vendored/migrations" }] }, io: io() });
  assert.deepEqual(sb.records.filter((r) => r.kind === "table").map((r) => r.id).sort(), ["table:db/public.a"]);
  assert.ok(sb.diagnostics.some((d) => /vendored\/migrations is gitignored — not source/.test(d)), sb.diagnostics.join("\n"));
  const rr = reactRouter({ repoRoot: root, options: { routesFile: "web/src/routes.tsx" }, io: io() });
  assert.ok(!JSON.stringify(rr.records).includes("secret_table"), "an ignored module's refs never reach a record");
  assert.ok(!JSON.stringify(rr.records).includes("web/src/gen/Gen.tsx"), "an ignored candidate is as absent as it is in a clean clone (CR-408)");
  const py = fastapi({ repoRoot: root, options: { roots: ["api/main.py", "api/generated.py"] }, io: io() });
  assert.deepEqual(py.records.map((r) => r.id), ["route:/a"]);
  assert.ok(py.diagnostics.some((d) => /api\/generated\.py is gitignored — not source, not read/.test(d)));
  const next = nextjs({ repoRoot: root, options: { appDir: "src/app", middlewarePath: "src/middleware.ts" }, io: io() });
  const route = next.records.find((r) => r.id === "route:/api/x");
  assert.ok(route);
  assert.equal(route.facts.auth, "public", "an ignored middleware file sets no auth: the route stays public");
  assert.ok(next.diagnostics.some((d) => /src\/middleware\.ts is gitignored — not source, no middleware auth derived/.test(d)), next.diagnostics.join("\n"));
});

test("CR-403: a repository whose ignored set git cannot list stops derive (fail closed, with the reason); a folder that is no repository stays silent", (t) => {
  const plain = scratch({ "src/a.ts": "a", "zdd/config.json": JSON.stringify({ extractors: ["generic"] }) });
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  assert.equal(gitIgnoredPredicate(plain).error, null, "not a repository: no error, no warning");
  const ok = execFileSync(process.execPath, [BIN, "derive"], { cwd: plain, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(ok, /Wrote 0 records|nothing to inventory/);
  const root = scratch({ "src/a.ts": "a", "zdd/config.json": JSON.stringify({ extractors: ["generic"] }) });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  git(root, "add", "src/a.ts");
  // A corrupt index is the simplest failure to stage: `git ls-files` reads
  // the index and refuses, and that is not "not a repository".
  writeFileSync(join(root, ".git", "index"), "garbage");
  const p = gitIgnoredPredicate(root);
  assert.equal(p.source, "none");
  assert.match(p.error ?? "", /this folder is a git repository but its ignored paths could not be listed .* derive stops rather than read gitignored files as source/, "the reason is said");
  assert.equal(p(".claude/worktrees/x"), true, "the built-in veto still holds");
  const r = spawnSync(process.execPath, [BIN, "derive"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 1, "derive fails closed");
  assert.match(r.stderr, /could not be listed/);
  assert.ok(!existsSync(join(root, "zdd", "metadata")), "nothing was written");
});

test("CR-423: an ignored import target does not exist for the components extractor, nor an ignored command target for the jobs extractor", async (t) => {
  const { derive: components } = await import("../src/extractors/components/index.mjs");
  const { derive: jobs } = await import("../src/extractors/jobs/index.mjs");
  const root = scratch({
    "web/src/App.tsx": 'import { Gen } from "./gen/Gen";\nexport function App() { return <Gen /> }\n',
    "web/src/gen/Gen.tsx": "export function Gen() { return null }\n",
    "Procfile": "worker: node dist/worker.mjs\n",
    "dist/worker.mjs": "// built\n",
    ".gitignore": "web/src/gen/\ndist/\n",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  const c = components({ repoRoot: root, options: { roots: ["web/src"] }, io: makeExtractorIo(root, "components") });
  assert.ok(!c.records.some((r) => /gen/i.test(r.id)), "no record for the ignored component");
  assert.ok(!JSON.stringify(c.records).includes("web/src/gen/Gen.tsx"), "no edge into it either");
  const j = jobs({ repoRoot: root, options: {}, io: makeExtractorIo(root, "jobs") });
  assert.deepEqual(j.records, [], "a job whose file exists only as ignored build output resolves to no file");
  assert.ok(j.diagnostics.some((d) => /'worker' runs dist\/worker\.mjs, which resolves to no file/.test(d)), j.diagnostics.join("\n"));
});

test("CR-408: a Next.js wrapper page does not take an ignored component as its resource; a React Router import never resolves to an ignored candidate that would shadow a tracked one", async (t) => {
  const { derive: reactRouter } = await import("../src/extractors/react-router/index.mjs");
  const root = scratch({
    "src/app/page.tsx": 'import Screen from "@/components/Screen";\nexport default function Page() { return <Screen /> }\n',
    "src/components/Screen.tsx": "export default function Screen() { return null }\n",
    "web/src/routes.tsx": 'import { Widget } from "./Widget";\nexport const routes = [{ path: "/", element: <Widget /> }];\n',
    "web/src/Widget.js": 'export function Widget() { supabase.from("tracked_table"); return null }\n',
    "web/src/Widget.tsx": 'export function Widget() { supabase.from("ignored_table"); return null }\n',
    ".gitignore": "src/components/\nweb/src/Widget.tsx\n",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  const io = () => makeExtractorIo(root, "t");
  const next = nextjs({ repoRoot: root, options: { appDir: "src/app" }, io: io() });
  const page = next.records.find((r) => r.kind === "surface");
  assert.ok(page, "the page is a surface");
  assert.deepEqual(page.resource, ["src/app/page.tsx"], "the ignored component is not its resource");
  const rr = reactRouter({ repoRoot: root, options: { routesFile: "web/src/routes.tsx" }, io: io() });
  const text = JSON.stringify(rr.records);
  assert.ok(text.includes("tracked_table"), "the tracked .js candidate is the one resolved");
  assert.ok(!text.includes("ignored_table"), "the ignored .tsx never shadows it");
});

test("CR-525: the built-in worktree veto folds case — `.CLAUDE/Worktrees` is the same folder on a case-insensitive disk", (t) => {
  const root = scratch({ "src/a.ts": "a" });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const isIgnored = gitIgnoredPredicate(root);
  assert.equal(isIgnored(".CLAUDE/Worktrees/x/src/a.ts"), true);
  assert.equal(isIgnored(".claude/worktrees"), true);
  assert.equal(isIgnored(".claude/worktree/x.ts"), false);
});
