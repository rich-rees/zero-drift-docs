// jobs extractor — background work: everything that runs without a user
// clicking something, which is hard to see from code alone (CAS-97, ZDD 2.1,
// decision 0020; the "Background work" area of CAS-103 pick 6). One kind,
// `job`, in three modes (`facts.mode`):
//
//   scheduled  run on a timer — a Vercel cron (`vercel.json` → `crons`), a
//              Railway `cronSchedule`, a Cloudflare Worker's `[triggers]
//              crons` (`wrangler.toml`), a Supabase `pg_cron` schedule in a
//              migration (`cron.schedule('name', '…', $$…$$)`), a Trigger.dev
//              `schedules.task({ cron })`; and, only when
//              `includeGithubActions` is on, a GitHub Actions `schedule:`
//              (repo housekeeping, shown apart — never the app by default)
//   worker     a long-running process — a Railway `startCommand`, a Procfile
//              line, a Docker Compose service with a job-shaped `command`
//   queue      work handed over through a queue — BullMQ (`new Queue("x")`
//              produces, `new Worker("x", …)` consumes), Inngest
//              (`createFunction({ id }, { event })`), Trigger.dev (`task({
//              id })`), SQS (`QueueUrl` + `SendMessage` / `ReceiveMessage`)
//   unknown    a process whose mode nothing states (lint names it)
//
// What is NOT a job: a package.json script nobody runs as a process. A
// script counts only when a manifest runs it (`worker: pnpm run worker` in
// a Procfile, a Railway or Compose command) — a hand-run `seed:snapshot` is
// a developer's tool, not background work (CAS-103 pick 6).
//
// Each record carries its trigger (`facts.schedule` for a timer, the queue
// or event for a queue) and the thing it hits: a route (`?route:/api/cron/x`
// → a `calls` edge), a function (`?function:x`), or the module it runs
// (its `resource`). A queue's producers are `usedBy` edges (`?at:<file>`);
// its consumer file is the resource. Mode is never guessed from prose:
// `scheduled` when a schedule is stated, `worker` when config's `modes` or
// the manifest's shape says so, `queue` when a queue is named, else
// `unknown`. A job's description is its module's docstring or leading
// comment. Refs: `.table("x")` / `.from_("x")` / `.from("x")` and the tables
// in SQL literals — `reads` and `writes` edges (decision 0016).
// Options (extractorOptions.jobs):
//   roots                 where manifests and source are looked for (default
//                         ["."]; dependencies and build output never entered)
//   exclude               script names that are not jobs
//   modes                 { "<job name>": "worker" | "scheduled" }
//   entries               [{ name, module | file, cwd?, mode?, schedule?, description? }]
//   includeGithubActions  true to list `.github/workflows` schedules as
//                         housekeeping jobs (default false)
// Every file is read through `io` (decision 0010). Deterministic.

import { posix } from "node:path";
import { repoRelative } from "../../lib/paths.mjs";
import { leadingComment } from "../nextjs/index.mjs";

export const FACTS_KEY_ORDER = {
  job: ["mode", "command", "schedule", "trigger", "target", "queue", "producers", "consumers", "source", "housekeeping", "manifest", "edges"],
};
export const MAX_SOURCE_BYTES = 1024 * 1024;
const DEFAULT_EXCLUDE = ["dev", "start", "test", "lint", "build", "typecheck", "format", "prepare", "postinstall"];
const MANIFESTS = new Set(["package.json", "Procfile", "railway.toml", "railway.json", "vercel.json", "wrangler.toml", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]);
const MODES = new Set(["worker", "scheduled"]);
const NEVER_ENTER = new Set([".git", "node_modules", ".venv", "venv", "dist", "build", ".next", ".expo", "coverage", "__pycache__", ".vercel", ".wrangler"]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;
const TEST_FILE = /\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$|\.d\.ts$/;

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

// A minimal TOML reader: `[section]` headers, `key = "string"` and
// `key = ["a", "b"]` lines — what railway.toml and wrangler.toml carry.
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

// pg_cron schedules in a migration: cron.schedule('name', 'schedule', $$body$$ | 'body').
export function scanPgCron(text) {
  const out = [];
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
export function scanQueues(text) {
  const out = [];
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

// GitHub Actions: `on: schedule: - cron: '…'` and the workflow's name.
export function scanWorkflow(text) {
  const crons = [...text.matchAll(/^\s*-\s*cron:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((m) => m[1].trim());
  const name = /^name:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(text);
  return { crons, name: name ? name[1].trim() : null };
}

const slug = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "job";

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
  const includeActions = options.includeGithubActions === true;
  if (options.includeGithubActions !== undefined && typeof options.includeGithubActions !== "boolean") throw new Error("jobs.includeGithubActions must be true or false");
  const excluded = (name) => exclude.includes(name) || /^(test|lint|build|check|typecheck|format)[:.-]/.test(name);

  // 1. Manifests, migrations, workflows and source under the roots.
  const manifests = [];
  const migrations = [];
  const workflows = [];
  const sources = [];
  const seen = new Set();
  for (const root of roots) {
    const walked = io.walk(
      root,
      (rel, name) => {
        if (seen.has(rel)) return;
        seen.add(rel);
        if (MANIFESTS.has(name)) manifests.push(rel);
        else if (name.endsWith(".sql") && /(^|\/)migrations\//.test(rel)) migrations.push(rel);
        else if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(rel)) workflows.push(rel);
        else if (SOURCE_EXT.test(name) && !TEST_FILE.test(rel)) sources.push(rel);
      },
      { enter: (rel, name) => !NEVER_ENTER.has(name) },
    );
    if (!walked.exists) diagnostics.push(`${root} not found — nothing to inventory`);
    if (walked.truncated) diagnostics.push(`${root}: walk truncated — the manifests under it may be incomplete`);
  }
  manifests.sort();
  migrations.sort();
  workflows.sort();
  sources.sort();

  const read = (rel) => {
    const r = io.read(rel, { maxBytes: MAX_SOURCE_BYTES });
    if (!r.ok) {
      if (r.code !== "missing" && r.code !== "ignored") diagnostics.push(`${rel} ${r.reason}`);
      return null;
    }
    return r.text;
  };
  // An ignored target is absent too: a clean clone has no such file (pick 1).
  const exists = (rel) => {
    const code = io.read(rel, { maxBytes: 1 }).code;
    return code !== "missing" && code !== "ignored";
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

  // 2. Candidates: { name, command, manifest, dir, parsed, schedule?, mode?, source }
  const candidates = [];
  const railway = new Map(); // dir -> { schedule, command }
  const pushProcess = (c) => {
    if (c.parsed.kind === "script") {
      const resolved = resolveScript(c.dir, c.parsed);
      if (!resolved) {
        diagnostics.push(`${c.manifest}: '${c.name}' runs the package script '${c.parsed.target}', which names no module or file to run — skipped`);
        return;
      }
      candidates.push({ ...c, dir: resolved.dir, parsed: resolved.parsed, scriptCommand: resolved.command });
      return;
    }
    candidates.push(c);
  };
  for (const rel of manifests) {
    const text = read(rel);
    if (text === null) continue;
    const dir = posix.dirname(rel);
    const name = posix.basename(rel);
    if (name === "package.json") continue; // a script is a job only when a manifest runs it
    if (name === "Procfile") {
      for (const line of text.split("\n")) {
        const m = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/.exec(line);
        if (!m || m[1] === "web" || excluded(m[1])) continue;
        const parsed = parseCommand(m[2]);
        if (parsed) pushProcess({ name: m[1], command: m[2], manifest: rel, dir, parsed, source: "procfile" });
      }
    } else if (name === "vercel.json") {
      let j;
      try {
        j = JSON.parse(text);
      } catch {
        diagnostics.push(`${rel}: not JSON — skipped`);
        continue;
      }
      const crons = Array.isArray(j?.crons) ? j.crons : [];
      for (const c of crons) {
        if (!c || typeof c.path !== "string" || typeof c.schedule !== "string") continue;
        const route = c.path.split("?")[0];
        candidates.push({ name: slug(route.split("/").filter(Boolean).pop() ?? "cron"), command: `GET ${route}`, manifest: rel, dir, parsed: null, schedule: c.schedule, trigger: "cron", target: route, source: "vercel", routeRef: route });
      }
    } else if (name === "wrangler.toml") {
      const cfg = parseToml(text);
      const crons = Array.isArray(cfg["triggers.crons"]) ? cfg["triggers.crons"] : [];
      if (crons.length) {
        const main = typeof cfg.main === "string" ? posix.normalize(posix.join(dir, cfg.main)) : null;
        candidates.push({ name: slug(typeof cfg.name === "string" ? cfg.name : posix.basename(dir === "." ? "worker" : dir)), command: main ? `scheduled() in ${main}` : "scheduled()", manifest: rel, dir, parsed: null, schedule: crons.join("; "), trigger: "cron", target: main ?? undefined, source: "cloudflare", file: main && exists(main) ? main : null });
      }
    } else if (/^(docker-)?compose\.ya?ml$/.test(name)) {
      for (const svc of parseCompose(text)) {
        if (svc.ports || svc.name === "web" || excluded(svc.name) || !svc.command) continue;
        const parsed = parseCommand(svc.command);
        if (parsed) pushProcess({ name: svc.name, command: svc.command, manifest: rel, dir, parsed, source: "compose", modeHint: "worker" });
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
        if (parsed) pushProcess({ name: posix.basename(dir === "." ? "root" : dir), command, manifest: rel, dir, parsed, schedule: typeof schedule === "string" ? schedule : undefined, source: "railway" });
      }
    }
  }
  for (const rel of migrations) {
    const text = read(rel);
    if (text === null) continue;
    for (const s of scanPgCron(text)) {
      candidates.push({ name: slug(s.name), command: s.body.replace(/\s+/g, " ").slice(0, 200), manifest: rel, dir: posix.dirname(rel), parsed: null, schedule: s.schedule, trigger: "pg_cron", target: s.function ?? undefined, source: "supabase", functionRef: s.function });
    }
  }
  if (includeActions) {
    for (const rel of workflows) {
      const text = read(rel);
      if (text === null) continue;
      const w = scanWorkflow(text);
      if (!w.crons.length) continue;
      candidates.push({ name: slug(w.name ?? posix.basename(rel).replace(/\.ya?ml$/, "")), command: `GitHub Actions workflow ${rel}`, manifest: rel, dir: posix.dirname(rel), parsed: null, schedule: w.crons.join("; "), trigger: "cron", source: "github-actions", housekeeping: true });
    }
  }
  for (const [i, e] of entries.entries()) {
    if (!e || typeof e !== "object" || typeof e.name !== "string" || (typeof e.module !== "string" && typeof e.file !== "string")) throw new Error(`jobs.entries[${i}] must be { name, module | file, mode?, schedule? }`);
    if (e.mode !== undefined && !MODES.has(e.mode)) throw new Error(`jobs.entries[${i}].mode must be "worker" or "scheduled"`);
    const parsed = typeof e.file === "string" ? { kind: "file", target: repoRelative(e.file, `jobs.entries[${i}].file`) } : { kind: "python-module", target: e.module };
    const cwd = e.cwd === undefined ? "." : repoRelative(e.cwd, `jobs.entries[${i}].cwd`);
    candidates.push({ name: e.name, command: e.command ?? (parsed.kind === "file" ? `node ${parsed.target}` : `python -m ${parsed.target}`), manifest: "zdd/config.json", dir: cwd, parsed, schedule: typeof e.schedule === "string" ? e.schedule : undefined, mode: e.mode, description: typeof e.description === "string" ? e.description : undefined, source: "config" });
  }

  // Queues, from source: one candidate per queue name, its consumer file the
  // resource, its producers `usedBy`.
  const queues = new Map(); // name -> { producers: Set, consumers: Set, lib, trigger?, schedule? }
  for (const rel of sources) {
    const text = read(rel);
    if (text === null) continue;
    for (const q of scanQueues(text)) {
      const entry = queues.get(q.queue) ?? { producers: new Set(), consumers: new Set(), lib: q.lib };
      (q.role === "producer" ? entry.producers : entry.consumers).add(rel);
      if (q.trigger) entry.trigger = q.trigger;
      if (q.schedule) entry.schedule = q.schedule;
      queues.set(q.queue, entry);
    }
  }
  for (const [name, q] of [...queues].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const consumers = [...q.consumers].sort();
    const producers = [...q.producers].sort();
    const file = consumers[0] ?? producers[0];
    candidates.push({ name: slug(name), command: `${q.lib} ${q.schedule ? "scheduled task" : "queue"} "${name}"`, manifest: file, dir: posix.dirname(file), parsed: null, file, schedule: q.schedule, trigger: q.schedule ? "cron" : q.trigger ? `event ${q.trigger}` : "queue", queue: name, producers, consumers, source: q.lib, modeHint: q.schedule ? "scheduled" : "queue" });
  }

  // A Railway file whose startCommand is a Procfile's or Compose's command is
  // that job's deployment record, not a second job: its schedule attaches to
  // the job and the file joins its resources.
  const norm = (cmd) => cmd.trim().replace(/\s+/g, " ");
  const merged = [];
  for (const c of candidates) {
    if (c.source === "railway") {
      const twin = candidates.find((o) => o !== c && o.source !== "railway" && typeof o.command === "string" && (norm(o.command) === norm(c.command) || (o.scriptCommand && norm(o.scriptCommand) === norm(c.command))));
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
      // A queue named like the process that consumes it (a Procfile's
      // `emails` running the file that holds `new Worker("emails")`) is that
      // process's queue, not a second job: the queue facts join the record.
      const existing = c.queue ? records.find((r) => r.id === `job:${c.name}`) : null;
      if (existing && c.consumers?.includes(existing.resource[0])) {
        Object.assign(existing.facts, { queue: c.queue, producers: c.producers, consumers: c.consumers, trigger: c.trigger });
        if (existing.facts.mode === "unknown") existing.facts.mode = "queue";
        if (c.producers?.length) {
          existing.facts.edges = { ...(existing.facts.edges ?? {}), usedBy: c.producers.map((f) => `?at:${f}`) };
          existing.refs = [...new Set([...existing.refs, ...c.producers.map((f) => `?at:${f}`)])].sort();
        }
        continue;
      }
      diagnostics.push(`job '${c.name}' is declared in ${byName.get(c.name)} and again in ${c.manifest} — the second is skipped`);
      continue;
    }
    let file = c.file ?? null;
    if (c.parsed) {
      file = resolveTarget(c.dir, c.parsed);
      if (!file) {
        diagnostics.push(`${c.manifest}: '${c.name}' runs ${c.parsed.kind === "file" ? c.parsed.target : `module ${c.parsed.target}`}, which resolves to no file under ${c.dir} — skipped`);
        continue;
      }
    }
    byName.set(c.name, c.manifest);
    const text = file ? read(file) ?? "" : "";
    // A Railway file in the module's folder (or the manifest's) states the schedule.
    const rw = c.parsed ? railway.get(c.dir) ?? (file ? railway.get(posix.dirname(file)) : undefined) : undefined;
    const schedule = c.schedule ?? (rw && (rw.command === c.command || rw.command === c.scriptCommand) ? rw.schedule : undefined);
    const mode = schedule ? "scheduled" : (c.mode ?? modes[c.name] ?? c.modeHint ?? "unknown");
    const tables = file ? scanTables(text) : { reads: [], writes: [] };
    const edges = {};
    if (tables.reads.length) edges.reads = tables.reads.map((t) => `?table:${t}`);
    if (tables.writes.length) edges.writes = tables.writes.map((t) => `?table:${t}`);
    if (c.routeRef) edges.calls = [`?route:${c.routeRef}`];
    if (c.functionRef) edges.calls = [`?function:${c.functionRef}`];
    if (c.producers?.length) edges.usedBy = c.producers.map((f) => `?at:${f}`);
    const refs = [...new Set(Object.values(edges).flat())].sort();
    const facts = { mode, command: c.command };
    if (schedule) facts.schedule = schedule;
    if (c.trigger) facts.trigger = c.trigger;
    if (c.target) facts.target = c.target;
    if (c.queue) facts.queue = c.queue;
    if (c.producers) facts.producers = c.producers;
    if (c.consumers) facts.consumers = c.consumers;
    facts.source = c.source;
    if (c.housekeeping) facts.housekeeping = true;
    facts.manifest = c.manifest;
    if (Object.keys(edges).length) facts.edges = edges;
    const resource = [file, c.manifest, ...(c.extraResources ?? [])].filter((v, i, a) => v && a.indexOf(v) === i);
    records.push({
      kind: "job",
      id: `job:${c.name}`,
      title: c.name,
      description: c.description ?? (file ? describe(text, file) : ""),
      resource,
      refs,
      facts,
      filename: `${c.name.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`,
    });
  }
  records.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { records, diagnostics };
}
