// background-railway — background work from Railway's railway.toml /
// railway.json (decision 0038): a service's `deploy.startCommand` and its
// `deploy.cronSchedule`, named by the service folder. A Railway file says
// how a task is DEPLOYED: when another reader names the same task (a
// Procfile line, a declared entry, the same code or the same command from
// the same folder), the core joins the schedule and the file onto that
// record instead of minting a second (src/core/lib/background-tasks.mjs).
// Options (extractorOptions["background-railway"]): roots, exclude, modes — see
// adapters/background/shared.mjs (backgroundReader).

import { posix } from "node:path";
import { FACTS_KEY_ORDER, backgroundReader, parseCommand, parseToml } from "../background/shared.mjs";

export { FACTS_KEY_ORDER };

export function derive({ options, io }) {
  const r = backgroundReader("background-railway", { io, options });
  for (const rel of r.walk((_rel, name) => name === "railway.toml" || name === "railway.json")) {
    const text = r.read(rel);
    if (text === null) continue;
    const dir = posix.dirname(rel);
    let cfg = {};
    if (rel.endsWith(".toml")) cfg = parseToml(text);
    else {
      try {
        const j = JSON.parse(text);
        cfg = { "deploy.startCommand": j?.deploy?.startCommand, "deploy.cronSchedule": j?.deploy?.cronSchedule };
      } catch {
        r.diagnostics.push(`${rel}: not JSON — skipped`);
        continue;
      }
    }
    const command = cfg["deploy.startCommand"];
    const schedule = cfg["deploy.cronSchedule"];
    if (typeof command !== "string") continue;
    const parsed = parseCommand(command);
    if (parsed) r.addProcess({ name: posix.basename(dir === "." ? "root" : dir), command, manifest: rel, dir, parsed, schedule: typeof schedule === "string" ? schedule : undefined, source: "railway", deploys: true });
  }
  return r.finish();
}
