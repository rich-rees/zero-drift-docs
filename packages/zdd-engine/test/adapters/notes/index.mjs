// A test-only adapter (decision 0048 point 2): the engine's suites need an
// adapter to run, and the engine ships none, so its tests keep a few of
// their own, unpublished, in a folder laid out as an app's localExtractorDir
// is. It names no stack: it reads a made-up convention, `*.note` files
// whose lines say `GET /path`, one route record each.
import { slug } from "../_shared/words.mjs";

export const CONTRACT = 1;
export const COMMENT = { ".note": "#" };
export const SUITE = { options: { roots: ["notes"] } };
export const FACTS_KEY_ORDER = { route: ["methods"] };

export function derive({ options, io }) {
  const records = [];
  const diagnostics = [];
  for (const root of options.roots ?? ["notes"]) {
    const walked = io.walk(root, (rel) => {
      if (!rel.endsWith(".note")) return;
      const got = io.read(rel);
      if (!got.ok) return diagnostics.push(got.reason);
      for (const line of got.text.split("\n")) {
        const m = /^GET (\/\S*)$/.exec(line.replace(/#.*$/, "").trim());
        if (m) records.push({ kind: "route", id: `route:${m[1]}`, title: m[1], description: "", resource: [rel], refs: [], facts: { methods: ["GET"] }, filename: `${slug(m[1])}.json` });
      }
    });
    if (!walked.exists) diagnostics.push(`${root} is missing — nothing to inventory`);
  }
  return { records, diagnostics };
}

export const DETECTION = {
  parts: ["routes"],
  order: 10,
  skipDirs: ["scratch"],
  sourceFile: /\.note$/,
  example: { options: { roots: ["notes"] } },
};

export function detect({ scan }) {
  const notes = scan.files.filter((f) => f.name.endsWith(".note"));
  if (!notes.length) return null;
  return { proposal: { evidence: [`${notes.length} .note file(s)`], options: { roots: [...new Set(notes.map((f) => f.rel.split("/")[0]))].sort() } } };
}
