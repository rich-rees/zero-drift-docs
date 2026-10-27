// background-declared — background tasks declared by hand (decision 0038),
// the fallback for a platform no reader covers yet, or a process whose
// manifest runs build output: `entries`, each { name, module | file, cwd?,
// command?, mode?, schedule?, description? }. A declared task drifts when
// the platform file changes, which is why a reader is preferred; one that
// runs the same code, or the same command from the same folder, as a
// reader's task is joined with it by the core.
// Options (extractorOptions["background-declared"]): entries.

import { repoRelative } from "../../core/lib/paths.mjs";
import { FACTS_KEY_ORDER, backgroundReader } from "../background/shared.mjs";

export { FACTS_KEY_ORDER };

export function derive({ options, io }) {
  const r = backgroundReader("background-declared", { io, options });
  const entries = options.entries ?? [];
  if (!Array.isArray(entries)) throw new Error("background-declared.entries must be an array");
  for (const [i, e] of entries.entries()) {
    if (!e || typeof e !== "object" || typeof e.name !== "string" || (typeof e.module !== "string" && typeof e.file !== "string")) throw new Error(`background-declared.entries[${i}] must be { name, module | file, mode?, schedule? }`);
    if (e.mode !== undefined && e.mode !== "worker" && e.mode !== "scheduled") throw new Error(`background-declared.entries[${i}].mode must be "worker" or "scheduled"`);
    const parsed = typeof e.file === "string" ? { kind: "file", target: repoRelative(e.file, `background-declared.entries[${i}].file`) } : { kind: "python-module", target: e.module };
    const cwd = e.cwd === undefined ? "." : repoRelative(e.cwd, `background-declared.entries[${i}].cwd`);
    r.add({ name: e.name, command: e.command ?? (parsed.kind === "file" ? `node ${parsed.target}` : `python -m ${parsed.target}`), manifest: "zdd/config.json", dir: cwd, parsed, schedule: typeof e.schedule === "string" ? e.schedule : undefined, mode: e.mode, description: typeof e.description === "string" ? e.description : undefined, source: "config" });
  }
  return r.finish();
}

// Detection (decision 0039): none — this reader is chosen by listing it; its
// options are shaped like every background reader's.
export { DETECTION_BASE as DETECTION } from "../background/detect.mjs";
