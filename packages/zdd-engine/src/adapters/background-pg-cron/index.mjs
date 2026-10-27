// background-pg-cron — Postgres pg_cron schedules in SQL migrations
// (decision 0038): `cron.schedule('name', 'schedule', $$body$$)` in a
// `.sql` file under a `migrations/` folder, calling the database function
// its body names (a `calls` edge, `?function:`).
// Options (extractorOptions["background-pg-cron"]): roots, exclude, modes — see
// adapters/background/shared.mjs (backgroundReader).

import { posix } from "node:path";
import { FACTS_KEY_ORDER, backgroundReader, scanPgCron, slug } from "../background/shared.mjs";

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
