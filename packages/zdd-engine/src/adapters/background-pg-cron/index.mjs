// background-pg-cron — Postgres pg_cron schedules in SQL migrations
// (decision 0038): `cron.schedule('name', 'schedule', $$body$$)` in a
// `.sql` file under a `migrations/` folder, calling the database function
// its body names (a `calls` edge, `?function:`).
// Options (extractorOptions["background-pg-cron"]): roots, exclude, modes — see
// adapters/background/shared.mjs (backgroundReader).

import { posix } from "node:path";
import { FACTS_KEY_ORDER, backgroundReader, scanPgCron, slug } from "../background/shared.mjs";
import { DETECTION_BASE, backgroundProposal, manifests } from "../background/detect.mjs";

export { FACTS_KEY_ORDER };

export function derive({ options, io }) {
  const r = backgroundReader("background-pg-cron", { io, options });
  for (const rel of r.walk((path, name) => name.endsWith(".sql") && /(^|\/)migrations\//.test(path))) {
    const text = r.read(rel);
    if (text === null) continue;
    for (const s of scanPgCron(text)) {
      r.add({ name: slug(s.name), command: s.body.replace(/\s+/g, " ").slice(0, 200), manifest: rel, dir: posix.dirname(rel), schedule: s.schedule, trigger: "pg_cron", target: s.function ?? undefined, source: "pg_cron", functionRef: s.function });
    }
  }
  return r.finish();
}

// Detection (decision 0039): the files that say this reader applies.
export const DETECTION = DETECTION_BASE;

export function detect({ scan }) {
  const hits = manifests(scan, (f) => f.name.endsWith(".sql") && /(^|\/)migrations\//.test(f.rel)).flatMap(({ rel, text }) => {
    const crons = [...text.matchAll(/cron\.schedule\s*\(\s*'([^']+)'/gi)].map((m) => m[1]);
    return crons.length ? [{ manifest: rel, scripts: crons, what: "schedules (pg_cron)" }] : [];
  });
  return backgroundProposal("background-pg-cron", hits);
}

// The adapter contract this adapter was written for, and how to comment
// out a line of each kind of file it reads: what the standard suite needs
// (decision 0040). `{}`: nothing it reads takes a line comment.
export const CONTRACT = 1;
export const COMMENT = { ".sql": "--" };
