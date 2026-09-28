// The `io` an extractor is handed: derive({ repoRoot, options, io }) (CAS-65,
// decision 0010). A local extractor lives in the adopter's repo and runs under
// `npx`, so it cannot import the engine's helpers; the engine passes them in.
// Two operations, both repo-relative and both refusing to leave the repo
// physically — the rules the built-ins learned the hard way (CAS-63 CR-001,
// CR-013, CR-026):
//
//   io.read(rel, { maxBytes })
//     -> { ok: true, text }                     a regular file inside the repo
//     -> { ok: false, code, reason }            code: "missing" | "not-regular" | "too-large"
//        "missing" is nothing to inventory; the other two are worth a diagnostic.
//        maxBytes may lower the cap (default 1 MiB), never raise it.
//
//   io.walk(relDir, onFile, { enter })
//     -> { exists, truncated, skipped }
//        Calls onFile(rel, name) for every regular file under relDir, in sorted
//        order, with rel a repo-relative POSIX path. Symlinks are never
//        followed (listed in `skipped`); `enter(rel, name)` may veto a
//        directory (the default vetoes only `.git`). Depth is capped, and every walk on one io shares ONE entry
//        budget, so a hostile tree cannot enumerate the run to death by being
//        walked from several roots. `truncated` says the budget or the depth
//        ran out.
//
// A path that is not repo-relative (absolute, `..`, ':', backslash, a control
// character) is an extractor bug, not a source condition: it throws, and
// derive names the extractor. Spaces are fine — `My Controller.cs` is source.
// Every path walk() hands out is one read() accepts: a name read() would
// refuse (a ':', backslash or control character — possible on POSIX) is
// skipped.

import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { regularFileInside } from "./walk-markdown.mjs";

export const IO_MAX_READ_BYTES = 1024 * 1024;
export const IO_MAX_DEPTH = 32;
export const IO_MAX_ENTRIES = 50_000;

// Config paths go through paths.mjs's repoRelative, which also refuses
// whitespace (a config path can become a URL); a source path is never a URL
// and may hold spaces, so io keeps its own rule. A ':' is refused in any
// segment: a drive letter, or an NTFS alternate data stream (`a.cs:hidden`).
function ioRelative(value, what) {
  const bad = () => {
    throw new Error(`${what} '${value}' must be repo-relative POSIX (no absolute path, drive letter, ':', backslash, control character or '..')`);
  };
  if (typeof value !== "string" || !value.length) bad();
  if (!okName(value) || value.startsWith("/")) bad();
  const segs = value.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) bad();
  return segs.length ? segs.join("/") : ".";
}
const okName = (s) => !/[\\:\x00-\x1f\x7f]/.test(s);

// Every existing segment from root down to abs is a real directory — no
// symlink anywhere on the way. The directory twin of regularFileInside.
function directoryInside(root, rel) {
  let cur = root;
  for (const seg of rel === "." ? [] : rel.split("/")) {
    cur = join(cur, seg);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      return { ok: false, missing: true };
    }
    if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false, missing: false };
  }
  return { ok: true, abs: cur };
}

// The third argument (lower walk limits) exists for the tests; derive never
// passes it.
export function makeExtractorIo(repoRoot, label = "extractor", { maxEntries = IO_MAX_ENTRIES, maxDepth = IO_MAX_DEPTH } = {}) {
  let realRoot = null;
  try {
    // .native: the Windows runner's RUNNER~1 short name must not survive
    // into a prefix comparison.
    realRoot = realpathSync.native(repoRoot);
  } catch {
    /* unreadable root: every read is missing, every walk is empty */
  }
  const state = { entries: 0 };

  function read(rel, { maxBytes } = {}) {
    const clean = ioRelative(rel, `${label}: io.read path`);
    const cap = Math.min(Number.isFinite(maxBytes) && maxBytes >= 0 ? maxBytes : IO_MAX_READ_BYTES, IO_MAX_READ_BYTES);
    if (!realRoot) return { ok: false, code: "missing", reason: `${clean} is missing` };
    const abs = join(realRoot, clean);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      return { ok: false, code: "missing", reason: `${clean} is missing` };
    }
    if (!regularFileInside(realRoot, abs)) {
      return { ok: false, code: "not-regular", reason: `${clean} is not a regular file inside the repo (a symlink, a directory, or under a linked directory) — not read` };
    }
    if (st.size > cap) return { ok: false, code: "too-large", reason: `${clean} is over ${cap} bytes — not read` };
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      return { ok: false, code: "missing", reason: `${clean} is missing` };
    }
    // The file may have grown between lstat and read.
    if (Buffer.byteLength(text, "utf8") > cap) return { ok: false, code: "too-large", reason: `${clean} is over ${cap} bytes — not read` };
    return { ok: true, text };
  }

  function walk(relDir, onFile, { enter = (_rel, name) => name !== ".git" } = {}) {
    const clean = ioRelative(relDir, `${label}: io.walk directory`);
    const result = { exists: false, truncated: false, skipped: [] };
    if (!realRoot) return result;
    const start = directoryInside(realRoot, clean);
    if (!start.ok) {
      if (!start.missing) result.skipped.push({ path: clean, reason: "not a real directory inside the repo (a symlink, a file, or under a linked directory)" });
      return result;
    }
    result.exists = true;
    const visit = (abs, rel, depth) => {
      if (depth > maxDepth) {
        result.truncated = true;
        return;
      }
      let names;
      try {
        names = readdirSync(abs).sort();
      } catch {
        result.skipped.push({ path: rel, reason: "unreadable" });
        return;
      }
      for (const name of names) {
        if (++state.entries > maxEntries) {
          result.truncated = true;
          return;
        }
        const childRel = rel === "." ? name : `${rel}/${name}`;
        if (!okName(name)) {
          result.skipped.push({ path: childRel, reason: "name holds a ':', backslash or control character — not walked" });
          continue;
        }
        const childAbs = join(abs, name);
        let st;
        try {
          st = lstatSync(childAbs);
        } catch {
          result.skipped.push({ path: childRel, reason: "unreadable" });
          continue;
        }
        if (st.isSymbolicLink()) result.skipped.push({ path: childRel, reason: "symlink — not followed" });
        else if (st.isDirectory()) {
          if (enter(childRel, name)) visit(childAbs, childRel, depth + 1);
          if (state.entries > maxEntries) return;
        } else if (st.isFile()) onFile(childRel, name);
      }
    };
    visit(start.abs, clean, 0);
    return result;
  }

  return Object.freeze({ read, walk });
}
