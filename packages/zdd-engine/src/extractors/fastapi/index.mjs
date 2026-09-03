// fastapi extractor — routes from decorated handlers in a FastAPI codebase.
// One convention: `@app.<method>("/path")` and `@router.<method>("/path")`
// decorators, with `router = APIRouter(prefix="...")` and same-file
// `app.include_router(mod.router, prefix="...")` prefixes applied. Purely
// textual — no Python parsing, no import resolution beyond "which file in the
// scanned roots is called <mod>.py". Options (extractorOptions.fastapi):
//   roots        repo-relative files or directories to scan (default ["."])
//   excludeDirs  directory names skipped during the walk
//   appVar       the FastAPI() variable name (default "app")
// Records: one per full URL path, methods merged across handlers, resource =
// the defining file(s), description = the first handler docstring's first
// line. Outbound refs found inside a handler's body — `.table("x")` /
// `.from_("x")` / `.rpc("x")` — are emitted UNRESOLVED (`?from:x`,
// `?function:x`) for the deriver to resolve against the supabase extractor's
// records after the merge. Auth is not derived (FastAPI dependencies are not
// statically readable without resolving imports); the map says who may call
// what. A missing root is "nothing to inventory" (greenfield), never an error.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { slugify } from "../../lib/slug.mjs";

const posixify = (p) => p.split(/[\\/]/).join("/");
const HTTP_METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const DECORATOR_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "api_route"]);

export const FACTS_KEY_ORDER = {
  route: ["methods", "dynamicSegments", "handlers"],
};

function walkPython(repoRoot, roots, excludeDirs) {
  const out = [];
  const visit = (abs) => {
    if (!existsSync(abs)) return;
    if (statSync(abs).isFile()) {
      if (abs.endsWith(".py")) out.push(posixify(abs.slice(repoRoot.length + 1)));
      return;
    }
    for (const name of readdirSync(abs).sort()) {
      const p = join(abs, name);
      if (statSync(p).isDirectory()) {
        if (!excludeDirs.includes(name)) visit(p);
      } else if (name.endsWith(".py")) out.push(posixify(p.slice(repoRoot.length + 1)));
    }
  };
  for (const root of roots) visit(join(repoRoot, root));
  return [...new Set(out)].sort();
}

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
        const indent = def[1].length;
        let end = i + 1;
        while (end < lines.length && (lines[end].trim() === "" || lines[end].search(/\S/) > indent)) end++;
        const body = lines.slice(i + 1, end).join("\n");
        const doc = /^\s*(?:r?"""|r?''')\s*([^\n"']*)/.exec(body);
        handlers.push({ name: def[2], decorators: pending, body, docstring: doc ? doc[1].trim() : "" });
      }
      pending = [];
      continue;
    }
    // Any other non-decorator line between a decorator and its def is not a
    // handler shape we read (e.g. a decorator with a multi-line argument list).
    if (line.trim() && !line.trim().startsWith("@")) pending = [];
  }
  return { routers, includes, handlers };
}

export function scanHandlerRefs(body) {
  const refs = new Set();
  for (const m of body.matchAll(/\.(?:table|from_)\(\s*(['"])([\w-]+)\1\s*\)/g)) refs.add(`?from:${m[2]}`);
  for (const m of body.matchAll(/\.rpc\(\s*(['"])(\w+)\1/g)) refs.add(`?function:${m[2]}`);
  return refs;
}

export function derive({ repoRoot, options }) {
  const diagnostics = [];
  const {
    roots = ["."],
    excludeDirs = ["node_modules", ".venv", "venv", "__pycache__", ".git", "tests", "test"],
    appVar = "app",
  } = options;

  const files = walkPython(repoRoot, roots, excludeDirs);
  const parsed = new Map(files.map((rel) => [rel, parseFile(readFileSync(join(repoRoot, rel), "utf8"))]));

  // Router prefixes: the router's own prefix, plus whatever include_router
  // adds when the included router can be located by module basename.
  const byModule = new Map(); // "jobs" -> [rel]
  for (const rel of files) {
    const mod = basename(rel, ".py");
    byModule.set(mod, [...(byModule.get(mod) ?? []), rel]);
  }
  const includePrefix = new Map(); // `${rel}#${var}` -> prefix added by include
  for (const [rel, { routers, includes }] of parsed) {
    for (const inc of includes) {
      const receiverPrefix = inc.receiver === appVar ? "" : routers.get(inc.receiver);
      if (receiverPrefix === undefined) continue; // included into an unknown receiver
      const parts = inc.target.split(".");
      const varName = parts.pop();
      const mod = parts.pop();
      let targetRel = rel;
      if (mod) {
        const candidates = byModule.get(mod) ?? [];
        if (candidates.length !== 1) {
          diagnostics.push(`[fastapi] ${rel}: include_router(${inc.target}) — module '${mod}' resolves to ${candidates.length} files, prefix not applied`);
          continue;
        }
        targetRel = candidates[0];
      }
      includePrefix.set(`${targetRel}#${varName}`, `${receiverPrefix}${inc.prefix}`);
    }
  }

  const routes = new Map(); // full path -> { methods:Set, resource:Set, descriptions:[], handlers:Set, refs:Set }
  for (const [rel, { routers, handlers }] of parsed) {
    for (const h of handlers) {
      for (const d of h.decorators) {
        let prefix;
        if (d.receiver === appVar) prefix = "";
        else if (routers.has(d.receiver)) prefix = `${includePrefix.get(`${rel}#${d.receiver}`) ?? ""}${routers.get(d.receiver)}`;
        else {
          diagnostics.push(`[fastapi] ${rel}: @${d.receiver}.* on ${h.name} — receiver is neither '${appVar}' nor a router declared in this file, skipped`);
          continue;
        }
        const full = joinPath(prefix, d.path);
        const entry = routes.get(full) ?? { methods: new Set(), resource: new Set(), descriptions: [], handlers: new Set(), refs: new Set() };
        d.methods.forEach((m) => entry.methods.add(m));
        entry.resource.add(rel);
        if (h.docstring) entry.descriptions.push(h.docstring);
        entry.handlers.add(h.name);
        scanHandlerRefs(h.body).forEach((r) => entry.refs.add(r));
        routes.set(full, entry);
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
