// supabase-py adapter — data access through the Supabase Python client
// (decision 0037). One convention: `.table("x")` and `.from_("x")` (a table,
// else a bucket) and `.rpc("x")` (a database function) inside a Python
// function. One `data-access` record per function that makes such a call,
// keyed by file + function name (adapters/python/source.mjs cuts the
// functions, so a route adapter's `?code:<file>#<name>` names the same
// text), with the calls as UNRESOLVED refs (`?from:x`, `?function:x`) for
// the deriver to resolve against the schema adapter's records. A route
// whose handler makes the call reaches the record through `?code:`, and the
// core folds it into the route (inline data access) or keeps it as its own
// node (a repository function in another file).
// Options (extractorOptions["supabase-py"]):
//   roots        repo-relative files or directories to scan (default ["."])
//   excludeDirs  directory names skipped during the walk
// A missing root is "nothing to inventory" with a diagnostic, never an error.
// The calls are matched on the source as written, as the fastapi adapter
// matched them in a handler body before this adapter existed: a call spelled
// inside a docstring is read as a call (accepted, and visible in the diff).

import { repoRelative } from "../../core/lib/paths.mjs";
import { MAX_CLOSED } from "../../core/lib/data-access.mjs";
import { DEFAULT_EXCLUDE_DIRS, closeOver, dataAccessRecord, defs, pythonFiles } from "../python/source.mjs";

export const FACTS_KEY_ORDER = {
  "data-access": ["function"],
};

export function scanCalls(body) {
  const refs = new Set();
  for (const m of body.matchAll(/\.(?:table|from_)\(\s*(['"])([\w-]+)\1\s*\)/g)) refs.add(`?from:${m[2]}`);
  for (const m of body.matchAll(/\.rpc\(\s*(['"])(\w+)\1/g)) refs.add(`?function:${m[2]}`);
  return refs;
}

export function derive({ options, io }) {
  const diagnostics = [];
  const warnings = [];
  const { roots = ["."], excludeDirs = DEFAULT_EXCLUDE_DIRS } = options;
  if (!Array.isArray(roots)) throw new Error(`supabase-py: 'roots' must be an array of repo-relative paths`);
  if (!Array.isArray(excludeDirs)) throw new Error(`supabase-py: 'excludeDirs' must be an array of directory names`);
  const files = pythonFiles(io, roots.map((r) => repoRelative(r, "supabase-py.roots")), excludeDirs, diagnostics, warnings);
  const records = [];
  let overBudget = false;
  for (const rel of files) {
    const read = io.read(rel);
    if (!read.ok) {
      if (read.code === "over-budget") {
        // The total read budget ran out: the rest of the files are unread (CR-057).
        if (!overBudget) warnings.push(`${rel}: the read budget ran out — this file and those after it were not read, so their data access is missing; narrow this adapter's roots`);
        overBudget = true;
        continue;
      }
      if (read.code !== "missing" && read.code !== "ignored") diagnostics.push(`${rel}: ${read.reason} — skipped`);
      continue;
    }
    // A function's calls are its own and those of every same-file function it
    // uses (a helper it calls, or passes as a callback): the same rule the
    // route side follows, so a handler's own record carries its helpers'.
    const fns = defs(read.text);
    // Past the closure's bound (a pathological file), each function keeps
    // its own calls only, and derive says so on every run (CR-050).
    const closedOrOwn = (closed, list, own) => {
      if (closed) return closed;
      warnings.push(`${rel}: too many same-file calls to follow (over ${MAX_CLOSED} function-to-table links) — each function's own data access is kept, its helpers' are not`);
      return new Map(list.map((e) => [e.name, own(e)]));
    };
    const closed = closedOrOwn(closeOver(fns, (fn) => scanCalls(fn.body)), fns, (fn) => scanCalls(fn.body));
    for (const fn of fns) {
      const refs = closed.get(fn.name);
      if (!refs.size) continue;
      records.push(dataAccessRecord("supabase-py", rel, fn, refs));
    }
  }
  return { records, diagnostics, warnings };
}

export { DETECTION, detect } from "./detect.mjs";

// The adapter contract this adapter was written for, and how to comment
// out a line of each kind of file it reads: what the standard suite needs
// (decision 0040). `{}`: nothing it reads takes a line comment.
export const CONTRACT = 1;
export const COMMENT = { ".py": "#" };
