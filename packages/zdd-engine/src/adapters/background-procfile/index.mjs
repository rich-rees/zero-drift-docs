// background-procfile — background work from a Procfile (decision 0038): one
// task per process line except `web` and the excluded names, its command
// resolved to the module or file it runs (through a package script when it
// runs one). The mode is the reader's `modes` option, else unknown — a
// Procfile does not say whether a process is a worker or scheduled.
// Options (extractorOptions["background-procfile"]): roots, exclude, modes — see
// adapters/background/shared.mjs (backgroundReader).

import { posix } from "node:path";
import { FACTS_KEY_ORDER, backgroundReader, parseCommand } from "../background/shared.mjs";

export { FACTS_KEY_ORDER };

export function derive({ options, io }) {
  const r = backgroundReader("background-procfile", { io, options });
  for (const rel of r.walk((_rel, name) => name === "Procfile")) {
    const text = r.read(rel);
    if (text === null) continue;
    const dir = posix.dirname(rel);
    for (const line of text.split("\n")) {
      const m = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/.exec(line);
      if (!m || m[1] === "web" || r.excluded(m[1])) continue;
      const parsed = parseCommand(m[2]);
      if (parsed) r.addProcess({ name: m[1], command: m[2], manifest: rel, dir, parsed, source: "procfile" });
    }
  }
  return r.finish();
}
