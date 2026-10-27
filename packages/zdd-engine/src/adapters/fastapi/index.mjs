// fastapi extractor — routes from decorated handlers in a FastAPI codebase.
// One convention: `@app.<method>("/path")` and `@router.<method>("/path")`
// decorators, with `router = APIRouter(prefix="...")` and
// `<receiver>.include_router(<mod>.router, prefix="...")` mounts applied —
// transitively (app -> api router -> jobs router) and for every mount (one
// router included under both /v1 and /v2 yields both route sets). Textual,
// no Python parsing; functions, strings and imports are read by the shared
// helper (adapters/python/source.mjs). `<mod>.router` resolves through the
// file's imports (`from app.routes import jobs` names app/routes/jobs.py
// though a repository module shares the basename); with no import of `<mod>`
// the old rule runs: the one scanned file called <mod>.py (a package-qualified
// `a.routes.router` prefers `a/routes.py`). An import that resolves to no file
// or to several, and a basename that is still ambiguous, mount nothing: those
// routers' handlers are skipped rather than emitted at a guessed prefix.
// Options (extractorOptions.fastapi):
//   roots        repo-relative files or directories to scan (default ["."])
//   excludeDirs  directory names skipped during the walk
//   appVar       the FastAPI() variable name (default "app")
// Records: one per full URL path, methods merged across handlers, resource =
// the defining file(s), description = the first handler docstring's first
// line. The adapter knows routes, never data access (decision 0037): a
// route's refs name the code it runs, as `?code:<file>#<function>` — its own
// handler, every function in its own file it uses (called, or passed as a
// callback; followed as far as they go, up to MAX_REACH), and each function
// those call in another scanned file: `<mod>.<fn>(` where `<mod>` is imported
// (`import a.b as mod`, `from a import mod`, relative `from . import mod`), or
// `<fn>(` imported with `from a.mod import fn` — one hop out of the file. A
// name the function binds itself (a parameter, a local) is not the import it
// shadows. A target that resolves to no file or to several is skipped, never
// guessed. A data-access adapter (supabase-py, sqlalchemy, …) mints the
// records those refs reach, and the core folds their tables into the route.
// Every read goes through io (decision 0010): never a symlink, never past the
// size caps, never a gitignored path. Auth is not derived (FastAPI
// dependencies are not statically readable without resolving imports); the
// map says who may call what. A decorator is read line by line: one quoted
// inside a docstring reads as a route — accepted, and visible in the diff. A
// missing root is "nothing to inventory" (greenfield) with a diagnostic,
// never an error.

import { basename } from "node:path";
import { slugify } from "../../core/lib/slug.mjs";
import { repoRelative } from "../../core/lib/paths.mjs";
import { makeExtractorIo } from "../../core/lib/extractor-io.mjs";
import { DEFAULT_EXCLUDE_DIRS, defs, defsByLine, imports, moduleFiles, pythonFiles, resolveModule } from "../python/source.mjs";

// The most same-file functions one handler's walk visits: a bound, so a
// generated file of thousands of chained helpers stays cheap (CR-018).
export const MAX_REACH = 1024;
const HTTP_METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];
const DECORATOR_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace", "api_route"]);

export const FACTS_KEY_ORDER = {
  route: ["methods", "dynamicSegments", "handlers"],
};

// Join a router prefix and a decorator path the way FastAPI does: literal
// concatenation, so `prefix="/jobs"` + `"/"` is `/jobs/` and + `""` is `/jobs`.
// Only doubled slashes are collapsed.
export function joinPath(prefix, path) {
  const joined = `${prefix}${path}`.replace(/\/{2,}/g, "/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

export function pathParams(path) {
  return [...path.matchAll(/\{([^:}]+)(?::[^}]*)?\}/g)].map((m) => m[1]);
}

const strArg = (args, key) => {
  const m = new RegExp(`\\b${key}\\s*=\\s*(['"])([^'"]*)\\1`).exec(args);
  return m ? m[2] : null;
};

// Parse one file into: routers declared here, include_router calls here, and
// handlers (decorators + docstring + body text) here.
export function parseFile(text) {
  const entries = defsByLine(defs(text));
  const routers = new Map(); // var -> prefix
  for (const m of text.matchAll(/^\s*(\w+)\s*=\s*APIRouter\(([^)]*)\)/gm)) {
    routers.set(m[1], strArg(m[2], "prefix") ?? "");
  }
  const includes = [];
  for (const m of text.matchAll(/^\s*(\w+)\.include_router\(\s*([\w.]+)\s*(?:,([^)]*))?\)/gm)) {
    includes.push({ receiver: m[1], target: m[2], prefix: strArg(m[3] ?? "", "prefix") ?? "" });
  }
  const lines = text.split("\n");
  const handlers = [];
  let pending = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dec = /^(\s*)@(\w+)\.(\w+)\(\s*(['"])([^'"]*)\4([^)]*)\)/.exec(line);
    if (dec && DECORATOR_METHODS.has(dec[3])) {
      let methods;
      if (dec[3] === "api_route") {
        const list = /methods\s*=\s*\[([^\]]*)\]/.exec(dec[6]);
        methods = list ? [...list[1].matchAll(/['"](\w+)['"]/g)].map((m) => m[1].toUpperCase()) : [];
      } else methods = [dec[3].toUpperCase()];
      pending.push({ receiver: dec[2], path: dec[5], methods });
      continue;
    }
    const def = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(line);
    if (def) {
      if (pending.length) {
        const entry = entries.get(i + 1);
        handlers.push({ name: def[2], qual: entry?.name ?? def[2], decorators: pending, body: entry?.body ?? "", docstring: entry?.docstring ?? "" });
      }
      pending = [];
      continue;
    }
    // Blank lines, comments and other decorators sit legally between a route
    // decorator and its def (CR-012); anything else is not a handler shape we
    // read (e.g. a decorator with a multi-line argument list).
    const t = line.trim();
    if (t && !t.startsWith("@") && !t.startsWith("#")) pending = [];
  }
  return { routers, includes, handlers };
}

// The code a handler runs, as `?code:` refs (decision 0037): the handler
// itself, every same-file function it uses (as far as they go, up to
// MAX_REACH), and the functions those call in other files that resolve to
// exactly one scanned file. `file` is { rel, imports, entries, externals }:
// entries is name -> the shared helper's def entry, externals a memo of each
// function's own out-of-file targets. `byModule` maps module basenames to
// scanned files.
const CALL_ATTR = /(?<![\w.])([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g;
const CALL_BARE = /(?<![\w.])([A-Za-z_]\w*)\s*\(/g;
const joinModule = (module, member) => (module.endsWith(".") ? `${module}${member}` : `${module}.${member}`);

// One function's own calls out of its file. A name it binds itself (a
// parameter, a local) shadows the import of that name (CR-020).
function externalsOf(entry, file, byModule) {
  const out = new Set();
  const bound = (n) => entry.params.has(n) || entry.locals.has(n);
  for (const m of entry.masked.matchAll(CALL_ATTR)) {
    if (bound(m[1])) continue;
    const imp = file.imports.get(m[1]);
    if (!imp) continue;
    const target = resolveModule(file.rel, imp.member ? joinModule(imp.module, imp.member) : imp.module, byModule);
    if (target) out.add(`?code:${target}#${m[2]}`);
  }
  for (const m of entry.masked.matchAll(CALL_BARE)) {
    const name = m[1];
    if (bound(name) || /\bdef\s*$/.test(entry.masked.slice(Math.max(0, m.index - 8), m.index))) continue;
    const imp = file.imports.get(name);
    if (!imp?.member) continue;
    const target = resolveModule(file.rel, imp.module, byModule);
    if (target) out.add(`?code:${target}#${imp.member}`);
  }
  return out;
}

export function handlerRefs(handler, file, byModule) {
  const refs = new Set();
  const first = handler.qual ?? handler.name; // a nested def's full name (`factory.h`)
  if (!file.entries.has(first)) return new Set([`?code:${file.rel}#${first}`]);
  const externals = file.externals ?? (file.externals = new Map());
  const seen = new Set([first]);
  const queue = [first];
  for (let q = 0; q < queue.length; q++) {
    const name = queue[q];
    const entry = file.entries.get(name);
    refs.add(`?code:${file.rel}#${name}`);
    if (!externals.has(name)) externals.set(name, externalsOf(entry, file, byModule));
    for (const r of externals.get(name)) refs.add(r);
    for (const callee of entry.refers) {
      if (seen.has(callee) || !file.entries.has(callee) || seen.size >= MAX_REACH) continue;
      seen.add(callee);
      queue.push(callee);
    }
  }
  return refs;
}

export function derive({ repoRoot, options, io = makeExtractorIo(repoRoot, "fastapi") }) {
  const diagnostics = [];
  const { roots = ["."], excludeDirs = DEFAULT_EXCLUDE_DIRS, appVar = "app" } = options;
  if (!Array.isArray(roots)) throw new Error(`fastapi: 'roots' must be an array of repo-relative paths`);
  if (!Array.isArray(excludeDirs)) throw new Error(`fastapi: 'excludeDirs' must be an array of directory names`);
  const safeRoots = roots.map((r) => repoRelative(r, "fastapi.roots"));

  const texts = new Map();
  for (const rel of pythonFiles(io, safeRoots, excludeDirs, diagnostics)) {
    const read = io.read(rel);
    if (read.ok) texts.set(rel, read.text);
    else if (read.code !== "missing" && read.code !== "ignored") diagnostics.push(`${rel}: ${read.reason} — skipped`);
  }
  const files = [...texts.keys()];
  const parsed = new Map(files.map((rel) => [rel, parseFile(texts.get(rel))]));
  const callFiles = new Map(files.map((rel) => [rel, { rel, imports: imports(texts.get(rel)), entries: new Map(defs(texts.get(rel)).map((d) => [d.name, d])) }]));
  const callModules = moduleFiles(files);

  // Mount graph: each include is an edge parent -> child router carrying the
  // include prefix. A router's mount prefixes are every path from the app (or
  // from an unmounted root router) down to it, so nested includes compose and
  // repeated includes multiply (CR-010).
  const byModule = new Map(); // "jobs" -> [rel]
  for (const rel of files) {
    const mod = basename(rel, ".py");
    byModule.set(mod, [...(byModule.get(mod) ?? []), rel]);
  }
  const key = (rel, v) => `${rel}#${v}`;
  const edges = new Map(); // child key -> [{ parent: key | null (app), prefix }]
  // Router keys named by an include we could not attribute to one file. A
  // router whose ONLY mention is such an include must not fall through to
  // "unmounted root" — that emitted its routes at the wrong prefix as fact
  // (CR-066). Its handlers are skipped with a diagnostic instead.
  const suppressed = new Set();
  for (const [rel, { routers, includes }] of parsed) {
    for (const inc of includes) {
      const parent = inc.receiver === appVar ? null : routers.has(inc.receiver) ? key(rel, inc.receiver) : undefined;
      if (parent === undefined) continue; // included into an unknown receiver
      const parts = inc.target.split(".");
      const varName = parts.pop();
      let targetRel = rel;
      // The file's own imports say which module `<mod>.router` is: `from
      // app.routes import jobs` names app/routes/jobs.py even when another
      // jobs.py (a repository) shares its basename. Only when the imports do
      // not settle it does the basename rule below run, as it always has.
      const imp = parts.length === 1 ? callFiles.get(rel).imports.get(parts[0]) : undefined;
      const viaImport = imp ? resolveModule(rel, imp.member ? joinModule(imp.module, imp.member) : imp.module, callModules) : null;
      if (imp && !viaImport) {
        // The source names the module; it is not one scanned file. The old
        // basename rule would mount some other <mod>.py: never guess (CR-019).
        diagnostics.push(`${rel}: include_router(${inc.target}) — '${parts[0]}' is imported from '${imp.member ? joinModule(imp.module, imp.member) : imp.module}', which is not one scanned file; mount ignored`);
        for (const c of byModule.get(parts[0]) ?? []) suppressed.add(key(c, varName));
        continue;
      }
      if (viaImport) targetRel = viaImport;
      else if (parts.length) {
        const dotted = parts.join(".");
        let candidates = byModule.get(parts[parts.length - 1]) ?? [];
        // Package-qualified (`a.routes.router`): the dotted path names a file
        // path (`a/routes.py`) — prefer the candidates that end that way.
        if (candidates.length > 1) {
          const suffix = `${parts.join("/")}.py`;
          const qualified = candidates.filter((c) => c === suffix || c.endsWith(`/${suffix}`));
          if (qualified.length) candidates = qualified;
        }
        if (candidates.length === 0) {
          diagnostics.push(`${rel}: include_router(${inc.target}) — module '${dotted}' is not among the scanned files, mount ignored`);
          continue;
        }
        if (candidates.length > 1) {
          diagnostics.push(
            `${rel}: include_router(${inc.target}) — module '${dotted}' is ambiguous (${candidates.join(", ")}); ` +
              `qualify it with its package, else those routers' handlers are skipped rather than rooted at the wrong prefix`,
          );
          for (const c of candidates) suppressed.add(key(c, varName));
          continue;
        }
        targetRel = candidates[0];
      }
      const child = key(targetRel, varName);
      edges.set(child, [...(edges.get(child) ?? []), { parent, prefix: inc.prefix }]);
    }
  }
  const routerPrefix = (k) => {
    const [rel, v] = k.split("#");
    return parsed.get(rel)?.routers.get(v) ?? "";
  };
  // All mount prefixes for a router key (the part before its own prefix).
  const mounts = (k, stack = new Set()) => {
    const incoming = edges.get(k);
    if (!incoming || stack.has(k)) return [""]; // unmounted root, or a cycle
    stack.add(k);
    const out = [];
    for (const { parent, prefix } of incoming) {
      const above = parent === null ? [""] : mounts(parent, stack).map((m) => `${m}${routerPrefix(parent)}`);
      for (const a of above) out.push(`${a}${prefix}`);
    }
    stack.delete(k);
    return out;
  };

  // A handler's refs, computed once however many decorators and mounts it has.
  const handlerMemo = new Map();
  const handlerRefsOf = (rel, h) => {
    const k = `${rel}#${h.name}`;
    if (!handlerMemo.has(k)) handlerMemo.set(k, handlerRefs(h, callFiles.get(rel), callModules));
    return handlerMemo.get(k);
  };
  const routes = new Map(); // full path -> { methods:Set, resource:Set, descriptions:[], handlers:Set, refs:Set }
  for (const [rel, { routers, handlers }] of parsed) {
    for (const h of handlers) {
      for (const d of h.decorators) {
        let prefixes;
        if (d.receiver === appVar) prefixes = [""];
        else if (routers.has(d.receiver)) {
          const k = key(rel, d.receiver);
          if (suppressed.has(k) && !edges.has(k)) {
            diagnostics.push(`${rel}: @${d.receiver}.* on ${h.name} — this router's only include_router is ambiguous, skipped (its mount prefix is unknown)`);
            continue;
          }
          prefixes = mounts(k).map((m) => `${m}${routers.get(d.receiver)}`);
        } else {
          diagnostics.push(`${rel}: @${d.receiver}.* on ${h.name} — receiver is neither '${appVar}' nor a router declared in this file, skipped`);
          continue;
        }
        for (const prefix of prefixes) {
          const full = joinPath(prefix, d.path);
          const entry = routes.get(full) ?? { methods: new Set(), resource: new Set(), descriptions: [], handlers: new Set(), refs: new Set() };
          d.methods.forEach((m) => entry.methods.add(m));
          entry.resource.add(rel);
          if (h.docstring) entry.descriptions.push(h.docstring);
          entry.handlers.add(h.name);
          handlerRefsOf(rel, h).forEach((r) => entry.refs.add(r));
          routes.set(full, entry);
        }
      }
    }
  }

  const records = [];
  for (const full of [...routes.keys()].sort()) {
    const e = routes.get(full);
    records.push({
      kind: "route",
      id: `route:${full}`,
      title: full,
      description: e.descriptions[0] ?? "",
      resource: [...e.resource].sort(),
      refs: [...e.refs],
      facts: {
        methods: HTTP_METHOD_ORDER.filter((m) => e.methods.has(m)),
        dynamicSegments: pathParams(full),
        handlers: [...e.handlers].sort(),
      },
      filename: `${slugify(full)}.json`,
    });
  }
  return { records, diagnostics };
}

export { DETECTION, detect } from "./detect.mjs";
