// background-compose — background work from a Docker Compose file (decision
// 0038): one task per service with a job-shaped command and no published
// ports (a service that publishes ports is the web process), a worker.
// Options (extractorOptions["background-compose"]): roots, exclude, modes — see
// adapters/background/shared.mjs (backgroundReader).

import { posix } from "node:path";
import { FACTS_KEY_ORDER, backgroundReader, parseCommand, parseCompose } from "../background/shared.mjs";
import { DETECTION_BASE, backgroundProposal, manifests } from "../background/detect.mjs";

export { FACTS_KEY_ORDER };

export function derive({ options, io }) {
  const r = backgroundReader("background-compose", { io, options });
  for (const rel of r.walk((_rel, name) => /^(docker-)?compose\.ya?ml$/.test(name))) {
    const text = r.read(rel);
    if (text === null) continue;
    const dir = posix.dirname(rel);
    for (const svc of parseCompose(text)) {
      if (svc.ports || svc.name === "web" || r.excluded(svc.name) || !svc.command) continue;
      const parsed = parseCommand(svc.command);
      if (parsed) r.addProcess({ name: svc.name, command: svc.command, manifest: rel, dir, parsed, source: "compose", modeHint: "worker" });
    }
  }
  return r.finish();
}

// Detection (decision 0039): the files that say this reader applies.
export const DETECTION = DETECTION_BASE;

export function detect({ scan }) {
  const hits = manifests(scan, (f) => /^(docker-)?compose\.ya?ml$/.test(f.name)).flatMap(({ rel, text }) => {
    const svcs = [...text.matchAll(/^\s{2}([A-Za-z0-9_.-]+):\s*$/gm)].map((m) => m[1]).filter((n) => n !== "web");
    return /^\s+command:/m.test(text) && svcs.length ? [{ manifest: rel, scripts: svcs, what: "runs a service" }] : [];
  });
  return backgroundProposal("background-compose", hits);
}
