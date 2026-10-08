// jobs extractor — workers and scheduled jobs from committed run manifests
// (CAS-97, ZDD 2.1, decision 0020). One kind, `job`, for both; `facts.mode`
// tells them apart: `worker` (a long-running process), `scheduled` (run and
// exit on a cron), or `unknown` — never guessed from prose.
//
// A job is found where the repo already says "this runs as its own process":
//   package.json   a script whose command runs a module as a process —
//                  `python -m app.housekeeping` (with or without `uv run` /
//                  `poetry run` / `pipenv run`), `node x.mjs`, `tsx x.ts`,
//                  `ts-node x.ts` — and is not a dev server, a test runner,
//                  a build or a lint (`exclude`, by script name)
//   Procfile       `name: command` lines, the same command shapes; `web`
//                  is the app itself and is skipped
//   railway.toml / railway.json   `[deploy] startCommand` is a job named by
//                  the file's folder; `cronSchedule` makes it `scheduled`
//                  and is kept as a fact
//   entries        hand-declared in config, for a process no manifest names
// The mode: `scheduled` when a Railway file carries a cronSchedule for the
// job, `worker` when config's `modes` says so, else `unknown` with a lint
// warning. A job's description is its module's docstring or leading
// comment, as a route's is its handler's. Refs: `.table("x")` /
// `.from_("x")` / `.from("x")` and the tables named in SQL string literals
// (`from x`, `join x`, `update x`, `insert into x`, `delete from x`) —
// `reads` and `writes` edges (decision 0016); a table reached through a
// repository call or an f-string is not seen, honestly.
// Options (extractorOptions.jobs):
//   roots     where manifests are looked for (default ["."], node_modules
//             and .git never entered)
//   exclude   script names that are not jobs (default: dev, start, test,
//             lint, build, typecheck, format, and anything `test:*`,
//             `lint:*`, `build:*`)
//   modes     { "<job name>": "worker" | "scheduled" }
//   entries   [{ name, module | file, cwd?, mode?, schedule?, description? }]
//             — cwd is the folder the command runs in (default ".")
// Every file is read through `io` (decision 0010). Deterministic.

import { posix } from "node:path";
import { repoRelative } from "../../lib/paths.mjs";
import { leadingComment } from "../nextjs/index.mjs";

export const FACTS_KEY_ORDER = {
  job: ["mode", "command", "schedule", "manifest", "edges"],
};
export const MAX_SOURCE_BYTES = 1024 * 1024;
const DEFAULT_EXCLUDE = ["dev", "start", "test", "lint", "build", "typecheck", "format", "prepare", "postinstall"];
const MANIFESTS = new Set(["package.json", "Procfile", "railway.toml", "railway.json"]);
const MODES = new Set(["worker", "scheduled"]);

// `uv run python -m app.x --flag` -> { kind: "python-module", target: "app.x" };
// `node scripts/x.mjs` -> { kind: "file", target: "scripts/x.mjs" }; else null.
export function parseCommand(command) {
  if (typeof command !== "string") return null;
  const words = command.trim().split(/\s+/);
  let i = 0;
  while (i < words.length && /^(uv|poetry|pipenv|npx|pnpm|yarn)$/.test(words[i])) {
    i += words[i + 1] === "run" ? 2 : 1;
  }
  const head = words[i];
  if (/^python[0-9.]*$/.test(head) && words[i + 1] === "-m" && /^[\w.]+$/.test(words[i + 2] ?? "")) return { kind: "python-module", target: words[i + 2] };
  if (/^(node|tsx|ts-node|bun|deno)$/.test(head)) {
    const file = words.slice(i + 1).find((w) => !w.startsWith("-"));
    if (file && /\.(m?[jt]s|cjs)$/.test(file) && !file.includes("..") && !file.startsWith("/")) return { kind: "file", target: file };
  }
  return null;
}

// The tables a module's text names: client calls and SQL literals.
export function scanTables(text) {
  const reads = new Set();
  const writes = new Set();
  for (const m of text.matchAll(/\.(?:table|from_|from)\(\s*(['"])([\w-]+)\1\s*\)/g)) reads.add(m[2]);
  const strings = [];
  for (const m of text.matchAll(/(?:"""|''')([\s\S]*?)(?:"""|''')|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) strings.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
  for (const s of strings) {
    for (const m of s.matchAll(/\b(?:from|join)\s+([a-z_][\w]*(?:\.[a-z_][\w]*)?)\b/gi)) if (!/^(select|where|values)$/i.test(m[1])) reads.add(m[1].split(".").pop());
    for (const m of s.matchAll(/\b(?:update|insert\s+into|delete\s+from)\s+([a-z_][\w]*(?:\.[a-z_][\w]*)?)\b/gi)) writes.add(m[1].split(".").pop());
  }
  for (const w of writes) reads.delete(w);
  return { reads: [...reads].sort(), writes: [...writes].sort() };
}

// A Python module docstring's first paragraph, or a JS leading comment.
export function describe(text, file) {
  if (file.endsWith(".py")) {
    const m = /^\s*(?:#[^\n]*\n\s*)*(?:r?"""|r?''')\s*([\s\S]*?)(?:"""|''')/.exec(text);
    if (!m) return "";
    const para = m[1].split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
    return para;
  }
  return leadingComment(text);
}

const parseToml = (text) => {
  const out = {};
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) {
      section = sec[1].trim();
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (kv) out[`${section ? section + "." : ""}${kv[1]}`] = kv[2];
  }
  return out;
};

export function derive({ repoRoot, options, io }) {
  void repoRoot;
  const diagnostics = [];
  const roots = (options.roots ?? ["."]).map((r) => repoRelative(r, "jobs.roots"));
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  if (!Array.isArray(exclude) || exclude.some((x) => typeof x !== "string")) throw new Error("jobs.exclude must be an array of script names");
  const modes = options.modes ?? {};
  if (!modes || typeof modes !== "object" || Array.isArray(modes)) throw new Error("jobs.modes must be an object");
  for (const [k, v] of Object.entries(modes)) if (!MODES.has(v)) throw new Error(`jobs.modes.${k} must be "worker" or "scheduled"`);
  const entries = options.entries ?? [];
  if (!Array.isArray(entries)) throw new Error("jobs.entries must be an array");
  const excluded = (name) => exclude.includes(name) || /^(test|lint|build|check|typecheck|format)[:.-]/.test(name);

  // 1. Manifests under the roots.
  const manifests = [];
  const seen = new Set();
  for (const root of roots) {
    const walked = io.walk(
      root,
      (rel, name) => {
        if (MANIFESTS.has(name) && !seen.has(rel)) {
          seen.add(rel);
          manifests.push(rel);
        }
      },
      { enter: (rel, name) => name !== ".git" && name !== "node_modules" && name !== ".venv" && name !== "venv" },
    );
    if (!walked.exists) diagnostics.push(`${root} not found — nothing to inventory`);
    if (walked.truncated) diagnostics.push(`${root}: walk truncated — the manifests under it may be incomplete`);
  }
  manifests.sort();

  const read = (rel) => {
    const r = io.read(rel, { maxBytes: MAX_SOURCE_BYTES });
    if (!r.ok) {
      if (r.code !== "missing") diagnostics.push(`${rel} ${r.reason}`);
      return null;
    }
    return r.text;
  };
  const exists = (rel) => io.read(rel, { maxBytes: 1 }).code !== "missing";

  // A command's module file, relative to the manifest's folder.
  const resolveTarget = (dir, parsed) => {
    if (parsed.kind === "file") {
      const rel = posix.normalize(posix.join(dir, parsed.target));
      return rel.startsWith("../") ? null : exists(rel) ? rel : null;
    }
    const base = posix.join(dir, ...parsed.target.split("."));
    for (const candidate of [`${base}.py`, `${base}/__main__.py`, `${base}/__init__.py`]) {
      const rel = posix.normalize(candidate);
      if (!rel.startsWith("../") && exists(rel)) return rel;
    }
    return null;
  };

  // 2. Candidates: { name, command, manifest, dir, schedule? }
  const candidates = [];
  const railway = new Map(); // dir -> { schedule, command }
  for (const rel of manifests) {
    const text = read(rel);
    if (text === null) continue;
    const dir = posix.dirname(rel);
    const name = posix.basename(rel);
    if (name === "package.json") {
      let pkg;
      try {
        pkg = JSON.parse(text);
      } catch {
        diagnostics.push(`${rel}: not JSON — skipped`);
        continue;
      }
      const scripts = pkg && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts) ? pkg.scripts : {};
      for (const [script, command] of Object.entries(scripts).sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (excluded(script)) continue;
        const parsed = parseCommand(command);
        if (parsed) candidates.push({ name: script, command: String(command), manifest: rel, dir, parsed });
      }
    } else if (name === "Procfile") {
      for (const line of text.split("\n")) {
        const m = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/.exec(line);
        if (!m || m[1] === "web" || excluded(m[1])) continue;
        const parsed = parseCommand(m[2]);
        if (parsed) candidates.push({ name: m[1], command: m[2], manifest: rel, dir, parsed });
      }
    } else {
      let cfg = {};
      if (name === "railway.toml") cfg = parseToml(text);
      else {
        try {
          const j = JSON.parse(text);
          cfg = { "deploy.startCommand": j?.deploy?.startCommand, "deploy.cronSchedule": j?.deploy?.cronSchedule };
        } catch {
          diagnostics.push(`${rel}: not JSON — skipped`);
          continue;
        }
      }
      const command = cfg["deploy.startCommand"];
      const schedule = cfg["deploy.cronSchedule"];
      if (typeof command === "string") {
        railway.set(dir, { schedule: typeof schedule === "string" ? schedule : undefined, command, manifest: rel });
        const parsed = parseCommand(command);
        if (parsed) candidates.push({ name: posix.basename(dir === "." ? "root" : dir), command, manifest: rel, dir, parsed, schedule: typeof schedule === "string" ? schedule : undefined });
      }
    }
  }
  for (const [i, e] of entries.entries()) {
    if (!e || typeof e !== "object" || typeof e.name !== "string" || (typeof e.module !== "string" && typeof e.file !== "string")) throw new Error(`jobs.entries[${i}] must be { name, module | file, mode?, schedule? }`);
    if (e.mode !== undefined && !MODES.has(e.mode)) throw new Error(`jobs.entries[${i}].mode must be "worker" or "scheduled"`);
    const parsed = typeof e.file === "string" ? { kind: "file", target: repoRelative(e.file, `jobs.entries[${i}].file`) } : { kind: "python-module", target: e.module };
    const cwd = e.cwd === undefined ? "." : repoRelative(e.cwd, `jobs.entries[${i}].cwd`);
    candidates.push({ name: e.name, command: e.command ?? (parsed.kind === "file" ? `node ${parsed.target}` : `python -m ${parsed.target}`), manifest: "zdd/config.json", dir: cwd, parsed, schedule: typeof e.schedule === "string" ? e.schedule : undefined, mode: e.mode, description: typeof e.description === "string" ? e.description : undefined });
  }

  // A Railway file whose startCommand is a package script's or Procfile's
  // command is that job's deployment record, not a second job: its schedule
  // attaches to the job and the file joins its resources.
  const norm = (cmd) => cmd.trim().replace(/\s+/g, " ");
  const merged = [];
  for (const c of candidates) {
    if (c.manifest.endsWith("railway.toml") || c.manifest.endsWith("railway.json")) {
      const twin = candidates.find((o) => o !== c && !/railway\.(toml|json)$/.test(o.manifest) && norm(o.command) === norm(c.command));
      if (twin) {
        if (c.schedule && !twin.schedule) twin.schedule = c.schedule;
        (twin.extraResources ??= []).push(c.manifest);
        continue;
      }
    }
    merged.push(c);
  }

  // 3. Records: one per job name; a name declared twice keeps the first
  // (sorted manifests) with a diagnostic.
  const records = [];
  const byName = new Map();
  for (const c of merged) {
    if (byName.has(c.name)) {
      diagnostics.push(`job '${c.name}' is declared in ${byName.get(c.name)} and again in ${c.manifest} — the second is skipped`);
      continue;
    }
    const file = resolveTarget(c.dir, c.parsed);
    if (!file) {
      diagnostics.push(`${c.manifest}: '${c.name}' runs ${c.parsed.kind === "file" ? c.parsed.target : `module ${c.parsed.target}`}, which resolves to no file under ${c.dir} — skipped`);
      continue;
    }
    byName.set(c.name, c.manifest);
    const text = read(file) ?? "";
    // A Railway file in the module's folder (or the manifest's) states the schedule.
    const rw = railway.get(c.dir) ?? railway.get(posix.dirname(file));
    const schedule = c.schedule ?? (rw && rw.command === c.command ? rw.schedule : undefined);
    const mode = schedule ? "scheduled" : (c.mode ?? modes[c.name] ?? "unknown");
    const tables = scanTables(text);
    const edges = {};
    if (tables.reads.length) edges.reads = tables.reads.map((t) => `?table:${t}`);
    if (tables.writes.length) edges.writes = tables.writes.map((t) => `?table:${t}`);
    const refs = [...new Set([...(edges.reads ?? []), ...(edges.writes ?? [])])].sort();
    const facts = { mode, command: c.command };
    if (schedule) facts.schedule = schedule;
    facts.manifest = c.manifest;
    if (Object.keys(edges).length) facts.edges = edges;
    records.push({
      kind: "job",
      id: `job:${c.name}`,
      title: c.name,
      description: c.description ?? describe(text, file),
      resource: [file, c.manifest, ...(c.extraResources ?? [])].filter((v, i, a) => a.indexOf(v) === i),
      refs,
      facts,
      filename: `${c.name.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`,
    });
  }
  records.sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!records.length) diagnostics.push("no jobs in any manifest — nothing to inventory");
  return { records, diagnostics };
}
