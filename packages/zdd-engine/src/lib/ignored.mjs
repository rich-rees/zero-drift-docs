// What git ignores is never source (CAS-103 pick 1). A gitignored folder is
// build output, a dependency, a secret, or another checkout of the same
// repo — the `.claude/worktrees/` folder the Claude desktop app creates holds
// a full copy of the source, and a default-rooted scan read it into DiO's
// and Cascade's service records (local `derive --check` green, CI red,
// because CI has no worktrees). So every walk vetoes the ignored set, asked
// of git once per derive:
//
//   git ls-files --others --ignored --exclude-standard --directory -z
//
// which honours `.gitignore`, `.git/info/exclude` (where the desktop app
// writes the worktree rule) and the user's global excludes, and collapses
// an ignored directory to one entry. Determinism holds: an ignored path is
// by definition absent from every clean clone, so the artifacts a dirty
// checkout derives now equal the ones CI derives. Where git is absent, or
// the root is no repository, the predicate knows only ALWAYS_IGNORED — the
// worktree folder, vetoed by name because it is never source anywhere.
import { execFileSync } from "node:child_process";

export const ALWAYS_IGNORED = [".claude/worktrees"];

const under = (rel, dir) => rel === dir || rel.startsWith(`${dir}/`);

// Returns a predicate `isIgnored(rel)` over repo-relative POSIX paths (a
// directory or a file), with `.source` naming where the set came from
// ("git" or "none").
export function gitIgnoredPredicate(repoRoot) {
  const dirs = [];
  const files = new Set();
  let source = "none";
  try {
    const out = execFileSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    source = "git";
    for (const entry of out.split("\0")) {
      if (!entry) continue;
      if (entry.endsWith("/")) dirs.push(entry.slice(0, -1));
      else files.add(entry);
    }
  } catch {
    /* no git, or not a repository: only the built-in veto applies */
  }
  const isIgnored = (rel) => {
    const clean = rel.replace(/^\.\//, "").replace(/\/$/, "");
    if (ALWAYS_IGNORED.some((d) => under(clean, d))) return true;
    if (files.has(clean)) return true;
    return dirs.some((d) => under(clean, d));
  };
  isIgnored.source = source;
  return isIgnored;
}
