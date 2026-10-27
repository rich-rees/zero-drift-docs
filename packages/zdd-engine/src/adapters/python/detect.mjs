// What the Python adapters' detection shares (decision 0039): the declared
// dependencies and the imported modules of a repo, read once per scan.

// Folders that are never source in a Python repo: the detection scan skips them.
export const PY_SKIP_DIRS = ["venv", "__pycache__"];
const TEST_FILE = /(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$/;

const norm = (name) => name.toLowerCase().replace(/_/g, "-");

// dependency name (lowercase, `-` for `_`) -> the first manifest declaring it.
// Read: requirements*.txt (a name at the start of a line), pyproject.toml and
// Pipfile (a quoted requirement string, or a `name =` key under a
// dependencies or packages table).
export function pythonDeps(scan) {
  return scan.memo("py:deps", () => {
    const out = new Map();
    const add = (name, rel) => {
      const n = norm(name);
      if (!out.has(n)) out.set(n, rel);
    };
    for (const f of scan.files) {
      const req = /^requirements[\w.-]*\.txt$/.test(f.name);
      const toml = f.name === "pyproject.toml" || f.name === "Pipfile";
      if (!req && !toml) continue;
      const text = scan.read(f.rel);
      if (text === null) continue;
      if (req) {
        for (const m of text.matchAll(/^\s*([A-Za-z0-9][\w.-]*)/gm)) add(m[1], f.rel);
        continue;
      }
      for (const m of text.matchAll(/["']([A-Za-z0-9][\w.-]*)\s*(?:\[[^\]]*\])?\s*(?:[<>=!~;]|["'])/g)) add(m[1], f.rel);
      let inDeps = false;
      for (const line of text.split(/\r?\n/)) {
        const table = /^\s*\[([^\]]+)\]\s*$/.exec(line);
        if (table) {
          inDeps = /(^|\.)(dependencies|dev-dependencies|packages|dev-packages)$/.test(table[1].trim()) || /\.group\.[\w-]+\.dependencies$/.test(table[1].trim());
          continue;
        }
        const key = inDeps && /^\s*([A-Za-z0-9][\w.-]*)\s*=/.exec(line);
        if (key && key[1] !== "python") add(key[1], f.rel);
      }
    }
    return out;
  });
}

// top-level module -> the Python files importing it (sorted), tests left out.
export function pythonImports(scan) {
  return scan.memo("py:imports", () => {
    const out = new Map();
    for (const f of scan.files) {
      if (!f.name.endsWith(".py") || TEST_FILE.test(f.rel)) continue;
      const text = scan.read(f.rel);
      if (text === null) continue;
      const mods = new Set();
      for (const m of text.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) for (const name of m[1].split(",")) mods.add(name.trim().split(".")[0]);
      for (const m of text.matchAll(/^\s*from\s+([\w.]+)\s+import\b/gm)) mods.add(m[1].split(".")[0]);
      for (const mod of mods) {
        if (!out.has(mod)) out.set(mod, []);
        out.get(mod).push(f.rel);
      }
    }
    return out;
  });
}

// The evidence for a Python library: where it is declared, and which files
// import it. Null when neither.
export function pythonLibraryEvidence(scan, { dep, module, label }) {
  const declared = pythonDeps(scan).get(norm(dep));
  const files = pythonImports(scan).get(module) ?? [];
  if (!declared && !files.length) return null;
  const ev = [];
  if (declared) ev.push(`\`${dep}\` in \`${declared}\``);
  if (files.length) ev.push(`${label} imported in ${files.slice(0, 3).map((f) => `\`${f}\``).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more file${files.length - 3 === 1 ? "" : "s"}` : ""}`);
  return ev;
}
