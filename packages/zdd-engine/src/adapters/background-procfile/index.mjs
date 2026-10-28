// background-procfile — background work from a Procfile (decision 0038): one
// task per process line except `web` and the excluded names, its command
// resolved to the module or file it runs (through a package script when it
// runs one). The mode is the reader's `modes` option, else unknown — a
// Procfile does not say whether a process is a worker or scheduled.
// Options (extractorOptions["background-procfile"]): roots, exclude, modes — see
// adapters/background/shared.mjs (backgroundReader).

import { posix } from "node:path";
import { FACTS_KEY_ORDER, backgroundReader, parseCommand, SOURCE_COMMENT } from "../background/shared.mjs";
import { DETECTION_BASE, backgroundProposal, jobShaped, manifests } from "../background/detect.mjs";

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

// Detection (decision 0039): the files that say this reader applies.
export const DETECTION = DETECTION_BASE;

export function detect({ scan }) {
  const hits = manifests(scan, (f) => f.name === "Procfile").flatMap(({ rel, text }) => {
    const names = text.split("\n").map((l) => /^\s*([A-Za-z_][\w-]*)\s*:\s*(.+)$/.exec(l)).filter((m) => m && m[1] !== "web" && jobShaped(m[2])).map((m) => m[1]);
    return names.length ? [{ manifest: rel, scripts: names, what: "runs a process" }] : [];
  });
  return backgroundProposal("background-procfile", hits);
}

// The adapter contract this adapter was written for, and how to comment
// out a line of each kind of file it reads: what the standard suite needs
// (decision 0040). `{}`: nothing it reads takes a line comment.
export const CONTRACT = 1;
export const COMMENT = { ...SOURCE_COMMENT, Procfile: "#" };
