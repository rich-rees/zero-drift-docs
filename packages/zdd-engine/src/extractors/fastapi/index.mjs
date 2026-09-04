// fastapi extractor — routes from decorated handlers in a FastAPI codebase.
// One convention: `@app.<method>("/path")` and `@router.<method>("/path")`
// decorators, with `router = APIRouter(prefix="...")` and
// `<receiver>.include_router(<mod>.router, prefix="...")` mounts applied —
// transitively (app -> api router -> jobs router) and for every mount (one
// router included under both /v1 and /v2 yields both route sets). Purely
// textual — no Python parsing, no import resolution beyond "which scanned
// file is called <mod>.py" (a package-qualified `a.routes.router` prefers
// `a/routes.py`; a target that is still ambiguous mounts nothing and its
// routers' handlers are skipped rather than emitted at a guessed prefix).
// Options (extractorOptions.fastapi):
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
// what. Line-oriented: a decorator quoted inside a docstring reads as a route
// — accepted, and visible in the diff. A missing root is "nothing to
// inventory" (greenfield) with a diagnostic, never an error.

import { readFileSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { slugify } from "../../lib/slug.mjs";
import { repoRelative } from "../../lib/paths.mjs";
import { walkDir } from "../../lib/walk.mjs";

const posixify = (p) => p.split(/[\\/]/).join("/");
const HTTP_METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];
const DECORATOR_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace", "api_route"]);

export const FACTS_KEY_ORDER = {
  route: ["methods", "dynamicSegments", "handlers"],
};

function walkPython(repoRoot, roots, excludeDirs, diagnostics) {
  const out = [];
  const seen = new Set();
  for (const root of roots) {
    const abs = join(repoRoot, root);
    if (!existsSync(abs)) {
      diagnostics.push(`${root} not found — nothing to inventory`);
      continue;
    }
    if (statSync(abs).isFile()) {
      if (abs.endsWith(".py")) out.push(posixify(abs.slice(repoRoot.length + 1)));
      continue;
    }
    walkDir(
      abs,
      (p, name) => {
        if (name.endsWith(".py")) out.push(posixify(p.slice(repoRoot.length + 1)));
      },
      seen,
      (_p, name) => !excludeDirs.includes(name),
      (p, reason) => diagnostics.push(`${posixify(p.slice(repoRoot.length + 1))}: ${reason} — skipped`),
    );
  }
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
    // Blank lines, comments and other decorators sit legally between a route
    // decorator and its def (CR-012); anything else is not a handler shape we
    // read (e.g. a decorator with a multi-line argument list).
    const t = line.trim();
    if (t && !t.startsWith("@") && !t.startsWith("#")) pending = [];
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
  if (!Array.isArray(roots)) throw new Error(`fastapi: 'roots' must be an array of repo-relative paths`);
  if (!Array.isArray(excludeDirs)) throw new Error(`fastapi: 'excludeDirs' must be an array of directory names`);
  const safeRoots = roots.map((r) => repoRelative(r, "fastapi.roots"));

  const files = walkPython(repoRoot, safeRoots, excludeDirs, diagnostics);
  const parsed = new Map(files.map((rel) => [rel, parseFile(readFileSync(join(repoRoot, rel), "utf8"))]));

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
      if (parts.length) {
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
          scanHandlerRefs(h.body).forEach((r) => entry.refs.add(r));
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
