// What git ignores is never source (CAS-103 pick 1). A gitignored folder is
// build output, a dependency, a secret, or another checkout of the same
// repo — the `.claude/worktrees/` folder the Claude desktop app creates holds
// a full copy of the source, and a default-rooted scan read it into DiO's
// and Cascade's service records (local `derive --check` green, CI red,
// because CI has no worktrees). So every walk and every read vetoes the
// ignored set, asked of git once per derive:
//
//   git ls-files --others --ignored --directory -z --exclude-per-directory=.gitignore
//
// Only the REPOSITORY'S OWN ignore rules are consulted — the `.gitignore`
// files, which every clone shares. Neither the user's global excludes file
// nor `.git/info/exclude` is read: both are machine state, and a rule on one
// machine must not change what derive sees of the same bytes on another
// (slice 1 review CR-308, slice 2 review CR-406). The one machine-local
// folder that matters, `.claude/worktrees/` (the desktop app writes its rule
// into info/exclude), is vetoed by name, everywhere. Determinism holds: an
// ignored path is by definition absent from every clean clone, so the
// artifacts a dirty checkout derives equal the ones CI derives.
//
// Where the root is no repository (no `.git`), the predicate knows only
// ALWAYS_IGNORED. Where it IS a repository and git cannot answer — no git on
// the PATH, a corrupt index, a timeout, an overflowed buffer — the predicate
// carries `.error` and derive STOPS: reading on would take ignored, possibly
// secret-bearing files as source while CI stays green, the very thing this
// exists to prevent (slice 2 review CR-403, fail closed).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

export const ALWAYS_IGNORED = [".claude/worktrees"];

// Returns a predicate `isIgnored(rel)` over repo-relative POSIX paths (a
// directory or a file), with `.source` naming where the set came from
// ("git" or "none") and `.error` the reason git could not answer, if any.
export function gitIgnoredPredicate(repoRoot) {
  const dirs = new Set();
  const files = new Set();
  let source = "none";
  let error = null;
  // Repo-shaped: a `.git` at the root or at any ancestor (a package inside a
  // monorepo is still inside its repository; git answers relative to cwd).
  let repoShaped = false;
  for (let dir = repoRoot; ; ) {
    if (existsSync(join(dir, ".git"))) {
      repoShaped = true;
      break;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (repoShaped) {
    try {
      const out = execFileSync("git", ["ls-files", "--others", "--ignored", "--directory", "-z", "--exclude-per-directory=.gitignore"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      source = "git";
      for (const entry of out.split("\0")) {
        if (!entry) continue;
        if (entry.endsWith("/")) dirs.add(entry.slice(0, -1));
        else files.add(entry);
      }
    } catch (e) {
      const stderr = String(e?.stderr ?? "").trim().split(/\r?\n/)[0];
      const why = e?.code === "ENOENT" ? "git is not on the PATH" : e?.code === "ETIMEDOUT" || e?.signal ? "git ls-files timed out" : stderr || e?.code || "git ls-files failed";
      error = `this folder is a git repository but its ignored paths could not be listed (${why}) — derive stops rather than read gitignored files as source; fix git (or the repository) and run again`;
    }
  }
  // Lookup proportional to the path's depth, never to the size of the
  // ignored set (CR-310): each ancestor is tested in a set.
  const isIgnored = (rel) => {
    const clean = rel.replace(/^\.\//, "").replace(/\/$/, "");
    if (!clean || clean === ".") return false;
    if (files.has(clean)) return true;
    const segs = clean.split("/");
    let prefix = "";
    for (let i = 0; i < segs.length; i++) {
      prefix = i ? `${prefix}/${segs[i]}` : segs[i];
      // The built-in veto folds case (CR-525): `.CLAUDE/worktrees` reaches
      // the same folder on a case-insensitive disk and is nothing on others.
      if (dirs.has(prefix) || ALWAYS_IGNORED.includes(prefix.toLowerCase())) return true;
    }
    return false;
  };
  isIgnored.source = source;
  isIgnored.error = error;
  return isIgnored;
}
