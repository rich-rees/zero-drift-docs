// What git ignores is never source (CAS-103 pick 1). A gitignored folder is
// build output, a dependency, a secret, or another checkout of the same
// repo — the `.claude/worktrees/` folder the Claude desktop app creates holds
// a full copy of the source, and a default-rooted scan read it into DiO's
// and Cascade's service records (local `derive --check` green, CI red,
// because CI has no worktrees). So every walk and every read vetoes the
// ignored set, asked of git once per derive:
//
//   git ls-files --others --ignored --directory -z
//       --exclude-per-directory=.gitignore [--exclude-from=.git/info/exclude]
//
// Only the REPOSITORY'S OWN ignore sources are consulted — `.gitignore`
// files and `.git/info/exclude` (where the desktop app writes the worktree
// rule) — never the user's global excludes file (`--exclude-standard` would
// read it): a personal rule on one machine must not change what derive
// sees of the same bytes on another (slice 1 review CR-308). Determinism
// holds: an ignored path is by definition absent from every clean clone, so
// the artifacts a dirty checkout derives now equal the ones CI derives.
//
// Where the root is no repository, or git is absent, the predicate knows
// only ALWAYS_IGNORED — the worktree folder, vetoed by name because it is
// never source anywhere. Any OTHER failure (a timeout, an overflowed
// buffer, a git that errors) is reported through `.error`, and derive prints
// it as a warning: silently losing the veto would restore the very
// nondeterminism this exists to remove (CR-309).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const ALWAYS_IGNORED = [".claude/worktrees"];

// Returns a predicate `isIgnored(rel)` over repo-relative POSIX paths (a
// directory or a file), with `.source` naming where the set came from
// ("git" or "none") and `.error` the reason git could not answer, if any.
export function gitIgnoredPredicate(repoRoot) {
  const dirs = new Set();
  const files = new Set();
  let source = "none";
  let error = null;
  const args = ["ls-files", "--others", "--ignored", "--directory", "-z", "--exclude-per-directory=.gitignore"];
  if (existsSync(join(repoRoot, ".git", "info", "exclude"))) args.push("--exclude-from=.git/info/exclude");
  try {
    const out = execFileSync("git", args, {
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
    const stderr = String(e?.stderr ?? "");
    const notARepo = e?.code === "ENOENT" || /not a git repository/i.test(stderr);
    if (!notARepo) error = `git ls-files could not list the ignored paths (${e?.code === "ETIMEDOUT" || e?.signal ? "timed out" : stderr.trim().split(/\r?\n/)[0] || e?.code || "failed"}) — only .claude/worktrees is vetoed in this run; a gitignored file may be read as source`;
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
      if (dirs.has(prefix) || ALWAYS_IGNORED.includes(prefix)) return true;
    }
    return false;
  };
  isIgnored.source = source;
  isIgnored.error = error;
  return isIgnored;
}
