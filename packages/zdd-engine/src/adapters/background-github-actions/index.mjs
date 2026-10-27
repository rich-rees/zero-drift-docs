// background-github-actions — GitHub Actions schedules (decision 0038):
// the `on: schedule: - cron:` of each `.github/workflows` file, listed as
// housekeeping — repo upkeep, shown apart from the app's own background
// work. Listing this adapter in `extractors` is the opt-in (it was
// `jobs.includeGithubActions` before 0.9).
// Options (extractorOptions["background-github-actions"]): roots, exclude, modes — see
// adapters/background/shared.mjs (backgroundReader).

import { posix } from "node:path";
import { FACTS_KEY_ORDER, backgroundReader, scanWorkflow, slug } from "../background/shared.mjs";

export { FACTS_KEY_ORDER };

export function derive({ options, io }) {
  const r = backgroundReader("background-github-actions", { io, options });
  for (const rel of r.walk((path) => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path))) {
    const text = r.read(rel);
    if (text === null) continue;
    const w = scanWorkflow(text);
    if (!w.crons.length) continue;
    r.add({ name: slug(w.name ?? posix.basename(rel).replace(/\.ya?ml$/, "")), command: `GitHub Actions workflow ${rel}`, manifest: rel, dir: posix.dirname(rel), schedule: w.crons.join("; "), trigger: "cron", source: "github-actions", housekeeping: true });
  }
  return r.finish();
}

// Detection (decision 0039): none — this reader is chosen by listing it; its
// options are shaped like every background reader's.
export { DETECTION_BASE as DETECTION } from "../background/detect.mjs";
