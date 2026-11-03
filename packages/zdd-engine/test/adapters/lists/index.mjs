// A second test-only adapter (see notes/index.mjs): `*.list` files, one
// record per line, kind `item`. It skips a folder of its own, so a test can
// see a scan skip the union of every adapter's folders.
export const CONTRACT = 1;
export const COMMENT = { ".list": "#" };
export const FACTS_KEY_ORDER = {};

export function derive({ io }) {
  const records = [];
  io.walk(".", (rel) => {
    if (!rel.endsWith(".list")) return;
    const got = io.read(rel);
    if (!got.ok) return;
    for (const line of got.text.split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean)) {
      records.push({ kind: "item", id: `item:${line}`, title: line, description: "", resource: [rel], refs: [], facts: {}, filename: `${line.replace(/[^A-Za-z0-9]+/g, "-")}.json` });
    }
  });
  return { records, diagnostics: [] };
}

export const DETECTION = { parts: ["schema"], order: 20, skipDirs: ["vendored"] };

export function detect({ scan }) {
  return scan.files.some((f) => f.name.endsWith(".list")) ? { proposal: { evidence: ["a .list file"], options: {} } } : null;
}
