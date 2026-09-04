// The shared walker and the supabase migration reader against symlinks that
// point nowhere. Following a VALID directory link stays as documented
// (CR-016 / decision 0001: an adopter who links part of their own tree still
// wants it inventoried); a DANGLING link used to throw ENOENT out of the
// extractor and fail derive outright (CR-062). Now it is skipped with a
// diagnostic. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walkDir } from "../src/lib/walk.mjs";
import { derive as supabase } from "../src/extractors/supabase/index.mjs";
import { derive as fastapi } from "../src/extractors/fastapi/index.mjs";
import { derive as nextjs } from "../src/extractors/nextjs/index.mjs";

const scratch = (files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-walk-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};
// Dangling links: the target never exists. Skip (narrated) where the OS
// refuses to create links at all — Linux CI exercises the guard.
const dangle = (t, root, rel, type = "file") => {
  try {
    symlinkSync(join(root, "does-not-exist"), join(root, rel), type);
    return true;
  } catch (e) {
    if (e.code !== "EPERM") throw e;
    t.skip("symlink creation needs privileges on this machine (EPERM)");
    rmSync(root, { recursive: true, force: true });
    return false;
  }
};

test("CR-062: walkDir skips a dangling file or directory link, reports it, and still visits everything real", (t) => {
  const root = scratch({ "a/real.py": "", "b/keep.py": "" });
  if (!dangle(t, root, "a/ghost.py")) return;
  symlinkSync(join(root, "nowhere"), join(root, "ghost-dir"), "junction");
  // A valid directory link is still followed (documented behaviour, unchanged).
  symlinkSync(join(root, "b"), join(root, "b-link"), "junction");
  const files = [];
  const skipped = [];
  walkDir(root, (_p, name) => files.push(name), new Set(), () => true, (p, reason) => skipped.push([p, reason]));
  assert.deepEqual(files.sort(), ["keep.py", "real.py"], "real files visited, b/ once via the real dir or the link");
  assert.equal(skipped.length, 2, JSON.stringify(skipped));
  assert.ok(skipped.every(([, reason]) => /dangling symlink/.test(reason)), JSON.stringify(skipped));
  rmSync(root, { recursive: true, force: true });
});

test("CR-062: supabase — a dangling .sql link in a migrations dir is skipped with a diagnostic; the real migrations replay", (t) => {
  const root = scratch({ "migrations/0001_init.sql": "create table jobs (id uuid primary key);\n" });
  if (!dangle(t, root, "migrations/0002_ghost.sql")) return;
  const { records, diagnostics } = supabase({ repoRoot: root, options: { migrationNamespaces: [{ name: "db", dir: "migrations" }] } });
  assert.deepEqual(records.map((r) => r.id), ["table:db/jobs"]);
  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.match(diagnostics[0], /migrations\/0002_ghost\.sql.*dangling symlink/);
  rmSync(root, { recursive: true, force: true });
});

test("CR-062: fastapi and nextjs — a dangling link under a scanned root is skipped with a diagnostic, never a crash", (t) => {
  const root = scratch({
    "api/jobs.py": `router = APIRouter(prefix="/jobs")\n\n@router.get("/")\ndef list_jobs(): pass\n`,
    "src/app/page.tsx": "export default function Page() { return null }\n",
  });
  if (!dangle(t, root, "api/ghost.py")) return;
  symlinkSync(join(root, "nowhere"), join(root, "src", "app", "ghost"), "junction");
  const fast = fastapi({ repoRoot: root, options: { roots: ["api"] } });
  assert.deepEqual(fast.records.map((r) => r.id), ["route:/jobs/"]);
  assert.ok(fast.diagnostics.some((d) => /api\/ghost\.py.*dangling symlink/.test(d)), JSON.stringify(fast.diagnostics));
  const next = nextjs({ repoRoot: root, options: { appDir: "src/app" } });
  assert.deepEqual(next.records.map((r) => r.id), ["surface:/"]);
  assert.ok(next.diagnostics.some((d) => /src\/app\/ghost.*dangling symlink/.test(d)), JSON.stringify(next.diagnostics));
  rmSync(root, { recursive: true, force: true });
});
