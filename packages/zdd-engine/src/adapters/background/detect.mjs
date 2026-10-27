// What the background readers' detection shares (decision 0039): the
// proposal's shape and the caveat every reader carries, the command shape
// that counts as background work, and the queue declarations in source.

import { SOURCE_EXT, TEST_FILE, scanQueues } from "./shared.mjs";

// A command that runs code: `python -m pkg`, `node file.js`, `npm run x`.
// A package.json script on its own is a hand-run tool, not background work,
// and is never evidence (2.3.0, pick 6).
export const jobShaped = (cmd) =>
  /(?:^|\s)python[0-9.]*\s+-m\s+[\w.]+/.test(cmd) || /(?:^|\s)(?:node|tsx|ts-node|bun|deno)\s+(?:-[^\s]+\s+)*[\w./-]+\.(?:m?[jt]s|cjs)\b/.test(cmd) || /(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:.-]+/.test(cmd);

// Every background reader is an opt-in, offered again by each upgrade.
export const DETECTION_BASE = { parts: ["background tasks"], order: 70, optIn: true, optionShape: { pathLists: ["roots"] } };

// hits: [{ manifest, scripts, what }] -> a proposal, or null when none.
export function backgroundProposal(reader, hits) {
  if (!hits.length) return null;
  hits.sort((a, b) => (a.manifest < b.manifest ? -1 : a.manifest > b.manifest ? 1 : 0));
  return {
    proposal: {
      evidence: hits
        .map((m) => `\`${m.manifest}\` ${m.what}: ${m.scripts.map((s) => `\`${s}\``).join(", ")}`)
        .concat([
          `the map will show this background work with its trigger and what it hits (a cron → a route, a queue → its worker); the mode (worker or scheduled) is never guessed: a schedule or a Railway file states it, else set extractorOptions["${reader}"].modes after bootstrap — lint names the ones left unknown; a package.json script counts only when a manifest runs it`,
        ]),
      options: {},
    },
  };
}

// The files a manifest reader looks at, by name, with their text.
export function manifests(scan, test) {
  const out = [];
  for (const f of scan.files) {
    if (!test(f)) continue;
    const text = scan.read(f.rel);
    if (text !== null) out.push({ rel: f.rel, text });
  }
  return out;
}

// Every queue declaration in source, per file, scanned once per scan.
function queuesByFile(scan) {
  return scan.memo("bg:queues", () => {
    const out = [];
    for (const f of scan.files) {
      if (!SOURCE_EXT.test(f.name) || TEST_FILE.test(f.rel)) continue;
      const text = scan.read(f.rel);
      if (text === null) continue;
      const qs = scanQueues(text, { python: f.name.endsWith(".py") });
      if (qs.length) out.push({ rel: f.rel, queues: qs });
    }
    return out;
  });
}

// A queue reader's hits: each file naming one of `lib`'s queues.
export function queueHits(scan, lib, what) {
  return queuesByFile(scan)
    .map(({ rel, queues }) => ({ manifest: rel, scripts: [...new Set(queues.filter((q) => q.lib === lib).map((q) => q.queue))], what }))
    .filter((h) => h.scripts.length);
}
