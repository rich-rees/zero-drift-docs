// What every background-* reader shares (decision 0038): a helper folder,
// not an adapter (no index.mjs). "Is this background work?" (decision 0025:
// what runs without a click; a package script only when a manifest runs it),
// "which script, module or file does this command run?", the small readers
// for the formats the platforms write (TOML, Compose, a workflow's schedule,
// pg_cron, queue declarations in source), and the reader that turns a
// platform's candidates into `background-task` records. The core never sees
// a platform: it merges two readers' records of one task by the code it runs
// (src/core/lib/background-tasks.mjs). Every file is read through `io`
// (decision 0010). Deterministic: same bytes in, same records out.

import { posix } from "node:path";
import { repoRelative } from "../../core/lib/paths.mjs";
import { leadingComment } from "../nextjs/index.mjs";

export const MAX_SOURCE_BYTES = 1024 * 1024;
export const DEFAULT_EXCLUDE = ["dev", "start", "test", "lint", "build", "typecheck", "format", "prepare", "postinstall"];
export const NEVER_ENTER = new Set([".git", "node_modules", ".venv", "venv", "dist", "build", ".next", ".expo", "coverage", "__pycache__", ".vercel", ".wrangler"]);
export const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;
export const TEST_FILE = /\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$|\.d\.ts$/;

// `uv run python -m app.x --flag` -> { kind: "python-module", target: "app.x" };
// `node scripts/x.mjs` -> { kind: "file", target: "scripts/x.mjs" };
// `pnpm run worker` / `npm run worker` / `yarn worker` -> { kind: "script", target: "worker" }; else null.
export function parseCommand(command) {
  if (typeof command !== "string") return null;
  let words = command.trim().split(/\s+/);
  const pm = /^(npm|pnpm|yarn|bun)$/.exec(words[0] ?? "");
  if (pm) {
    // `pnpm --filter api run worker` / `pnpm -F api worker` / `yarn workspace api run worker`:
    // the script lives in that workspace package.
    let filter = null;
    const rest = [words[0]];
    for (let k = 1; k < words.length; k++) {
      if ((words[k] === "--filter" || words[k] === "-F" || words[k] === "workspace") && words[k + 1]) {
        filter = words[++k];
        continue;
      }
      const eq = /^--filter=(.+)$/.exec(words[k]);
      if (eq) {
        filter = eq[1];
        continue;
      }
      rest.push(words[k]);
    }
    words = rest;
    const run = words[1] === "run" || words[1] === "run-script";
    const name = run ? words[2] : pm[1] === "npm" ? null : words[1];
    // `pnpm tsx x.ts` runs a runner, not a script: fall through to the runner shapes.
    const runner = /^(tsx|ts-node|node|bun|deno|npx|python[0-9.]*|uv|poetry|pipenv)$/.test(name ?? "");
    if (name && !runner && /^[\w:.-]+$/.test(name) && !/^(install|i|add|exec|dlx|x|test|build|dev|start)$/.test(name)) return { kind: "script", target: name, ...(filter ? { package: filter } : {}) };
    if (!run && pm[1] !== "npm" && !runner) return null;
  }
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

// A minimal TOML reader: `[section]` headers, `key = "string"` and
// `key = ["a", "b"]` lines — what railway.toml and wrangler.toml carry.
export const parseToml = (text) => {
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
    const kv = /^([A-Za-z_][\w-]*)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const key = `${section ? section + "." : ""}${kv[1]}`;
    const v = kv[2].trim();
    const str = /^"((?:[^"\\]|\\.)*)"$/.exec(v);
    if (str) out[key] = str[1];
    else if (v.startsWith("[")) out[key] = [...v.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  }
  return out;
};

// A minimal Compose reader: the services, each with its `command` (string or
// list) and whether it publishes ports (the web process, not a worker).
export function parseCompose(text) {
  const services = [];
  const lines = text.split("\n");
  let inServices = false;
  let svcIndent = -1;
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "").replace(/\r$/, "");
    if (!line.trim()) continue;
    const indent = line.search(/\S/);
    const t = line.trim();
    if (indent === 0) {
      inServices = /^services:\s*$/.test(t);
      current = null;
      svcIndent = -1;
      continue;
    }
    if (!inServices) continue;
    if (svcIndent === -1 || indent === svcIndent) {
      const name = /^([A-Za-z0-9_.-]+):\s*$/.exec(t);
      if (name) {
        svcIndent = indent;
        current = { name: name[1], command: null, ports: false };
        services.push(current);
        continue;
      }
    }
    if (!current || indent <= svcIndent) continue;
    const cmd = /^command:\s*(.+)$/.exec(t);
    if (cmd) {
      const v = cmd[1].trim();
      current.command = v.startsWith("[") ? [...v.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1] ?? m[2]).join(" ") : v.replace(/^["']|["']$/g, "");
    }
    if (/^ports:/.test(t)) current.ports = true;
  }
  return services;
}

// Comments blanked, string literals kept (CR-506): a commented-out
// `new Worker("x")` or `cron.schedule(...)` is not a declaration, while the
// names the scanners read live inside strings. Line comments `//` and `#`
// (JS, Python, TOML, YAML) or `--` (SQL); block comments `/* */`. The
// blanks keep the text's length and line count.
export function maskComments(text, { line = ["//"], block = true } = {}) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === "\\") j++;
        if (c !== "`" && text[j] === "\n") break;
        j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (block && c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    const opener = line.find((l) => text.startsWith(l, i));
    if (opener) {
      let end = text.indexOf("\n", i);
      if (end === -1) end = n;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// pg_cron schedules in a migration: cron.schedule('name', 'schedule', $$body$$ | 'body').
export function scanPgCron(text) {
  const out = [];
  text = maskComments(text, { line: ["--"], block: true });
  for (const m of text.matchAll(/cron\.schedule\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(?:\$\$([\s\S]*?)\$\$|'((?:[^'\\]|\\.|'')*)')/gi)) {
    const body = (m[3] ?? m[4] ?? "").trim();
    const fn = /\b(?:select|call|perform)\s+(?:([a-z_][\w]*)\.)?([a-z_][\w]*)\s*\(/i.exec(body);
    // The function as the body spells it, schema and all (`public.send_digest`): the
    // resolver matches a schema-qualified name against the full record name.
    out.push({ name: m[1], schedule: m[2], body, function: fn ? (fn[1] ? `${fn[1]}.${fn[2]}` : fn[2]) : null });
  }
  return out;
}

// Queue declarations and uses in one source file's text.
export function scanQueues(text, { python = false } = {}) {
  const out = [];
  // A Python source comments with `#` (verify CR-506); JS with `//` and `/* */`.
  text = maskComments(text, python ? { line: ["#"], block: false } : undefined);
  for (const m of text.matchAll(/new\s+Queue\s*\(\s*(['"`])([^'"`]+)\1/g)) out.push({ queue: m[2], role: "producer", lib: "bullmq" });
  for (const m of text.matchAll(/new\s+Worker\s*\(\s*(['"`])([^'"`]+)\1/g)) out.push({ queue: m[2], role: "consumer", lib: "bullmq" });
  for (const m of text.matchAll(/createFunction\s*\(\s*\{[^}]*\bid\s*:\s*(['"`])([^'"`]+)\1[^}]*\}\s*,\s*\{[^}]*\b(?:event|cron)\s*:\s*(['"`])([^'"`]+)\3/g)) out.push({ queue: m[2], role: "consumer", lib: "inngest", trigger: m[4] });
  for (const m of text.matchAll(/\bschedules\.task\s*\(\s*\{[^}]*\bid\s*:\s*(['"`])([^'"`]+)\1[^}]*\bcron\s*:\s*(['"`])([^'"`]+)\3/g)) out.push({ queue: m[2], role: "consumer", lib: "trigger.dev", schedule: m[4] });
  for (const m of text.matchAll(/(?<![\w.])task\s*\(\s*\{[^}]*\bid\s*:\s*(['"`])([^'"`]+)\1/g)) out.push({ queue: m[2], role: "consumer", lib: "trigger.dev" });
  const sqs = [...text.matchAll(/QueueUrl\s*[:=]\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2].split("/").filter(Boolean).pop());
  for (const q of new Set(sqs)) {
    if (/SendMessage/.test(text)) out.push({ queue: q, role: "producer", lib: "sqs" });
    if (/ReceiveMessage/.test(text)) out.push({ queue: q, role: "consumer", lib: "sqs" });
  }
  return out;
}

// GitHub Actions: the `cron:` items under the top-level `on:` block's
// `schedule:` key, and the workflow's name. A `- cron:` anywhere else (an
// action's input, a matrix) is not a schedule (CR-507): the YAML is walked
// by indentation — top-level key, its child `schedule`, its list items.
export function scanWorkflow(text) {
  const crons = [];
  const lines = maskComments(text, { line: ["#"], block: false }).split(/\r?\n/);
  let inOn = false;
  let inSchedule = false;
  let childIndent = -1; // the indent of `on:`'s direct children
  let scheduleIndent = -1;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0) {
      inOn = /^(on|"on"|'on'|true):/.test(line);
      inSchedule = false;
      childIndent = -1;
      continue;
    }
    if (!inOn) continue;
    if (childIndent === -1) childIndent = indent;
    if (inSchedule && indent <= scheduleIndent) inSchedule = false;
    // `schedule:` is a direct child of `on:` (verify CR-507): one nested
    // deeper (an input's default) is not a trigger.
    if (!inSchedule && indent === childIndent && /^schedule:/.test(line)) {
      inSchedule = true;
      scheduleIndent = indent;
      continue;
    }
    if (inSchedule) {
      const m = /^-\s*cron:\s*['"]?([^'"]+?)['"]?\s*$/.exec(line);
      if (m) crons.push(m[1].trim());
    }
  }
  const name = /^name:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(text);
  return { crons, name: name ? name[1].trim() : null };
}

export const slug = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "task";

// ---------------------------------------------------------------------------
// The reader every background-* adapter is built on (decision 0038)
// ---------------------------------------------------------------------------
// `backgroundReader(name, { io, options })` checks the options every reader
// shares, walks its roots once, and turns the candidates the reader adds into
// `background-task` records:
//   roots    where its files are looked for (default ["."]; dependencies and
//            build output never entered)
//   exclude  process names that are not background work (Procfile, Compose)
//   modes    { "<task name>": "worker" | "scheduled" } — the mode a manifest
//            does not state (CR-010: the lint names this reader's option)
// A candidate is { name, command, manifest, dir, parsed?, file?, schedule?,
// trigger?, target?, queue?, producers?, consumers?, mode?, modeHint?,
// description?, housekeeping?, routeRef?, functionRef?, scriptCommand?,
// deploys? }. Two transient keys go on each record for the core's merge
// (src/core/lib/background-tasks.mjs), never written: `runs` (the code
// files it runs — a queue's every consumer) and `processKeys` (the command
// it runs and the folder it runs it from), and `deploys: true` on a record that says how a task is deployed
// rather than what it is (a Railway file). A process whose command names no
// file in the repo is a record with `unresolved` (the warning to print if no
// other reader names the same task): build output is never committed.
export const FACTS_KEY_ORDER = {
  "background-task": ["mode", "command", "schedule", "trigger", "target", "queue", "producers", "consumers", "source", "reader", "housekeeping", "manifest", "edges"],
};
const MODES = new Set(["worker", "scheduled"]);
const norm = (cmd) => String(cmd).trim().replace(/\s+/g, " ");

export function backgroundReader(reader, { io, options = {} }) {
  const diagnostics = [];
  const roots = (options.roots ?? ["."]).map((r) => repoRelative(r, `${reader}.roots`));
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  if (!Array.isArray(exclude) || exclude.some((x) => typeof x !== "string")) throw new Error(`${reader}.exclude must be an array of process names`);
  const modes = options.modes ?? {};
  if (!modes || typeof modes !== "object" || Array.isArray(modes)) throw new Error(`${reader}.modes must be an object`);
  for (const [k, v] of Object.entries(modes)) if (!MODES.has(v)) throw new Error(`${reader}.modes.${k} must be "worker" or "scheduled"`);
  const excluded = (name) => exclude.includes(name) || /^(test|lint|build|check|typecheck|format)[:.-]/.test(name);

  // Every file under the roots that `want(rel, name)` keeps, sorted.
  const walk = (want) => {
    const out = [];
    const seen = new Set();
    for (const root of roots) {
      if (io.isIgnored(root)) {
        diagnostics.push(`${root} is gitignored — not source, not read`);
        continue;
      }
      const walked = io.walk(
        root,
        (rel, name) => {
          if (seen.has(rel)) return;
          seen.add(rel);
          if (want(rel, name)) out.push(rel);
        },
        { enter: (_rel, name) => !NEVER_ENTER.has(name) },
      );
      if (!walked.exists) diagnostics.push(`${root} not found — nothing to inventory`);
      if (walked.truncated) diagnostics.push(`${root}: walk truncated — the files under it may be incomplete`);
    }
    return out.sort();
  };
  const read = (rel) => {
    const r = io.read(rel, { maxBytes: MAX_SOURCE_BYTES });
    if (!r.ok) {
      if (r.code !== "missing" && r.code !== "ignored") diagnostics.push(`${rel} ${r.reason}`);
      return null;
    }
    return r.text;
  };
  // A target exists when it is a readable regular file, or one too large to
  // read (still a file): a folder, a symlink or an unreadable path is not a
  // module a process can run (CR-508). An ignored target is absent too: a
  // clean clone has no such file (pick 1).
  const exists = (rel) => {
    const r = io.read(rel, { maxBytes: 1 });
    return r.ok || r.code === "too-large";
  };
  // A command's module file: relative to the manifest's folder, then each
  // folder above it up to the repo root — a Railway service folder runs its
  // command from the app's root, not from the folder the file sits in.
  const resolveTarget = (dir, parsed) => {
    for (let d = dir; ; d = posix.dirname(d)) {
      if (parsed.kind === "file") {
        const rel = posix.normalize(posix.join(d, parsed.target));
        if (!rel.startsWith("../") && exists(rel)) return rel;
      } else {
        const base = posix.join(d, ...parsed.target.split("."));
        for (const candidate of [`${base}.py`, `${base}/__main__.py`, `${base}/__init__.py`]) {
          const rel = posix.normalize(candidate);
          if (!rel.startsWith("../") && exists(rel)) return rel;
        }
      }
      if (d === "." || d === "" || d === "/") return null;
    }
  };
  // The package.json scripts in a folder, read once.
  const scriptsCache = new Map();
  const scriptsIn = (dir) => {
    if (scriptsCache.has(dir)) return scriptsCache.get(dir);
    let scripts = {};
    const rel = posix.normalize(posix.join(dir, "package.json"));
    const text = exists(rel) ? read(rel) : null;
    if (text) {
      try {
        const pkg = JSON.parse(text);
        scripts = pkg && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts) ? pkg.scripts : {};
      } catch {
        diagnostics.push(`${rel}: not JSON — skipped`);
      }
    }
    scriptsCache.set(dir, scripts);
    return scripts;
  };
  // `pnpm run worker` in a manifest resolves through the nearest package.json
  // (the manifest's folder, then up to the repo root) to the command it runs.
  const resolveScript = (dir, parsed) => {
    if (parsed.package) {
      for (const base of [dir, "."]) {
        for (const sub of [parsed.package, `apps/${parsed.package}`, `packages/${parsed.package}`, `services/${parsed.package}`, `workers/${parsed.package}`]) {
          const d = posix.normalize(posix.join(base, sub));
          if (d.startsWith("../")) continue;
          const scripts = scriptsIn(d);
          if (typeof scripts[parsed.target] === "string") {
            const inner = parseCommand(scripts[parsed.target]);
            return inner && inner.kind !== "script" ? { dir: d, parsed: inner, command: scripts[parsed.target] } : null;
          }
        }
      }
      return null;
    }
    for (let d = dir; ; d = posix.dirname(d)) {
      const scripts = scriptsIn(d);
      if (typeof scripts[parsed.target] === "string") {
        const inner = parseCommand(scripts[parsed.target]);
        if (inner && inner.kind !== "script") return { dir: d, parsed: inner, command: scripts[parsed.target] };
        return null;
      }
      if (d === "." || d === "") return null;
    }
  };

  const candidates = [];
  // A process a manifest runs: a package script resolves to the command it
  // runs first; one that names no module or file is skipped with a diagnostic.
  const addProcess = (c) => {
    if (c.parsed.kind === "script") {
      const resolved = resolveScript(c.dir, c.parsed);
      if (!resolved) {
        diagnostics.push(`${c.manifest}: '${c.name}' runs the package script '${c.parsed.target}', which names no module or file to run — skipped`);
        return;
      }
      candidates.push({ ...c, manifestDir: c.dir, dir: resolved.dir, parsed: resolved.parsed, scriptCommand: resolved.command });
      return;
    }
    candidates.push(c);
  };
  const add = (c) => candidates.push(c);

  const finish = () => {
    const records = [];
    for (const c of candidates) {
      let file = c.file ?? null;
      let unresolved;
      if (c.parsed) {
        file = resolveTarget(c.dir, c.parsed);
        if (!file) {
          const runs = c.parsed.kind === "file" ? c.parsed.target : `module ${c.parsed.target}`;
          const config = reader === "background-declared";
          unresolved =
            `${c.manifest}: '${c.name}' runs ${runs}, which is not a file in the repo (build output?) — the task is not on the map. ` +
            (config
              ? "Point this entry's file or module at the source file"
              : `Name its source file in extractorOptions["background-declared"].entries: ${JSON.stringify({ name: c.name, file: "<the source file>", ...(c.dir === "." ? {} : { cwd: c.dir }), command: c.command }).replace(/,"/g, ', "').replace(/":/g, '": ')}`);
        }
      }
      const text = file ? read(file) ?? "" : "";
      const mode = c.schedule ? "scheduled" : (c.mode ?? modes[c.name] ?? c.modeHint ?? "unknown");
      const edges = {};
      if (file) edges.reads = [`?code:${file}#*`];
      if (c.routeRef) edges.calls = [`?route:${c.routeRef}`];
      if (c.functionRef) edges.calls = [`?function:${c.functionRef}`];
      if (c.producers?.length) edges.usedBy = c.producers.map((f) => `?at:${f}`);
      const facts = { mode, command: c.command };
      if (c.schedule) facts.schedule = c.schedule;
      if (c.trigger) facts.trigger = c.trigger;
      if (c.target) facts.target = c.target;
      if (c.queue) facts.queue = c.queue;
      if (c.producers) facts.producers = c.producers;
      if (c.consumers) facts.consumers = c.consumers;
      facts.source = c.source;
      facts.reader = reader;
      if (c.housekeeping) facts.housekeeping = true;
      facts.manifest = c.manifest;
      if (Object.keys(edges).length) facts.edges = edges;
      // The command each folder really runs (CR-077): the manifest's own
      // command from the manifest's folder, and — when it runs a package
      // script — the script's command from the script's folder. Never the
      // crossings, which no process runs.
      const keys = new Set();
      if (typeof c.command === "string") keys.add(`${c.manifestDir ?? c.dir}\u0000${norm(c.command)}`);
      if (typeof c.scriptCommand === "string") keys.add(`${c.dir}\u0000${norm(c.scriptCommand)}`);
      records.push({
        kind: "background-task",
        id: `background-task:${c.name}`,
        title: c.name,
        description: c.description ?? (file ? describe(text, file) : ""),
        resource: [file, c.manifest, ...(c.extraResources ?? [])].filter((v, i, a) => v && a.indexOf(v) === i),
        refs: [...new Set(Object.values(edges).flat())].sort(),
        facts,
        filename: `${c.name.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`,
        // Transient, for the core's merge (never written):
        // Every consumer file, so a process that runs any of them is this
        // queue's task (CR-078); a process runs its one file.
        ...(c.queue ? (c.consumers?.length ? { runs: [...c.consumers] } : {}) : file ? { runs: [file] } : {}),
        ...(c.parsed ? { processKeys: [...keys].sort() } : {}),
        ...(c.deploys ? { deploys: true } : {}),
        ...(unresolved ? { unresolved } : {}),
      });
    }
    records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { records, diagnostics };
  };
  return { diagnostics, excluded, walk, read, exists, addProcess, add, finish };
}
