// The border between the core and the adapters (decision 0036): the core
// knows no stack. Nothing under src/core/ imports from src/adapters/, and no
// file there names a stack, framework, library, platform or vendor, in code
// or in comments. The adapters may import the core's helpers; the core finds
// adapters only by name, through lib/catalogue.mjs.
//
// STACK_WORDS is the list a core file may never say. It lives here, in a
// test, because the core may not hold it. Third-party code vendored into a
// viewer (`vendor/`) is outside the rule: it is not ours to word.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(PKG, "src", "core");
const ADAPTERS = join(PKG, "src", "adapters");

const STACK_WORDS = [
  "next.js", "nextjs", "react", "react-router", "expo", "expo-router", "vue", "nuxt", "svelte", "angular", "remix",
  "fastapi", "django", "flask", "rails", "laravel", "express",
  "supabase", "supabase-js", "supabase-py", "postgres", "postgresql", "sqlalchemy", "prisma", "drizzle", "mongodb",
  "vercel", "railway", "cloudflare", "wrangler", "procfile", "heroku", "netlify", "docker", "fly.io",
  "sentry", "resend", "mailgun", "stripe", "bullmq", "inngest", "pg_cron",
];
const WORD_RE = new RegExp(`(^|[^a-z0-9_.-])(${STACK_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=$|[^a-z0-9_])`, "gi");

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "vendor") out.push(...files(p));
    } else if (/\.(mjs|js|css|html|md|json)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p) => relative(PKG, p).split(sep).join("/");

test("no core file imports from the adapters", () => {
  const offenders = [];
  for (const p of files(CORE)) {
    const text = readFileSync(p, "utf8");
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'`])([^"'`]+)\1/g)) {
      const spec = m[2];
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(p), spec);
      if (target === ADAPTERS || target.startsWith(ADAPTERS + sep)) offenders.push(`${rel(p)} imports ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("no core file names a stack, in code or in comments", () => {
  const offenders = [];
  for (const p of files(CORE)) {
    readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(WORD_RE)) offenders.push(`${rel(p)}:${i + 1}: ${m[2]}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("the guard itself catches what it should", () => {
  const hits = (s) => [...s.matchAll(WORD_RE)].map((m) => m[2].toLowerCase());
  assert.deepEqual(hits("a Next.js route and a FastAPI `/v1`"), ["next.js", "fastapi"]);
  assert.deepEqual(hits("// commit a railway.toml"), ["railway"]);
  assert.deepEqual(hits("expressive, reaction, supabased, external-services"), []);
});

test("every catalogue adapter is a folder with an index.mjs, and catalogue.json names only real ones", async () => {
  const { catalogue } = await import("../src/core/lib/catalogue.mjs");
  const { names, aliases, bundles } = catalogue();
  const folders = readdirSync(ADAPTERS).filter((n) => statSync(join(ADAPTERS, n)).isDirectory());
  assert.deepEqual([...names.keys()].sort(), folders.sort());
  for (const [old, now] of Object.entries(aliases)) {
    assert.ok(names.has(now), `alias ${old} -> ${now} names a catalogue adapter`);
    assert.ok(!names.has(old), `a retired name ${old} is not also a folder`);
  }
  for (const [legacy, b] of Object.entries(bundles)) {
    for (const n of [...b.extractors, ...Object.keys(b.options ?? {}), ...(b.rest ? [b.rest] : [])]) assert.ok(names.has(n), `bundle ${legacy} names ${n}`);
  }
});
