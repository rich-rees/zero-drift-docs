// FastAPI extractor parsing units + composition against a scratch repo.
// Review CR-010 / CR-011 / CR-012 / CR-013 / CR-002 (DIO-309 campaign).
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFile, joinPath, derive } from "../src/extractors/fastapi/index.mjs";
import { slugify } from "../src/lib/slug.mjs";

test("parseFile: routers with prefix, api_route methods, stacked decorators, docstring, TRACE (CR-011)", () => {
  const { routers, handlers } = parseFile(`
router = APIRouter(prefix="/jobs")
bare = APIRouter()

@router.get("/{id}")
@router.head("/{id}")
async def read(id: str):
    """Fetch one."""
    return supabase.table("jobs").select()

@bare.api_route("/multi", methods=["GET", "POST"])
def multi():
    pass

@app.trace("/t")
def trace():
    pass
`);
  assert.deepEqual([...routers], [["router", "/jobs"], ["bare", ""]]);
  assert.equal(handlers.length, 3);
  assert.deepEqual(handlers[0].decorators.map((d) => d.methods), [["GET"], ["HEAD"]]);
  assert.equal(handlers[0].docstring, "Fetch one.");
  assert.deepEqual(handlers[1].decorators[0].methods, ["GET", "POST"]);
  assert.deepEqual(handlers[2].decorators[0].methods, ["TRACE"]);
});

test("parseFile: a comment or blank line between decorator and def keeps the route (CR-012)", () => {
  const { handlers } = parseFile(`
@app.get("/jobs")
# explains the handler

def jobs():
    pass
`);
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0].name, "jobs");
});

test("joinPath: literal concatenation, doubled slashes collapsed", () => {
  assert.equal(joinPath("/jobs", "/{id}"), "/jobs/{id}");
  assert.equal(joinPath("/jobs", "/"), "/jobs/");
  assert.equal(joinPath("/jobs", ""), "/jobs");
  assert.equal(joinPath("", "offers"), "/offers");
});

test("slugify keeps converter identity: {p} and {p:path} differ (CR-013)", () => {
  assert.notEqual(slugify("/files/{p}"), slugify("/files/{p:path}"));
  assert.equal(slugify("/files/{p:path}"), "files--___p");
  assert.equal(slugify("/items/{id:int}"), "items--_id");
});

const scratch = (files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-fastapi-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};

test("include_router: prefixes propagate transitively and a router mounted twice yields both mounts (CR-010)", () => {
  const root = scratch({
    "main.py": `app = FastAPI()\napp.include_router(api.router, prefix="/api")\napp.include_router(jobs.router, prefix="/v2")\n`,
    "api.py": `router = APIRouter(prefix="/v1")\nrouter.include_router(jobs.router)\n`,
    "jobs.py": `router = APIRouter(prefix="/jobs")\n\n@router.get("/{id}")\ndef read(id): pass\n`,
  });
  const { records, diagnostics } = derive({ repoRoot: root, options: { roots: ["."] } });
  assert.deepEqual(records.map((r) => r.id).sort(), ["route:/api/v1/jobs/{id}", "route:/v2/jobs/{id}"]);
  assert.deepEqual(diagnostics, []);
  rmSync(root, { recursive: true, force: true });
});

test("CR-066: a package-qualified include_router target resolves against the file path when the bare module name is ambiguous", () => {
  const root = scratch({
    "main.py": `app = FastAPI()\napp.include_router(a.routes.router, prefix="/api")\n`,
    "a/routes.py": `router = APIRouter(prefix="/r")\n\n@router.get("/x")\ndef x(): pass\n`,
    "b/routes.py": `router = APIRouter(prefix="/r")\n\n@router.get("/y")\ndef y(): pass\n`,
  });
  const { records, diagnostics } = derive({ repoRoot: root, options: { roots: ["."] } });
  // a/ is mounted under /api; b/ is an ordinary unmounted root router.
  assert.deepEqual(records.map((r) => r.id).sort(), ["route:/api/r/x", "route:/r/y"]);
  assert.deepEqual(diagnostics, []);
  rmSync(root, { recursive: true, force: true });
});

test("CR-066: a still-ambiguous include_router target roots neither candidate — their handlers are skipped with a diagnostic", () => {
  const root = scratch({
    "main.py": `app = FastAPI()\napp.include_router(routes.router, prefix="/api")\napp.include_router(health.router)\n`,
    "a/routes.py": `router = APIRouter(prefix="/r")\n\n@router.get("/x")\ndef x(): pass\n`,
    "b/routes.py": `router = APIRouter(prefix="/r")\n\n@router.get("/y")\ndef y(): pass\n`,
    "health.py": `router = APIRouter()\n\n@router.get("/health")\ndef health(): pass\n`,
  });
  const { records, diagnostics } = derive({ repoRoot: root, options: { roots: ["."] } });
  // Before: both candidates were emitted as if mounted at the root (/r/x, /r/y)
  // — a wrong prefix presented as fact. Now neither is emitted.
  assert.deepEqual(records.map((r) => r.id), ["route:/health"]);
  assert.ok(diagnostics.some((d) => /main\.py: include_router\(routes\.router\).*ambiguous.*a\/routes\.py.*b\/routes\.py/.test(d)), JSON.stringify(diagnostics));
  assert.ok(diagnostics.some((d) => /a\/routes\.py: @router\.\* on x .*skipped/.test(d)), JSON.stringify(diagnostics));
  assert.ok(diagnostics.some((d) => /b\/routes\.py: @router\.\* on y .*skipped/.test(d)), JSON.stringify(diagnostics));
  rmSync(root, { recursive: true, force: true });
});

test("missing configured roots produce a diagnostic, never an error (CR-002)", () => {
  const root = scratch({ "keep.txt": "" });
  const { records, diagnostics } = derive({ repoRoot: root, options: { roots: ["api", "main.py"] } });
  assert.deepEqual(records, []);
  assert.equal(diagnostics.length, 2);
  assert.match(diagnostics[0], /api not found — nothing to inventory/);
  rmSync(root, { recursive: true, force: true });
});

test("option shape is checked: roots must be an array (CR-021)", () => {
  assert.throws(() => derive({ repoRoot: ".", options: { roots: "api" } }), /fastapi: 'roots' must be an array/);
});
