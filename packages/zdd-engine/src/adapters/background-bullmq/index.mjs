// background-bullmq — background work handed over through a queue (decision 0038):
// BullMQ: `new Queue("x")` produces, `new Worker("x", …)` consumes, read from source. One task per queue name: its consumer file is
// the resource (and the code it runs), its producers `usedBy` edges. A
// queue named like the process that consumes it joins that process's
// record (the core merges them: the same code file).
// Options (extractorOptions["background-bullmq"]): roots, exclude, modes — see
// adapters/background/shared.mjs (backgroundReader).

import { posix } from "node:path";
import { FACTS_KEY_ORDER, backgroundReader, SOURCE_EXT, TEST_FILE, scanQueues, slug } from "../background/shared.mjs";

export { FACTS_KEY_ORDER };

export function derive({ options, io }) {
  const r = backgroundReader("background-bullmq", { io, options });
  const queues = new Map(); // name -> { producers: Set, consumers: Set, trigger?, schedule? }
  for (const rel of r.walk((path, base) => SOURCE_EXT.test(base) && !TEST_FILE.test(path))) {
    const text = r.read(rel);
    if (text === null) continue;
    for (const q of scanQueues(text, { python: rel.endsWith(".py") })) {
      if (q.lib !== "bullmq") continue;
      const entry = queues.get(q.queue) ?? { producers: new Set(), consumers: new Set() };
      (q.role === "producer" ? entry.producers : entry.consumers).add(rel);
      if (q.trigger) entry.trigger = q.trigger;
      if (q.schedule) entry.schedule = q.schedule;
      queues.set(q.queue, entry);
    }
  }
  for (const [queue, q] of [...queues].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const consumers = [...q.consumers].sort();
    const producers = [...q.producers].sort();
    const file = consumers[0] ?? producers[0];
    r.add({ name: slug(queue), command: `bullmq ${q.schedule ? "scheduled task" : "queue"} "${queue}"`, manifest: file, dir: posix.dirname(file), file, schedule: q.schedule, trigger: q.schedule ? "cron" : q.trigger ? `event ${q.trigger}` : "queue", queue, producers, consumers, source: "bullmq", modeHint: q.schedule ? "scheduled" : "queue" });
  }
  return r.finish();
}
