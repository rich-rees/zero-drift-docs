// background-trigger-dev — background work handed over through a queue (decision 0038):
// Trigger.dev: `task({ id })` consumes, `schedules.task({ id, cron })` is scheduled, read from source. One task per queue name: its consumer file is
// the resource (and the code it runs), its producers `usedBy` edges. A
// queue named like the process that consumes it joins that process's
// record (the core merges them: the same code file).
// Options (extractorOptions["background-trigger-dev"]): roots, exclude, modes — see
// adapters/background/shared.mjs (backgroundReader).

import { posix } from "node:path";
import { FACTS_KEY_ORDER, backgroundReader, SOURCE_EXT, TEST_FILE, scanQueues, slug } from "../background/shared.mjs";
import { DETECTION_BASE, backgroundProposal, queueHits } from "../background/detect.mjs";

export { FACTS_KEY_ORDER };

export function derive({ options, io }) {
  const r = backgroundReader("background-trigger-dev", { io, options });
  const queues = new Map(); // name -> { producers: Set, consumers: Set, trigger?, schedule? }
  for (const rel of r.walk((path, base) => SOURCE_EXT.test(base) && !TEST_FILE.test(path))) {
    const text = r.read(rel);
    if (text === null) continue;
    for (const q of scanQueues(text, { python: rel.endsWith(".py") })) {
      if (q.lib !== "trigger.dev") continue;
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
    r.add({ name: slug(queue), command: `trigger.dev ${q.schedule ? "scheduled task" : "queue"} "${queue}"`, manifest: file, dir: posix.dirname(file), file, schedule: q.schedule, trigger: q.schedule ? "cron" : q.trigger ? `event ${q.trigger}` : "queue", queue, producers, consumers, source: "trigger.dev", modeHint: q.schedule ? "scheduled" : "queue" });
  }
  return r.finish();
}

// Detection (decision 0039): the files that say this reader applies.
export const DETECTION = DETECTION_BASE;

export function detect({ scan }) {
  return backgroundProposal("background-trigger-dev", queueHits(scan, "trigger.dev", "declares a Trigger.dev task"));
}
