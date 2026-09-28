// The `io` an extractor is handed: derive({ repoRoot, options, io }) (CAS-65,
// decision 0010). A local extractor lives in the adopter's repo and runs under
// `npx`, so it cannot import the engine's helpers; the engine passes them in.
// Two operations, both repo-relative and both refusing to leave the repo
// physically — the rules the built-ins learned the hard way (CAS-63 CR-001,
// CR-013, CR-026):
//
//   io.read(rel, { maxBytes })
//     -> { ok: true, text }                     a regular file inside the repo
//     -> { ok: false, code, reason }            code:
//          "missing"      nothing at the path — nothing to inventory
//          "not-regular"  a symlink, a directory, or under a link
//          "too-large"    over the per-file cap (1 MiB; maxBytes may lower it)
//          "over-budget"  this io has already read its total (64 MiB)
//          "unreadable"   present, but the read failed (permissions, I/O)
//        Only "missing" means absence; every other refusal is worth a
//        diagnostic, and an extractor must never treat one as greenfield.
//
//   io.walk(relDir, onFile, { enter })
//     -> { exists, truncated, skipped }
//        Calls onFile(rel, name) for every regular file under relDir, with rel
//        a repo-relative POSIX path, in ONE global order: the full paths
//        sorted by code unit (so `001.sql` comes before `001/x.sql`, as a
//        replay of numbered files expects). Symlinks are never followed
//        (listed in `skipped`); `enter(rel, name)` may veto a directory (the
//        default vetoes only `.git`). Depth is capped, directory listings are
//        read entry by entry against the budget (a huge directory is never
//        listed whole), and every walk on one io shares ONE entry budget.
//        `truncated` says the budget or the depth ran out.
//
// A path that is not repo-relative (absolute, `..`, ':', backslash, a control
// character) is an extractor bug, not a source condition: it throws, and
// derive names the extractor. Spaces are fine — `My Controller.cs` is source.
// Every path walk() hands out is one read() accepts: a name read() would
// refuse (a ':', backslash or control character — possible on POSIX) is
// skipped.
//
// Race: a read checks the path (no link on any segment, a regular file),
// then opens it without following a final link and compares the opened
// file's identity (dev + inode) with what it checked — a path swapped for a
// link between the two is refused, never read.

import { lstatSync, opendirSync, readSync, openSync, fstatSync, closeSync, realpathSync, constants } from "node:fs";
import { join } from "node:path";
import { regularFileInside } from "./walk-markdown.mjs";

export const IO_MAX_READ_BYTES = 1024 * 1024;
export const IO_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const IO_MAX_DEPTH = 32;
export const IO_MAX_ENTRIES = 50_000;
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0; // absent on Windows; the identity check still holds

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

// Every existing segment from root down to rel is a real directory — no
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

// The third argument (lower limits) exists for the tests; derive never
// passes it.
export function makeExtractorIo(repoRoot, label = "extractor", { maxEntries = IO_MAX_ENTRIES, maxDepth = IO_MAX_DEPTH, maxTotalBytes = IO_MAX_TOTAL_BYTES } = {}) {
  let realRoot = null;
  try {
    // .native: the Windows runner's RUNNER~1 short name must not survive
    // into a prefix comparison.
    realRoot = realpathSync.native(repoRoot);
  } catch {
    /* unreadable root: every read is missing, every walk is empty */
  }
  const state = { entries: 0, bytes: 0 };

  function read(rel, { maxBytes } = {}) {
    const clean = ioRelative(rel, `${label}: io.read path`);
    const cap = Math.min(Number.isFinite(maxBytes) && maxBytes >= 0 ? maxBytes : IO_MAX_READ_BYTES, IO_MAX_READ_BYTES);
    const refuse = (code, reason) => ({ ok: false, code, reason: `${clean} ${reason}` });
    if (!realRoot) return refuse("missing", "is missing");
    const abs = join(realRoot, clean);
    let st;
    try {
      st = lstatSync(abs);
    } catch (e) {
      return e.code === "ENOENT" || e.code === "ENOTDIR" ? refuse("missing", "is missing") : refuse("unreadable", `could not be examined (${e.code}) — not read`);
    }
    if (!regularFileInside(realRoot, abs)) return refuse("not-regular", "is not a regular file inside the repo (a symlink, a directory, or under a linked directory) — not read");
    if (st.size > cap) return refuse("too-large", `is over ${cap} bytes — not read`);
    if (state.bytes + st.size > maxTotalBytes) return refuse("over-budget", `would pass this extractor's total read budget of ${maxTotalBytes} bytes — not read`);
    let fd;
    try {
      fd = openSync(abs, constants.O_RDONLY | O_NOFOLLOW);
    } catch (e) {
      if (e.code === "ELOOP") return refuse("not-regular", "became a symlink while being read — not read");
      return e.code === "ENOENT" ? refuse("missing", "is missing") : refuse("unreadable", `could not be opened (${e.code}) — not read`);
    }
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.dev !== st.dev || opened.ino !== st.ino) return refuse("not-regular", "changed while being read — not read");
      if (opened.size > cap) return refuse("too-large", `is over ${cap} bytes — not read`);
      const buf = Buffer.alloc(cap + 1);
      let n = 0;
      for (let got; n <= cap && (got = readSync(fd, buf, n, cap + 1 - n, null)) > 0; ) n += got;
      if (n > cap) return refuse("too-large", `is over ${cap} bytes — not read`);
      state.bytes += n;
      return { ok: true, text: buf.subarray(0, n).toString("utf8") };
    } catch (e) {
      return refuse("unreadable", `could not be read (${e.code ?? e.message}) — not read`);
    } finally {
      closeSync(fd);
    }
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
    const files = [];
    // One directory's names, read entry by entry — each charged to the
    // budget as it is read, so a directory holding millions of entries is
    // never listed whole. A directory the budget runs out inside yields
    // NOTHING: which of its names were read first is the filesystem's order,
    // and output must not depend on it.
    const list = (abs, rel) => {
      const names = [];
      let dir;
      try {
        dir = opendirSync(abs);
      } catch {
        result.skipped.push({ path: rel, reason: "unreadable" });
        return names;
      }
      try {
        for (let d; (d = dir.readSync()) !== null; ) {
          if (++state.entries > maxEntries) {
            result.truncated = true;
            return [];
          }
          names.push(d.name);
        }
      } finally {
        dir.closeSync();
      }
      return names.sort();
    };
    const visit = (abs, rel, depth) => {
      if (depth > maxDepth) {
        result.truncated = true;
        return;
      }
      for (const name of list(abs, rel)) {
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
        } else if (st.isFile()) files.push([childRel, name]);
      }
    };
    visit(start.abs, clean, 0);
    // One global order over full paths: a directory's files are not all
    // handed out before a sibling file that sorts first.
    files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    result.skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const [rel, name] of files) onFile(rel, name);
    return result;
  }

  return Object.freeze({ read, walk });
}
