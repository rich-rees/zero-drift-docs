// The standard suite (decision 0040 point 5): one set of checks every
// adapter passes, the catalogue's in ZDD's own CI and an adopter's own in
// theirs (`zdd-engine suite`). It runs on the adapter's own fixture — a
// miniature repo in its convention — copied into temporary folders outside
// any repo, never on the adopter's code: ZDD never writes throwaway files
// into a repo to test itself (0039 point 5). Each run is a real `derive` by
// this engine, in a child process, so a check sees exactly what CI would.
//
// The checks are numbered in the order ZDD added them, and the number is
// what `suiteChecks` in zdd/config.json counts: a check numbered at or below
// it blocks, a newer one warns until "upgrade ZDD" has fixed the adapter and
// raised the number (0040 point 7, decision 0035). A new check goes at the
// END of the list, never in the middle — an adopter's number would
// otherwise hold them to a check they never passed.
//
// The core knows no language, so an adapter says how a line of each kind of
// file it reads is commented out (`COMMENT`, "{ '.py': '#' }"); the suite
// comments out every line and expects what a blank file of the same name
// gives (a file's name alone can be a declaration: a route file in a
// file-tree convention). Descriptions are left out of that comparison: a
// leading comment is where a description is read from, by design.

import { spawnSync, execFileSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SUITE_CHECKS = [
  {
    n: 1,
    id: "determinism",
    title: "the same source gives byte-identical records, on any machine",
    fix: "no dates, randomness, absolute paths, environment values or unsorted lists in a record; sort what you collect",
  },
  {
    n: 2,
    id: "ignored",
    title: "a path git ignores is never read",
    fix: "list and read only through io.walk and io.read (or ask io.isIgnored before reading on your own)",
  },
  {
    n: 3,
    id: "missing-root",
    title: "a missing root is nothing to inventory, never an error",
    fix: "when a configured folder or file is missing, return no records and a diagnostic; never throw",
  },
  {
    n: 4,
    id: "masked",
    title: "commented-out code (and the trap folder's quoted code) never becomes a record",
    fix: "decide structure on text with its comments and strings masked; check COMMENT names every kind of file the adapter reads",
  },
  {
    n: 5,
    id: "io",
    title: "every read goes through io",
    fix: "no node:fs, child_process or network module, no require, dynamic import, fetch or process.env in the adapter's own files — use the io derive hands in",
  },
];
export const SUITE_CHECK_COUNT = SUITE_CHECKS.length;

const ENGINE_BIN = fileURLToPath(new URL("../../../bin/zdd-engine.mjs", import.meta.url));
const CORE_LIB = fileURLToPath(new URL("./", import.meta.url));
const MAX_FILE = 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const DERIVE_TIMEOUT = 120_000;
const IGNORED_DIR = "zz-ignored";

// ---------------------------------------------------------------------------
// Plumbing: bounded copies, never through a link
// ---------------------------------------------------------------------------

function walkFiles(dir, visit, { skip = () => false } = {}) {
  const budget = { entries: MAX_ENTRIES };
  const go = (abs, rel, depth) => {
    if (depth > 32) throw new Error(`${dir}: deeper than 32 levels`);
    for (const name of readdirSync(abs).sort()) {
      if (--budget.entries < 0) throw new Error(`${dir}: more than ${MAX_ENTRIES} entries`);
      const childRel = rel ? `${rel}/${name}` : name;
      if (skip(childRel, name)) continue;
      const p = join(abs, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) go(p, childRel, depth + 1);
      else if (st.isFile()) visit(p, childRel);
    }
  };
  go(dir, "", 0);
}

function readCapped(p, budget) {
  const buf = Buffer.alloc(MAX_FILE + 1);
  const fd = openSync(p, "r");
  let n = 0;
  try {
    for (let got; n <= MAX_FILE && (got = readSync(fd, buf, n, MAX_FILE + 1 - n, null)) > 0; ) n += got;
  } finally {
    closeSync(fd);
  }
  if (n > MAX_FILE) throw new Error(`${p} is over ${MAX_FILE} bytes — keep fixtures small`);
  budget.bytes += n;
  if (budget.bytes > MAX_TOTAL) throw new Error(`more than ${MAX_TOTAL} bytes under ${dirname(p)}`);
  return Buffer.from(buf.subarray(0, n));
}

// A fixture as rel -> bytes. Its own `zdd/` folder (a test fixture's config,
// glossary, map) is not source and is left behind; `.git` too.
export function readFixture(dir) {
  const files = new Map();
  const budget = { bytes: 0 };
  walkFiles(dir, (p, rel) => files.set(rel, readCapped(p, budget)), { skip: (rel, name) => name === ".git" || rel === "zdd" || name === ".gitkeep" });
  return files;
}

// An adopter's own adapter, as rel -> bytes under zdd/extractors/: a folder
// without its fixtures and tests, or a single module.
function readLocalAdapter(name, path) {
  const out = new Map();
  const budget = { bytes: 0 };
  if (lstatSync(path).isDirectory()) {
    walkFiles(path, (p, rel) => out.set(`${name}/${rel}`, readCapped(p, budget)), {
      skip: (rel, n) => /^fixture(?:-[^/]*)?$/.test(rel) || n === "node_modules" || n === ".git" || n.endsWith(".test.mjs"),
    });
  } else out.set(`${name}.mjs`, readCapped(path, budget));
  return out;
}

function makeRepo(files, { name, options, local, companions, alone = false }) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-suite-"));
  for (const [rel, bytes] of files) {
    const to = join(repo, ...rel.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, bytes);
  }
  // Companions run beside the adapter: catalogue adapters whose records it
  // needs to say anything (a data-access adapter's tables come from a schema
  // adapter). They are held to nothing here; the adapter is.
  const config = alone
    ? { name: "standard suite", extractors: Object.keys(companions), extractorOptions: { ...companions }, render: { storeChanges: false } }
    : { name: "standard suite", extractors: [...Object.keys(companions ?? {}), name], extractorOptions: { ...(companions ?? {}), [name]: options ?? {} }, render: { storeChanges: false } };
  if (local) {
    config.localExtractorDir = "zdd/extractors";
    for (const [rel, bytes] of local) {
      const to = join(repo, "zdd", "extractors", ...rel.split("/"));
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, bytes);
    }
  }
  mkdirSync(join(repo, "zdd"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(config, null, 2) + "\n");
  return repo;
}

function derive(repo, env = process.env) {
  const r = spawnSync(process.execPath, [ENGINE_BIN, "derive", `--root=${repo}`], { encoding: "utf8", env, timeout: DERIVE_TIMEOUT, killSignal: "SIGKILL" });
  const timedOut = r.error?.code === "ETIMEDOUT" ? ` (killed after ${DERIVE_TIMEOUT / 1000} s)` : "";
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() + timedOut };
}

function metadata(repo) {
  const out = new Map();
  const root = join(repo, "zdd", "metadata");
  if (!existsSync(root)) return out;
  const budget = { bytes: 0 };
  walkFiles(root, (p, rel) => out.set(rel, readCapped(p, budget).toString("utf8")));
  return out;
}

// The first way two metadata sets differ, in words; null when equal.
function difference(a, b, { what, structural = false } = {}) {
  const shape = (text) => {
    if (!structural) return text;
    const r = JSON.parse(text);
    delete r.description;
    return JSON.stringify(r);
  };
  for (const rel of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (!a.has(rel)) return `${what} has a record the fixture does not: ${rel}`;
    if (!b.has(rel)) return `${what} lacks the fixture's record ${rel}`;
    if (shape(a.get(rel)) !== shape(b.get(rel))) return `${what} changes the record ${rel}`;
  }
  return null;
}

// Every line commented out (`mark` + a space) or blanked, line endings kept.
const commentOut = (text, mark) => text.replace(/^([^\r\n]*)/gm, (line) => `${mark} ${line}`);
const blankOut = (text) => text.replace(/^[^\r\n]*/gm, "");

export function commentMark(comment, rel) {
  const name = basename(rel);
  if (Object.hasOwn(comment, name)) return comment[name];
  const ext = Object.keys(comment)
    .filter((k) => k.startsWith(".") && name.endsWith(k))
    .sort((x, y) => y.length - x.length)[0];
  return ext ? comment[ext] : null;
}

export function validComment(comment) {
  return Boolean(comment) && typeof comment === "object" && !Array.isArray(comment) && Object.entries(comment).every(([k, v]) => /^[^/\\\x00-\x1f]+$/.test(k) && typeof v === "string" && /^\S{1,8}$/.test(v));
}

// ---------------------------------------------------------------------------
// Check 5: the adapter's own files reach the filesystem only through io
// ---------------------------------------------------------------------------

const BANNED_MODULES = /^(?:node:)?(?:fs|fs\/promises|child_process|net|http|https|http2|dgram|worker_threads|cluster|tls|dns)$/;
// Built from the word, so this file is not read as making the call itself
// (the core border test reads core files as text).
const call = (word) => new RegExp(String.raw`\b${word}\s*\(`);
const BANNED_CALLS = [
  [call("require"), "calls require"],
  [call(["im", "port"].join("")), "imports dynamically"],
  [/\bprocess\s*\.\s*env\b/, "reads process.env"],
  [call("fetch"), "calls fetch"],
];
const IMPORT_RE = /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;

// Comments and string literals blanked, so a comment or a string that names
// `require(` is not a call. Regex literals are left as they are; a pattern
// written to find `import(` in scanned text escapes its parenthesis.
export function maskJs(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "/") {
      while (i < text.length && text[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && d === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < text.length && text[i] !== c && (c === "`" || text[i] !== "\n")) {
        if (text[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < text.length) {
        out += text[i];
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// What a core module may bring in: one that (itself or through what it
// imports) reaches node:fs or a process is off limits, save io's own module.
const coreFsCache = new Map();
function coreReachesFs(abs, seen = new Set()) {
  if (coreFsCache.has(abs)) return coreFsCache.get(abs);
  if (seen.has(abs)) return false;
  seen.add(abs);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return false;
  }
  let reaches = false;
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    if (BANNED_MODULES.test(spec)) reaches = true;
    else if (spec.startsWith(".") && coreReachesFs(resolve(dirname(abs), spec), seen)) reaches = true;
  }
  coreFsCache.set(abs, reaches);
  return reaches;
}

// The adapter's own JS files: `entry` and every relative import it reaches
// inside `within` (the catalogue folder, or the adopter's localExtractorDir).
// A core module is allowed when it reaches no filesystem of its own.
export function ioProblems(entry, within) {
  const problems = [];
  const seen = new Set();
  const root = resolve(within);
  const io = resolve(CORE_LIB, "extractor-io.mjs");
  const visit = (abs) => {
    if (seen.has(abs)) return;
    seen.add(abs);
    const rel = relative(root, abs).split(sep).join("/");
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      problems.push(`${rel} cannot be read`);
      return;
    }
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (BANNED_MODULES.test(spec)) problems.push(`${rel} imports ${spec}`);
      else if (spec.startsWith(".")) {
        const target = resolve(dirname(abs), spec);
        if (target.startsWith(resolve(CORE_LIB) + sep) || target.startsWith(resolve(CORE_LIB, "..") + sep)) {
          if (target !== io && coreReachesFs(target)) problems.push(`${rel} imports ${spec}, which reads the filesystem itself`);
        } else if (target.startsWith(root + sep)) visit(target);
        else problems.push(`${rel} imports ${spec}, outside its own folder`);
      }
    }
    const masked = maskJs(text);
    for (const [re, what] of BANNED_CALLS) if (re.test(masked)) problems.push(`${rel} ${what}`);
  };
  visit(resolve(entry));
  return problems;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

// One adapter through every check. `local` is { path } for an adopter's own
// adapter (a folder or a module, copied into each scratch repo), absent for
// a catalogue one (selected by name). `entry`/`within` locate its source for
// check 5. Returns { name, records, precondition, checks: [{ n, id, ok, detail }] }.
export function runSuite({ name, fixtureDir, options = {}, comment, trapDir = null, local = null, entry, within, allowEmpty = false, companions = {} }) {
  const made = [];
  const repo = (files) => {
    const r = makeRepo(files, { name, options, local: localFiles, companions });
    made.push(r);
    return r;
  };
  const results = [];
  const result = (n, ok, detail = null) => results.push({ n, id: SUITE_CHECKS[n - 1].id, ok, detail });
  let localFiles = null;
  try {
    if (local) localFiles = readLocalAdapter(name, local.path);
    let fixture = null;
    let precondition = null;
    if (!fixtureDir || !existsSync(fixtureDir) || !lstatSync(fixtureDir).isDirectory()) {
      precondition = `no fixture: ${local ? `add a fixture/ folder beside the adapter (a miniature repo in its convention) and export SUITE = { options }` : "the catalogue table names none"} — the suite runs on it, never on your repo`;
    } else fixture = readFixture(fixtureDir);
    let base = null;
    if (fixture) {
      const a = repo(fixture);
      const run = derive(a);
      if (run.status !== 0) precondition = `derive fails on the fixture:\n${run.out}`;
      else {
        base = metadata(a);
        // Something of its own: records, or links on the companions' records
        // (a data-access adapter's tables land on the routes that reach them).
        let adds = base.size > 0;
        if (adds && Object.keys(companions).length) {
          const c = makeRepo(fixture, { name, options, companions, alone: true });
          made.push(c);
          adds = derive(c).status !== 0 || difference(metadata(c), base, { what: "the adapter" }) !== null;
        }
        if (!adds && !allowEmpty) precondition = "the fixture gives nothing of the adapter's own (no record, no link), so the checks would prove nothing — add source in this convention to fixture/";
      }
    }

    // 3 needs no fixture.
    const empty = repo(new Map());
    const e = derive(empty);
    if (e.status !== 0) result(3, false, `derive fails on an empty repo:\n${e.out}`);
    else if (metadata(empty).size) result(3, false, `an empty repo gives ${metadata(empty).size} record(s)`);
    else result(3, true);

    if (precondition) {
      for (const n of [1, 2, 4]) result(n, false, precondition);
    } else {
      // 1: two copies, one under another timezone, locale and environment,
      // and a second run on the first.
      {
        const b = repo(fixture);
        const rb = derive(b, { ...process.env, TZ: "Pacific/Chatham", LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8", ZDD_SUITE_SENTINEL: "another machine" });
        const a2 = repo(fixture);
        derive(a2);
        const ra = derive(a2);
        const diff = rb.status !== 0 ? `derive fails under another timezone and locale:\n${rb.out}` : ra.status !== 0 ? `a second derive fails:\n${ra.out}` : (difference(base, metadata(b), { what: "another timezone, locale and environment" }) ?? difference(base, metadata(a2), { what: "a second run" }));
        result(1, !diff, diff);
      }
      // 2: every fixture file copied under an ignored folder beside it, in a
      // git repository whose .gitignore names that folder.
      {
        const files = new Map(fixture);
        for (const [rel, bytes] of fixture) {
          const cut = rel.lastIndexOf("/");
          files.set(cut === -1 ? `${IGNORED_DIR}/${rel}` : `${rel.slice(0, cut)}/${IGNORED_DIR}/${rel.slice(cut + 1)}`, bytes);
        }
        const prior = files.get(".gitignore");
        files.set(".gitignore", Buffer.from(`${prior ? `${prior.toString("utf8").replace(/\n?$/, "\n")}` : ""}${IGNORED_DIR}/\n`));
        const c = repo(files);
        let gitError = null;
        try {
          execFileSync("git", ["init", "-q"], { cwd: c, stdio: "ignore", timeout: 30_000 });
        } catch (err) {
          gitError = `git could not make a repository (${err.code ?? err.message}) — the check needs git on the PATH`;
        }
        if (gitError) result(2, false, gitError);
        else {
          const rc = derive(c);
          const withIgnored = rc.status !== 0 ? `derive fails beside gitignored copies:\n${rc.out}` : difference(base, metadata(c), { what: "gitignored copies of the fixture" });
          result(2, !withIgnored, withIgnored);
        }
      }
      // 4: every line of every file COMMENT names commented out, against the
      // same files with every line blank; and the trap folder, if any, over
      // the fixture.
      if (!validComment(comment)) result(4, false, 'the adapter declares no COMMENT — export one, e.g. COMMENT = { ".py": "#" } (`{}` when nothing it reads takes a line comment)');
      else {
        const commented = new Map(fixture);
        const blank = new Map(fixture);
        let touched = 0;
        for (const [rel, bytes] of fixture) {
          const mark = commentMark(comment, rel);
          if (mark === null) continue;
          touched++;
          const text = bytes.toString("utf8");
          commented.set(rel, Buffer.from(commentOut(text, mark)));
          blank.set(rel, Buffer.from(blankOut(text)));
        }
        let diff = null;
        if (touched) {
          const d = repo(commented);
          const k = repo(blank);
          const rd = derive(d);
          const rk = derive(k);
          if (rd.status !== 0) diff = `derive fails on the commented-out fixture:\n${rd.out}`;
          else if (rk.status !== 0) diff = `derive fails on the blanked fixture:\n${rk.out}`;
          else diff = difference(metadata(k), metadata(d), { what: "the commented-out fixture", structural: true });
        }
        if (!diff && trapDir && existsSync(trapDir)) {
          const withTrap = new Map(fixture);
          for (const [rel, bytes] of readFixture(trapDir)) withTrap.set(rel, bytes);
          const t = repo(withTrap);
          const rt = derive(t);
          diff = rt.status !== 0 ? `derive fails with the trap folder:\n${rt.out}` : difference(base, metadata(t), { what: "the trap folder", structural: true });
        }
        result(4, !diff, diff ?? (touched ? null : "nothing in the fixture is a kind of file COMMENT names — nothing was commented out"));
      }
    }

    // 5 reads source, no repo needed.
    const problems = entry ? ioProblems(entry, within ?? dirname(entry)) : ["the adapter's source could not be located"];
    result(5, !problems.length, problems.length ? problems.join("; ") : null);

    results.sort((x, y) => x.n - y.n);
    return { name, records: base?.size ?? 0, precondition, checks: results };
  } finally {
    for (const r of made) rmSync(r, { recursive: true, force: true });
  }
}
