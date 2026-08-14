// Freshness for the changed-set highlight: the highlight diffs stores against
// merge-base(HEAD, origin/<base>), and nothing else guarantees that ref is
// fresh — a cloud clone's origin/<base> is frozen at container start, so a
// local render could embed a set CI's fresh checkout disagrees with, failing
// the blocking `render --check`. Fix: fetch before computing the merge-base.
//
// Skipped in CI (env.CI): the checkout fetched everything at job start, and
// fetching mid-job could pull a base branch NEWER than the one the committed
// rendering was computed against — a spurious failure the developer can't
// see. Failure is a warning, never fatal: an offline render proceeds on the
// possibly-stale ref, same degradation as render.mjs's no-git fallback.
//
// git is injected (an execFileSync closure) so this is unit-testable.
export function refreshOriginBase(git, baseBranch, env = process.env, warn = console.error) {
  if (env.CI) return "skipped-ci";
  try {
    git("fetch", "origin", baseBranch);
    return "fetched";
  } catch (e) {
    warn(
      `WARNING: could not fetch origin/${baseBranch} (${String(e.message).split("\n")[0]}) — ` +
        "the changed-set highlight may disagree with CI if the remote has moved",
    );
    return "failed";
  }
}
